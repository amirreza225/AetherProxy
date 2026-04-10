"use client";

import useSWR from "swr";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  getInbounds,
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
import { toast } from "sonner";

function NodeStatusBadge({ status }: { status: Node["status"] }) {
  const t = useTranslations("nodes");
  const variant =
    status === "online" ? "default" : status === "offline" ? "destructive" : "secondary";
  return <Badge variant={variant}>{t(status as Parameters<typeof t>[0])}</Badge>;
}

function PeerStatusBadge({ status }: { status: PeerNode["status"] }) {
  const t = useTranslations("nodes");
  const variant =
    status === "alive"
      ? "default"
      : status === "dead"
      ? "destructive"
      : "secondary";

  const labels: Record<PeerNode["status"], string> = {
    alive: t("peerAlive"),
    suspect: t("peerSuspect"),
    dead: t("peerDead"),
    left: t("peerLeft"),
  };

  return <Badge variant={variant}>{labels[status]}</Badge>;
}

function DecentralizedTab() {
  const t = useTranslations("nodes");
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
        setPeerError(res.msg || t("joinPeerError"));
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
            {t("gossipStatus")}
            {statusLoading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <Badge variant={status.running ? "default" : "secondary"}>
                {status.running ? t("clusterActive") : t("clusterInactive")}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("gossipDescriptionBefore")} (UDP{" "}
            <code className="rounded bg-muted px-1">7946</code> {t("byDefault")}) and
            {" "}{t("gossipDescriptionAfter")}
            {" "}{t("bootstrapPeersPrefix")}{" "}
            <code className="rounded bg-muted px-1">AETHER_GOSSIP_BOOTSTRAP</code>{" "}
            {t("bootstrapPeersSuffix")}
          </p>
          {status.running && (
            <p className="text-xs text-muted-foreground">
              {t("knownClusterMembers")}: <strong>{status.memberCount}</strong>
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
              ? t("leaveNetwork")
              : t("joinNetwork")}
          </Button>
        </CardContent>
      </Card>

      {/* Manual peer addition */}
      {status.running && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("addBootstrapPeer")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddPeer} className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="peerAddr" className="text-xs">
                  {t("peerAddress")}
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
                  {addingPeer ? "…" : t("join")}
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
        <h2 className="text-sm font-medium">{t("discoveredPeers")}</h2>
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
            {t("noDiscoveredPeers")}{" "}
            {!status.running && t("joinNetworkToStart")}
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
                  {peer.version && <p>{t("version")}: {peer.version}</p>}
                  <p>
                    {t("lastSeen")}:{" "}
                    {peer.lastSeen > 0
                      ? new Date(peer.lastSeen * 1000).toLocaleTimeString()
                      : t("notAvailable")}
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
  const t = useTranslations("nodes");
  const { data: inboundData, isLoading: inboundsLoading, error: inboundsError } = useSWR("/api/inbounds", () =>
    getInbounds()
  );
  const { data: nodesData, isLoading: nodesLoading, error: nodesError, mutate: mutateNodes } = useSWR("/api/nodes", () =>
    getNodes().then(r => r.obj as Node[])
  );

  const inbounds = inboundData ?? [];
  const nodes = nodesData ?? [];

  async function handleDelete(id: number) {
    if (!confirm(t("confirmDeleteNode"))) return;
    try {
      await deleteNode(id);
      toast.success(t("deleteSuccess"));
      mutateNodes();
    } catch {
      toast.error(t("deleteError"));
    }
  }

  async function handleDeploy(id: number) {
    try {
      await deployNode(id);
      toast.success(t("deployTriggered"));
    } catch {
      toast.error(t("deployError"));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <Tabs defaultValue="remote">
        <TabsList>
          <TabsTrigger value="remote">{t("remoteNodesTab")}</TabsTrigger>
          <TabsTrigger value="decentralized">{t("decentralizedTab")}</TabsTrigger>
          <TabsTrigger value="inbounds">{t("localInboundsTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="remote" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t("remoteNodesDescription")}
            </p>
            <AddNodeDialog onCreated={() => mutateNodes()} />
          </div>

          {nodesError && <p className="text-sm text-destructive">{t("loadNodesError")}</p>}

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
                      {node.provider && <p>{t("provider")}: {node.provider}</p>}
                      {node.lastPing > 0 && (
                        <p>{t("lastPing")}: {new Date(node.lastPing * 1000).toLocaleTimeString()}</p>
                      )}
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => handleDeploy(node.id)}>
                          {t("deploy")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(node.id)}>
                          {t("delete")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            {!nodesLoading && nodes.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">
                {t("noRemoteNodes")}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="decentralized" className="pt-2">
          <DecentralizedTab />
        </TabsContent>

        <TabsContent value="inbounds" className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            {t("localInboundsDescription")}
          </p>

          {inboundsError && <p className="text-sm text-destructive">{t("loadInboundsError")}</p>}

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
                          {ib.enabled === false ? t("disabled") : t("active")}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      <p>{t("protocol")}: {ib.type}</p>
                      {ib.listen_port && <p>{t("port")}: {ib.listen_port}</p>}
                    </CardContent>
                  </Card>
                ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AddNodeDialog({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("nodes");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", host: "", sshPort: "22", sshKeyPath: "", provider: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await createNode({ ...form, sshPort: Number(form.sshPort) });
      if (!res.success) {
        setError(res.msg || t("addNodeError"));
        return;
      }
      onCreated();
      setOpen(false);
      setForm({ name: "", host: "", sshPort: "22", sshKeyPath: "", provider: "" });
    } catch {
      setError(t("addNodeError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
      <DialogTrigger render={<Button size="sm" />}>{t("add")}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addRemoteNode")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="host">{t("hostIp")}</Label>
            <Input id="host" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="sshPort">{t("sshPort")}</Label>
            <Input id="sshPort" type="number" value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sshKeyPath">{t("sshKeyPath")}</Label>
            <Input id="sshKeyPath" value={form.sshKeyPath} onChange={e => setForm(f => ({ ...f, sshKeyPath: e.target.value }))} placeholder="/root/.ssh/id_rsa" />
          </div>
          <div>
            <Label htmlFor="provider">{t("provider")}</Label>
            <Input id="provider" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="e.g. Hetzner, DigitalOcean" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? tc("saving") : t("add")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
