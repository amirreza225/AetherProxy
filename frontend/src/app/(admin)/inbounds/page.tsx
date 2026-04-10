"use client";

import useSWR from "swr";
import { useState } from "react";
import {
  getInbounds,
  saveInbound,
  deleteInbound,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INBOUND_TYPES = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "tuic",
  "naive",
  "shadowtls",
  "http",
  "socks",
  "mixed",
  "tun",
  "direct",
  "redirect",
  "tproxy",
];

type InboundFormData = Omit<Inbound, "users" | "id"> & { id?: number };

function emptyForm(): InboundFormData {
  return {
    type: "vless",
    tag: "",
    listen: "0.0.0.0",
    listen_port: 443,
    tls_id: 0,
  };
}

function toFormData(inbound: Inbound): InboundFormData {
  // Extract known fields; put the rest into advancedJson
  const { id, type, tag, listen, listen_port, tls_id, users: _users, ...rest } = inbound;
  return { id, type, tag, listen: listen ?? "0.0.0.0", listen_port: listen_port ?? 443, tls_id: tls_id ?? 0, ...rest };
}

function InboundDialog({
  initialData,
  onSaved,
  trigger,
}: {
  initialData?: Inbound;
  onSaved: () => void;
  trigger: React.ReactElement;
}) {
  const t = useTranslations("inbounds");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<InboundFormData>(
    initialData ? toFormData(initialData) : emptyForm()
  );
  // Advanced fields (everything not in the fixed form)
  const [advancedJson, setAdvancedJson] = useState<string>(() => {
    if (!initialData) return "{}";
    const { type: _t, tag: _tag, listen: _l, listen_port: _lp, tls_id: _tid, id: _id, users: _u, ...rest } = initialData;
    return Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "{}";
  });
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validateJson(value: string): Record<string, unknown> | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const extra = validateJson(advancedJson);
    if (!extra) {
      setJsonError(t("invalidJson"));
      return;
    }
    setJsonError(null);

    setSaving(true);
    try {
      const payload: Omit<Inbound, "users"> = {
        ...extra,
        type: form.type,
        tag: form.tag,
        listen: form.listen,
        listen_port: Number(form.listen_port),
        tls_id: Number(form.tls_id ?? 0),
        ...(initialData ? { id: initialData.id } : {}),
      };

      const action = initialData ? "edit" : "new";
      const res = await saveInbound(action, payload);
      if (!res.success) {
        setError(res.msg || t("saveError"));
        return;
      }
      onSaved();
      setOpen(false);
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v) {
      // Reset form when re-opening for edit
      if (initialData) {
        setForm(toFormData(initialData));
        const { type: _t, tag: _tag, listen: _l, listen_port: _lp, tls_id: _tid, id: _id, users: _u, ...rest } = initialData;
        setAdvancedJson(Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "{}");
      } else {
        setForm(emptyForm());
        setAdvancedJson("{}");
      }
      setError(null);
      setJsonError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="ib-type">{t("type")}</Label>
            <select
              id="ib-type"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.type as string}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {INBOUND_TYPES.map((tp) => (
                <option key={tp} value={tp}>{tp}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ib-tag">{t("tag")}</Label>
            <Input
              id="ib-tag"
              value={form.tag as string}
              onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
              required
              placeholder="e.g. vless-reality-in"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ib-listen">{t("listen")}</Label>
              <Input
                id="ib-listen"
                value={(form.listen as string | undefined) ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, listen: e.target.value }))}
                placeholder="0.0.0.0"
              />
            </div>
            <div>
              <Label htmlFor="ib-port">{t("listenPort")}</Label>
              <Input
                id="ib-port"
                type="number"
                min={1}
                max={65535}
                value={(form.listen_port as number | undefined) ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, listen_port: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ib-tls">{t("tlsId")}</Label>
            <Input
              id="ib-tls"
              type="number"
              min={0}
              value={(form.tls_id as number | undefined) ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, tls_id: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label htmlFor="ib-adv">{t("advancedJson")}</Label>
            <textarea
              id="ib-adv"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              rows={6}
              value={advancedJson}
              onChange={(e) => {
                setAdvancedJson(e.target.value);
                setJsonError(null);
              }}
            />
            {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? tc("saving") : tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InboundsPage() {
  const t = useTranslations("inbounds");

  const { data, isLoading, error, mutate } = useSWR("/api/inbounds", getInbounds);

  async function handleDelete(tag: string) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      const res = await deleteInbound(tag);
      if (!res.success) {
        alert(res.msg || t("deleteError"));
        return;
      }
      mutate();
    } catch {
      alert(t("deleteError"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <InboundDialog
          onSaved={() => mutate()}
          trigger={<Button size="sm">{t("add")}</Button>}
        />
      </div>

      {error && <p className="text-sm text-destructive">{t("loadError")}</p>}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("id")}</TableHead>
              <TableHead>{t("tag")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{t("port")}</TableHead>
              <TableHead>{t("users")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : (data ?? []).map((inbound) => (
                  <TableRow key={inbound.id}>
                    <TableCell className="text-muted-foreground text-xs">{inbound.id}</TableCell>
                    <TableCell className="font-medium font-mono text-sm">{inbound.tag}</TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{inbound.type}</span>
                    </TableCell>
                    <TableCell>{inbound.listen_port ?? "—"}</TableCell>
                    <TableCell>{inbound.users?.length ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <InboundDialog
                          initialData={inbound}
                          onSaved={() => mutate()}
                          trigger={
                            <Button size="sm" variant="outline">{t("edit")}</Button>
                          }
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(inbound.tag)}
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
