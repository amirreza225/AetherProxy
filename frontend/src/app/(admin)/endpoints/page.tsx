"use client";

import useSWR from "swr";
import { useState } from "react";
import { getEndpoints, saveEndpoint, type Endpoint } from "@/lib/api";
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
import { PlusCircle, Pencil, Trash2 } from "lucide-react";

export default function EndpointsPage() {
  const t = useTranslations("endpoints");
  const tCommon = useTranslations("common");

  const { data: endpoints, error, isLoading, mutate } = useSWR<Endpoint[]>(
    "/api/endpoints",
    () => getEndpoints()
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [optionsJson, setOptionsJson] = useState("{}");
  const [saving, setSaving] = useState(false);

  function openAdd() {
    setEditing(null);
    setTag("");
    setType("");
    setOptionsJson("{}");
    setDialogOpen(true);
  }

  function openEdit(ep: Endpoint) {
    setEditing(ep);
    setTag(ep.tag);
    setType(ep.type);
    const { id: _id, tag: _tag, type: _type, ...rest } = ep;
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
      const res = await saveEndpoint(action, data);
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

  async function handleDelete(ep: Endpoint) {
    try {
      const res = await saveEndpoint("del", { id: ep.id, tag: ep.tag });
      if (!res.success) throw new Error(res.msg);
      toast.success(t("deleteSuccess"));
      await mutate();
    } catch (err) {
      toast.error(t("deleteError"), { description: String(err) });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
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
            {(endpoints ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-8">
                  {t("noEndpoints")}
                </TableCell>
              </TableRow>
            )}
            {(endpoints ?? []).map((ep) => (
              <TableRow key={ep.id}>
                <TableCell className="font-mono text-sm">{ep.tag}</TableCell>
                <TableCell className="text-sm">{ep.type}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(ep)}>
                      <Pencil className="size-4" />
                      <span className="sr-only">{t("edit")}</span>
                    </Button>
                    <ConfirmDialog
                      title={t("confirmDelete")}
                      confirmLabel={t("delete")}
                      cancelLabel={tCommon("cancel")}
                      onConfirm={() => handleDelete(ep)}
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
              <Input value={tag} onChange={(e) => setTag(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("type")}</Label>
              <Input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="warp / wireguard"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("optionsJson")}</Label>
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
