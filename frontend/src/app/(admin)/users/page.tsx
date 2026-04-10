"use client";

import useSWR from "swr";
import { useState } from "react";
import {
  getClients,
  getInbounds,
  createClient,
  updateClient,
  deleteClient,
  clientSubUrl,
  type Client,
  type Inbound,
} from "@/lib/api";
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatExpiry(unix: number): string {
  if (!unix || unix === 0) return "Never";
  return new Date(unix * 1000).toLocaleDateString();
}

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button size="sm" variant="outline" onClick={handleCopy}>
      {copied ? copiedLabel : label}
    </Button>
  );
}

const emptyForm = (): Omit<Client, "id" | "down" | "up" | "totalDown" | "totalUp"> => ({
  enable: true,
  name: "",
  volume: 0,
  expiry: 0,
  autoReset: false,
  resetDays: 30,
  inbounds: [],
  desc: "",
  group: "",
  delayStart: false,
});

function ClientDialog({
  initialData,
  inboundList,
  onSaved,
  trigger,
}: {
  initialData?: Client;
  inboundList: Inbound[];
  onSaved: () => void;
  trigger: React.ReactElement;
}) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(
    initialData
      ? {
          enable: initialData.enable,
          name: initialData.name,
          volume: initialData.volume,
          expiry: initialData.expiry,
          autoReset: initialData.autoReset,
          resetDays: initialData.resetDays,
          inbounds: initialData.inbounds,
          desc: initialData.desc ?? "",
          group: initialData.group ?? "",
          delayStart: initialData.delayStart ?? false,
        }
      : emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleInbound(id: number) {
    setForm((f) => {
      const current = f.inbounds as number[];
      if (current.includes(id)) {
        return { ...f, inbounds: current.filter((x) => x !== id) };
      }
      return { ...f, inbounds: [...current, id] };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let res;
      if (initialData) {
        res = await updateClient({ ...initialData, ...form });
      } else {
        res = await createClient(form);
      }
      if (!res.success) {
        setError(res.msg || "Failed to save");
        return;
      }
      onSaved();
      setOpen(false);
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const expiryDate =
    form.expiry > 0
      ? new Date(form.expiry * 1000).toISOString().slice(0, 10)
      : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="cname">{t("clientName")}</Label>
            <Input
              id="cname"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label htmlFor="cdesc">{t("desc")}</Label>
            <Input
              id="cdesc"
              value={form.desc ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
              placeholder="Optional description"
            />
          </div>
          <div>
            <Label htmlFor="cgroup">{t("group")}</Label>
            <Input
              id="cgroup"
              value={form.group ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
              placeholder="Optional group name"
            />
          </div>
          <div>
            <Label>{t("inbounds")}</Label>
            {inboundList.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">{t("noInbounds")}</p>
            ) : (
              <div className="mt-1 space-y-1 rounded-md border p-2">
                {inboundList.map((inb) => {
                  const selected = (form.inbounds as number[]).includes(inb.id);
                  return (
                    <label key={inb.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleInbound(inb.id)}
                      />
                      <span className="font-mono text-sm">{inb.tag}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{inb.type}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="volume">
              {t("trafficQuota")} (GB, 0 = {t("unlimited")})
            </Label>
            <Input
              id="volume"
              type="number"
              min={0}
              step={0.1}
              value={form.volume > 0 ? form.volume / 1024 ** 3 : 0}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  volume: Math.round(Number(e.target.value) * 1024 ** 3),
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="expiry">
              {t("expiryDate")} (leave blank = never)
            </Label>
            <Input
              id="expiry"
              type="date"
              value={expiryDate}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  expiry: e.target.value
                    ? Math.floor(new Date(e.target.value).getTime() / 1000)
                    : 0,
                }))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="autoReset"
              type="checkbox"
              checked={form.autoReset}
              onChange={(e) =>
                setForm((f) => ({ ...f, autoReset: e.target.checked }))
              }
            />
            <Label htmlFor="autoReset">{t("autoReset")}</Label>
            {form.autoReset && (
              <Input
                type="number"
                min={1}
                className="w-20"
                value={form.resetDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, resetDays: Number(e.target.value) }))
                }
              />
            )}
            {form.autoReset && (
              <span className="text-sm text-muted-foreground">{t("days")}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                id="enable"
                type="checkbox"
                checked={form.enable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, enable: e.target.checked }))
                }
              />
              <Label htmlFor="enable">{t("enabled")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="delayStart"
                type="checkbox"
                checked={form.delayStart ?? false}
                onChange={(e) =>
                  setForm((f) => ({ ...f, delayStart: e.target.checked }))
                }
              />
              <Label htmlFor="delayStart">{t("delayStart")}</Label>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? tc("loading") : tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const t = useTranslations("users");

  const { data, isLoading, error, mutate } = useSWR("/api/clients", () =>
    getClients().then((r) => {
      const obj = r.obj as unknown;
      if (Array.isArray(obj)) return obj;
      if (
        obj &&
        typeof obj === "object" &&
        Array.isArray((obj as { clients?: unknown[] }).clients)
      ) {
        return (obj as { clients: Client[] }).clients;
      }
      return [] as Client[];
    })
  );

  const { data: inboundList = [] } = useSWR("/api/inbounds", getInbounds);

  async function handleDelete(id: number) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await deleteClient(id);
      mutate();
    } catch {
      // Keep UX simple on this screen; API errors are surfaced on next refresh.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <ClientDialog
          inboundList={inboundList}
          onSaved={() => mutate()}
          trigger={<Button size="sm">{t("add")}</Button>}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{t("loadError")}</p>
      )}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("id")}</TableHead>
              <TableHead>{t("clientName")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("trafficQuota")}</TableHead>
              <TableHead>{t("used")}</TableHead>
              <TableHead>{t("expiryDate")}</TableHead>
              <TableHead>{t("subLink")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : (data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.id}
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant={c.enable ? "default" : "secondary"}>
                        {c.enable ? t("active") : t("inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.volume > 0 ? formatBytes(c.volume) : t("unlimited")}
                    </TableCell>
                    <TableCell>
                      {formatBytes(c.totalDown + c.totalUp)}
                    </TableCell>
                    <TableCell>{formatExpiry(c.expiry)}</TableCell>
                    <TableCell>
                      <CopyButton
                        value={clientSubUrl(c.name)}
                        label={t("copySubLink")}
                        copiedLabel={t("subLinkCopied")}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <ClientDialog
                          initialData={c}
                          inboundList={inboundList}
                          onSaved={() => mutate()}
                          trigger={
                            <Button size="sm" variant="outline">
                              {t("edit")}
                            </Button>
                          }
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(c.id)}
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

