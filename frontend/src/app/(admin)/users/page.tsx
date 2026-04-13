"use client";

import useSWR from "swr";
import { useState } from "react";
import {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  clientSubUrl,
  getInbounds,
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
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ── Credential helpers ────────────────────────────────────────────────────────

function generatePassword(): string {
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...Array.from(arr)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateClientConfig(): Record<string, unknown> {
  const uuid = crypto.randomUUID();
  const pass = generatePassword();
  return {
    vless:        { uuid, flow: "xtls-rprx-vision" },
    vmess:        { uuid },
    trojan:       { password: pass },
    shadowsocks:  { password: pass },
    hysteria2:    { password: pass },
    hysteria:     { auth_str: pass },
    tuic:         { uuid, password: pass },
    anytls:       { password: pass },
    naive:        { username: "user", password: pass },
    socks:        { username: "user", password: pass },
    http:         { username: "user", password: pass },
    mixed:        { username: "user", password: pass },
  };
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

// ── QR code dialog ────────────────────────────────────────────────────────────

function QrButton({ url, label, dialogTitle, dialogHint }: { url: string; label: string; dialogTitle: string; dialogHint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">{label}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border p-4">
            <QRCodeCanvas value={url} size={240} />
          </div>
          <p className="break-all rounded bg-muted px-3 py-2 font-mono text-xs">{url}</p>
          <p className="text-xs text-muted-foreground">{dialogHint}</p>
        </div>
      </DialogContent>
    </Dialog>
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
          inbounds: initialData.inbounds ?? [],
          desc: initialData.desc ?? "",
          group: initialData.group ?? "",
          delayStart: initialData.delayStart ?? false,
        }
      : emptyForm()
  );
  // For new clients, pre-populate credentials. For edits, leave empty (backend preserves existing).
  const [configJson, setConfigJson] = useState<string>(() =>
    initialData ? "" : JSON.stringify(generateClientConfig(), null, 2)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleInbound(id: number) {
    setForm((f) => {
      const current = (f.inbounds ?? []) as number[];
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
      let config: Record<string, unknown> | undefined;
      const trimmed = configJson.trim();
      if (trimmed) {
        try {
          config = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          setError(t("credentialsInvalidJson"));
          setSaving(false);
          return;
        }
      }
      let res;
      if (initialData) {
        // config is intentionally omitted when empty so the backend preserves existing credentials.
        res = await updateClient({ ...initialData, ...form, ...(config ? { config } : {}) });
      } else {
        // Always supply credentials for new clients.
        res = await createClient({ ...form, config: config ?? generateClientConfig() });
      }
      if (!res.success) {
        setError(res.msg || "Failed to save");
        return;
      }
      onSaved();
      toast.success(initialData ? t("editSuccess") : t("addSuccess"));
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
                  const selected = ((form.inbounds ?? []) as number[]).includes(inb.id);
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

          {/* ── Credentials ─────────────────────────────────────────────── */}
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="configJson" className="text-sm font-medium">
                {t("credentials")}
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfigJson(JSON.stringify(generateClientConfig(), null, 2))}
              >
                {t("regenerate")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("credentialsHint")}</p>
            <textarea
              id="configJson"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs h-40 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              spellCheck={false}
            />
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
  const tc = useTranslations("common");

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

  const { data: inboundList = [] } = useSWR("/api/inbounds", () => getInbounds());

  async function handleDelete(id: number) {
    try {
      const res = await deleteClient(id);
      if (!res.success) {
        toast.error(res.msg || t("deleteError"));
        return;
      }
      mutate();
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteError"));
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
                      <div className="flex gap-2">
                        <CopyButton
                          value={clientSubUrl(c.name)}
                          label={t("copySubLink")}
                          copiedLabel={t("subLinkCopied")}
                        />
                        <QrButton
                          url={clientSubUrl(c.name)}
                          label={t("showQr")}
                          dialogTitle={t("qrDialogTitle")}
                          dialogHint={t("qrDialogHint")}
                        />
                      </div>
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
                        <ConfirmDialog
                          title={t("confirmDelete")}
                          confirmLabel={t("delete")}
                          cancelLabel={tc("cancel")}
                          onConfirm={() => handleDelete(c.id)}
                        >
                          <Button size="sm" variant="destructive">
                            {t("delete")}
                          </Button>
                        </ConfirmDialog>
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

