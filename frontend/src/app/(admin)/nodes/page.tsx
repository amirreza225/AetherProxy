"use client";

import useSWR from "swr";
import { useState } from "react";
import {
  loadPartial,
  getNodes,
  createNode,
  deleteNode,
  deployNode,
  getDiscoveryStatus,
  getDiscoveryPeers,
  discoveryJoin,
  discoveryLeave,
  discoveryAddPeer,
  type Node,
  type DiscoveryStatus,
  type PeerNode,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Inbound {
  tag: string;
  type: string;
  listen_port?: number;
  enabled?: boolean;
}

function NodeStatusBadge({ status }: { status: Node["status"] }) {
  const variant =
    status === "online" ? "default" : status === "offline" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function PeerStatusBadge({ status }: { status: PeerNode["status"] }) {
  const variant =
    status === "alive"
      ? "default"
      : status === "dead"
      ? "destructive"
      : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function AddNodeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", host: "", sshPort: "22", sshKeyPath: "", provider: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createNode({ ...form, sshPort: Number(form.sshPort) });
      onCreated();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add Node</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Remote Node</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="host">Host / IP</Label>
            <Input id="host" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="sshPort">SSH Port</Label>
            <Input id="sshPort" type="number" value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sshKeyPath">SSH Key Path (on server)</Label>
            <Input id="sshKeyPath" value={form.sshKeyPath} onChange={e => setForm(f => ({ ...f, sshKeyPath: e.target.value }))} placeholder="/root/.ssh/id_rsa" />
          </div>
          <div>
            <Label htmlFor="provider">Provider</Label>
            <Input id="provider" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="e.g. Hetzner, DigitalOcean" />
          </div>
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Add Node"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecentralizedTab() {
  const {
    data: statusData,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useSWR("/api/discoveryStatus", () =>
    getDiscoveryStatus().then((r) => r.obj as DiscoveryStatus)
  );

  const {
    data: peersData,
    isLoading: peersLoading,
    mutate: mutatePeers,
  } = useSWR("/api/discoveryPeers", () =>
    getDiscoveryPeers().then((r) => r.obj as PeerNode[])
  );

  const [toggling, setToggling] = useState(false);
  const [peerAddr, setPeerAddr] = useState("");
  const [addingPeer, setAddingPeer] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);

  const status = statusData ?? { running: false, memberCount: 0 };
  const peers = peersData ?? [];

  async function handleToggle() {
    setToggling(true);
    try {
      if (status.running) {
        await discoveryLeave();
      } else {
        await discoveryJoin();
      }
      mutateStatus();
      mutatePeers();
    } finally {
      setToggling(false);
    }
  }

  async function handleAddPeer(e: React.FormEvent) {
    e.preventDefault();
    setPeerError(null);
    setAddingPeer(true);
    try {
      const res = await discoveryAddPeer(peerAddr);
      if (!res.success) {
        setPeerError(res.msg || "Failed to join peer");
      } else {
        setPeerAddr("");
        mutatePeers();
        mutateStatus();
      }
    } finally {
      setAddingPeer(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Gossip Cluster Status
            {statusLoading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <Badge variant={status.running ? "default" : "secondary"}>
                {status.running ? "Active" : "Inactive"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            When active, this node participates in a gossip cluster (UDP{" "}
            <code className="rounded bg-muted px-1">7946</code> by default) and
            discovers other AetherProxy instances without a central server.
            Bootstrap peers can be configured via the{" "}
            <code className="rounded bg-muted px-1">AETHER_GOSSIP_BOOTSTRAP</code>{" "}
            environment variable.
          </p>
          {status.running && (
            <p className="text-xs text-muted-foreground">
              Known cluster members: <strong>{status.memberCount}</strong>
            </p>
          )}
          <Button
            size="sm"
            variant={status.running ? "destructive" : "default"}
            disabled={toggling || statusLoading}
            onClick={handleToggle}
          >
            {toggling
              ? "…"
              : status.running
              ? "Leave decentralized network"
              : "Join decentralized network"}
          </Button>
        </CardContent>
      </Card>

      {/* Manual peer addition */}
      {status.running && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Add Bootstrap Peer</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddPeer} className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="peerAddr" className="text-xs">
                  Peer address (host:port)
                </Label>
                <Input
                  id="peerAddr"
                  value={peerAddr}
                  onChange={(e) => setPeerAddr(e.target.value)}
                  placeholder="192.0.2.1:7946"
                  className="mt-1"
                />
              </div>
              <Button type="submit" size="sm" disabled={addingPeer || !peerAddr}>
                {addingPeer ? "…" : "Join"}
              </Button>
            </form>
            {peerError && (
              <p className="mt-1 text-xs text-destructive">{peerError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Discovered peers */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Discovered Peers</h2>
        {peersLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : peers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No peers discovered yet.{" "}
            {!status.running && "Join the decentralized network to start."}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {peers.map((peer) => (
              <Card key={peer.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    {peer.name || peer.address}
                    <PeerStatusBadge status={peer.status} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1">
                  <p>
                    {peer.address}:{peer.gossipPort}
                  </p>
                  {peer.version && <p>Version: {peer.version}</p>}
                  <p>
                    Last seen:{" "}
                    {peer.lastSeen > 0
                      ? new Date(peer.lastSeen * 1000).toLocaleTimeString()
                      : "—"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NodesPage() {
  const { data: inboundData, isLoading: inboundsLoading, error: inboundsError } = useSWR("/api/inbounds", () =>
    loadPartial(["inbounds"]).then((r) => r.obj as { inbounds?: Inbound[] })
  );
  const { data: nodesData, isLoading: nodesLoading, error: nodesError, mutate: mutateNodes } = useSWR("/api/nodes", () =>
    getNodes().then(r => r.obj as Node[])
  );

  const inbounds = inboundData?.inbounds ?? [];
  const nodes = nodesData ?? [];

  async function handleDelete(id: number) {
    if (!confirm("Delete this node?")) return;
    await deleteNode(id);
    mutateNodes();
  }

  async function handleDeploy(id: number) {
    await deployNode(id);
    alert("Deploy triggered.");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nodes</h1>

      <Tabs defaultValue="remote">
        <TabsList>
          <TabsTrigger value="remote">Remote Nodes (Phase 2)</TabsTrigger>
          <TabsTrigger value="decentralized">Decentralized Network</TabsTrigger>
          <TabsTrigger value="inbounds">Local Inbounds</TabsTrigger>
        </TabsList>

        <TabsContent value="remote" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage remote VPS nodes. AetherProxy health-checks them every 30s.
            </p>
            <AddNodeDialog onCreated={() => mutateNodes()} />
          </div>

          {nodesError && <p className="text-sm text-destructive">Failed to load nodes.</p>}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {nodesLoading
              ? Array.from({ length: 2 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-32" /></CardHeader>
                    <CardContent><Skeleton className="h-4 w-20" /></CardContent>
                  </Card>
                ))
              : nodes.map((node) => (
                  <Card key={node.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        {node.name}
                        <NodeStatusBadge status={node.status} />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-1">
                      <p>{node.host}:{node.sshPort}</p>
                      {node.provider && <p>Provider: {node.provider}</p>}
                      {node.lastPing > 0 && (
                        <p>Last ping: {new Date(node.lastPing * 1000).toLocaleTimeString()}</p>
                      )}
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => handleDeploy(node.id)}>
                          Deploy
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(node.id)}>
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            {!nodesLoading && nodes.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">
                No remote nodes yet. Click &quot;Add Node&quot; to register a VPS.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="decentralized" className="pt-2">
          <DecentralizedTab />
        </TabsContent>

        <TabsContent value="inbounds" className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Local sing-box inbounds on this server.
          </p>

          {inboundsError && <p className="text-sm text-destructive">Failed to load inbounds.</p>}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inboundsLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-32" /></CardHeader>
                    <CardContent><Skeleton className="h-4 w-20" /></CardContent>
                  </Card>
                ))
              : inbounds.map((ib) => (
                  <Card key={ib.tag}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        {ib.tag}
                        <Badge variant={ib.enabled === false ? "secondary" : "default"}>
                          {ib.enabled === false ? "disabled" : "active"}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      <p>Protocol: {ib.type}</p>
                      {ib.listen_port && <p>Port: {ib.listen_port}</p>}
                    </CardContent>
                  </Card>
                ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface Inbound {
  tag: string;
  type: string;
  listen_port?: number;
  enabled?: boolean;
}

function NodeStatusBadge({ status }: { status: Node["status"] }) {
  const variant =
    status === "online" ? "default" : status === "offline" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function AddNodeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", host: "", sshPort: "22", sshKeyPath: "", provider: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createNode({ ...form, sshPort: Number(form.sshPort) });
      onCreated();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add Node</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Remote Node</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="host">Host / IP</Label>
            <Input id="host" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="sshPort">SSH Port</Label>
            <Input id="sshPort" type="number" value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sshKeyPath">SSH Key Path (on server)</Label>
            <Input id="sshKeyPath" value={form.sshKeyPath} onChange={e => setForm(f => ({ ...f, sshKeyPath: e.target.value }))} placeholder="/root/.ssh/id_rsa" />
          </div>
          <div>
            <Label htmlFor="provider">Provider</Label>
            <Input id="provider" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="e.g. Hetzner, DigitalOcean" />
          </div>
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Add Node"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function NodesPage() {
  const { data: inboundData, isLoading: inboundsLoading, error: inboundsError } = useSWR("/api/inbounds", () =>
    loadPartial(["inbounds"]).then((r) => r.obj as { inbounds?: Inbound[] })
  );
  const { data: nodesData, isLoading: nodesLoading, error: nodesError, mutate: mutateNodes } = useSWR("/api/nodes", () =>
    getNodes().then(r => r.obj as Node[])
  );

  const inbounds = inboundData?.inbounds ?? [];
  const nodes = nodesData ?? [];

  async function handleDelete(id: number) {
    if (!confirm("Delete this node?")) return;
    await deleteNode(id);
    mutateNodes();
  }

  async function handleDeploy(id: number) {
    await deployNode(id);
    alert("Deploy triggered.");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nodes</h1>

      <Tabs defaultValue="remote">
        <TabsList>
          <TabsTrigger value="remote">Remote Nodes (Phase 2)</TabsTrigger>
          <TabsTrigger value="inbounds">Local Inbounds</TabsTrigger>
        </TabsList>

        <TabsContent value="remote" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage remote VPS nodes. AetherProxy health-checks them every 30s.
            </p>
            <AddNodeDialog onCreated={() => mutateNodes()} />
          </div>

          {nodesError && <p className="text-sm text-destructive">Failed to load nodes.</p>}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {nodesLoading
              ? Array.from({ length: 2 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-32" /></CardHeader>
                    <CardContent><Skeleton className="h-4 w-20" /></CardContent>
                  </Card>
                ))
              : nodes.map((node) => (
                  <Card key={node.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        {node.name}
                        <NodeStatusBadge status={node.status} />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-1">
                      <p>{node.host}:{node.sshPort}</p>
                      {node.provider && <p>Provider: {node.provider}</p>}
                      {node.lastPing > 0 && (
                        <p>Last ping: {new Date(node.lastPing * 1000).toLocaleTimeString()}</p>
                      )}
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => handleDeploy(node.id)}>
                          Deploy
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(node.id)}>
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            {!nodesLoading && nodes.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">
                No remote nodes yet. Click &quot;Add Node&quot; to register a VPS.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="inbounds" className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Local sing-box inbounds on this server.
          </p>

          {inboundsError && <p className="text-sm text-destructive">Failed to load inbounds.</p>}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inboundsLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-32" /></CardHeader>
                    <CardContent><Skeleton className="h-4 w-20" /></CardContent>
                  </Card>
                ))
              : inbounds.map((ib) => (
                  <Card key={ib.tag}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        {ib.tag}
                        <Badge variant={ib.enabled === false ? "secondary" : "default"}>
                          {ib.enabled === false ? "disabled" : "active"}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      <p>Protocol: {ib.type}</p>
                      {ib.listen_port && <p>Port: {ib.listen_port}</p>}
                    </CardContent>
                  </Card>
                ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
