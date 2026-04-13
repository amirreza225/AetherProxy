"use client";

import useSWR from "swr";
import { useState } from "react";
import { getOutbounds, saveOutbound, checkOutbound, type Outbound } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckCircle2, XCircle, Loader2, PlusCircle, Pencil, Trash2 } from "lucide-react";

interface TestState {
  status: "idle" | "testing" | "ok" | "error";
  latency?: number;
  error?: string;
}

export default function OutboundsPage() {
  const t = useTranslations("outbounds");
  const tCommon = useTranslations("common");

  const { data: outbounds, error, isLoading, mutate } = useSWR<Outbound[]>(
    "/api/outbounds",
    () => getOutbounds()
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Outbound | null>(null);
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [optionsJson, setOptionsJson] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  function openAdd() {
    setEditing(null);
    setTag("");
    setType("");
    setOptionsJson("{}");
    setDialogOpen(true);
  }

  function openEdit(ob: Outbound) {
    setEditing(ob);
    setTag(ob.tag);
    setType(ob.type);
    const { id: _id, tag: _tag, type: _type, ...rest } = ob;
    setOptionsJson(JSON.stringify(rest, null, 2));
    setDialogOpen(true);
  }

  async function handleSave() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(optionsJson) as Record<string, unknown>;
    } catch {
      toast.error(t("invalidJson"));
      return;
    }
    setSaving(true);
    try {
      const data = editing
        ? { id: editing.id, tag, type, ...parsed }
        : { tag, type, ...parsed };
      const action = editing ? "edit" : "new";
      const res = await saveOutbound(action, data);
      if (!res.success) throw new Error(res.msg);
      toast.success(editing ? tCommon("updated") : tCommon("created"));
      setDialogOpen(false);
      await mutate();
    } catch (err) {
      toast.error(t("saveError"), { description: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ob: Outbound) {
    try {
      const res = await saveOutbound("del", { id: ob.id, tag: ob.tag });
      if (!res.success) throw new Error(res.msg);
      toast.success(t("deleteSuccess"));
      await mutate();
    } catch (err) {
      toast.error(t("deleteError"), { description: String(err) });
    }
  }

  async function handleTest(ob: Outbound) {
    setTestStates((prev) => ({ ...prev, [ob.tag]: { status: "testing" } }));
    try {
      const res = await checkOutbound(ob.tag);
      if (res.obj?.ok) {
        setTestStates((prev) => ({
          ...prev,
          [ob.tag]: { status: "ok", latency: res.obj?.latency },
        }));
      } else {
        setTestStates((prev) => ({
          ...prev,
          [ob.tag]: { status: "error", error: res.obj?.error },
        }));
      }
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [ob.tag]: { status: "error", error: String(err) },
      }));
    }
  }

  function renderTestBadge(ob: Outbound) {
    const state = testStates[ob.tag];
    if (!state || state.status === "idle") return null;
    if (state.status === "testing") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {t("testing")}
        </span>
      );
    }
    if (state.status === "ok") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 className="size-3" />
          {t("testOk", { ms: state.latency ?? 0 })}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="size-3" />
        {t("testFail")}{state.error ? `: ${state.error}` : ""}
      </span>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <PlusCircle className="size-4" />
          {t("add")}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{t("loadError")}</p>
      )}

      {!isLoading && !error && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("tag")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(outbounds ?? []).map((ob) => (
              <TableRow key={ob.id}>
                <TableCell className="font-mono text-sm">{ob.tag}</TableCell>
                <TableCell className="text-sm">{ob.type}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testStates[ob.tag]?.status === "testing"}
                      onClick={() => handleTest(ob)}
                    >
                      {testStates[ob.tag]?.status === "testing" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        t("test")
                      )}
                    </Button>
                    {renderTestBadge(ob)}
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(ob)}>
                      <Pencil className="size-4" />
                      <span className="sr-only">{t("edit")}</span>
                    </Button>
                    <ConfirmDialog
                      title={t("confirmDelete")}
                      confirmLabel={t("delete")}
                      cancelLabel={tCommon("cancel")}
                      onConfirm={() => handleDelete(ob)}
                    >
                      <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="size-4" />
                        <span className="sr-only">{t("delete")}</span>
                      </Button>
                    </ConfirmDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger className="hidden" />
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit") : t("add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("tag")}</Label>
              <p className="text-xs text-muted-foreground">{t("tagHint")}</p>
              <Input value={tag} onChange={(e) => setTag(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("type")}</Label>
              <p className="text-xs text-muted-foreground">{t("typeHint")}</p>
              <Input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="direct / block / selector / vless / hysteria2 / trojan / ss"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("optionsJson")}</Label>
              <p className="text-xs text-muted-foreground">{t("optionsJsonHint")}</p>
              <Textarea
                value={optionsJson}
                onChange={(e) => setOptionsJson(e.target.value)}
                className="font-mono text-xs"
                rows={8}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? tCommon("saving") : tCommon("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
