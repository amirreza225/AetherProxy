"use client";

import useSWR from "swr";
import { useState, useEffect } from "react";
import {
  getSettings,
  saveSettings,
  changePass,
  getPortSyncStatus,
  triggerPortSync,
  retryPortSync,
  type PortSyncStatus,
} from "@/lib/api";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const SETTING_FIELDS = [
  { key: "panelPort", type: "number" },
  { key: "singboxPort", type: "number" },
  { key: "subPort", type: "number" },
  { key: "logLevel", type: "text" },
  { key: "timeLocation", type: "text" },
  { key: "trafficAge", type: "number" },
  { key: "maxAge", type: "number" },
  { key: "subPath", type: "text" },
] as const;

export default function SettingsPage() {
  const t = useTranslations("settings");

  const { data, isLoading, error, mutate } = useSWR("/api/settings", () =>
    getSettings().then((r) => r.obj ?? {})
  );
  const {
    data: portSyncStatus,
    isLoading: portSyncLoading,
    error: portSyncError,
    mutate: mutatePortSync,
  } = useSWR("/api/portsyncStatus", () =>
    getPortSyncStatus(20).then((r) => r.obj as PortSyncStatus)
  );

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [portSyncMsg, setPortSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);

  // Change password form state
  const [passForm, setPassForm] = useState({ oldPass: "", newUsername: "", newPass: "" });
  const [passSaving, setPassSaving] = useState(false);
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Sync fetched data into form once loaded
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveSettings(form);
      if (res.success) {
        setMsg({ ok: true, text: t("saveSuccess") });
        mutate();
      } else {
        setMsg({ ok: false, text: res.msg || t("saveError") });
      }
    } catch {
      setMsg({ ok: false, text: t("saveError") });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePass(e: React.FormEvent) {
    e.preventDefault();
    setPassSaving(true);
    setPassMsg(null);
    try {
      const res = await changePass(passForm.oldPass, passForm.newUsername, passForm.newPass);
      if (res.success) {
        setPassMsg({ ok: true, text: t("changePasswordSuccess") });
        setPassForm({ oldPass: "", newUsername: "", newPass: "" });
      } else {
        setPassMsg({ ok: false, text: res.msg || t("changePasswordError") });
      }
    } catch {
      setPassMsg({ ok: false, text: t("changePasswordError") });
    } finally {
      setPassSaving(false);
    }
  }

  async function handlePortSyncNow() {
    setSyncNowBusy(true);
    setPortSyncMsg(null);
    try {
      const res = await triggerPortSync("manual-ui");
      if (res.success) {
        setPortSyncMsg({ ok: true, text: "Port sync queued" });
        mutatePortSync();
      } else {
        setPortSyncMsg({ ok: false, text: res.msg || "Failed to queue port sync" });
      }
    } catch {
      setPortSyncMsg({ ok: false, text: "Failed to queue port sync" });
    } finally {
      setSyncNowBusy(false);
    }
  }

  async function handlePortSyncRetry() {
    setRetryBusy(true);
    setPortSyncMsg(null);
    try {
      const res = await retryPortSync(30);
      if (res.success) {
        setPortSyncMsg({ ok: true, text: "Retry batch completed" });
        mutatePortSync();
      } else {
        setPortSyncMsg({ ok: false, text: res.msg || "Retry batch failed" });
      }
    } catch {
      setPortSyncMsg({ ok: false, text: "Retry batch failed" });
    } finally {
      setRetryBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {error && <p className="text-sm text-destructive">{t("loadError")}</p>}

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">{t("currentSettings")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-3">
              {SETTING_FIELDS.map(({ key, type }) => (
                <div key={key}>
                  <Label htmlFor={key}>{t(key as Parameters<typeof t>[0])}</Label>
                  <Input
                    id={key}
                    type={type}
                    value={form[key] != null ? String(form[key]) : ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        [key]:
                          type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                      }))
                    }
                  />
                </div>
              ))}

              {msg && (
                <p
                  className={`text-sm ${msg.ok ? "text-emerald-600" : "text-destructive"}`}
                >
                  {msg.text}
                </p>
              )}

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">{t("changePassword")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePass} className="space-y-3">
            <div>
              <Label htmlFor="oldPass">{t("oldPassword")}</Label>
              <Input
                id="oldPass"
                type="password"
                value={passForm.oldPass}
                onChange={(e) => setPassForm((f) => ({ ...f, oldPass: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="newUsername">{t("newUsername")}</Label>
              <Input
                id="newUsername"
                type="text"
                value={passForm.newUsername}
                onChange={(e) => setPassForm((f) => ({ ...f, newUsername: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="newPass">{t("newPassword")}</Label>
              <Input
                id="newPass"
                type="password"
                value={passForm.newPass}
                onChange={(e) => setPassForm((f) => ({ ...f, newPass: e.target.value }))}
                required
              />
            </div>
            {passMsg && (
              <p className={`text-sm ${passMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
                {passMsg.text}
              </p>
            )}
            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={passSaving}>
                {passSaving ? t("saving") : t("changePasswordSave")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Port Sync Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {portSyncLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : portSyncError ? (
            <p className="text-sm text-destructive">Failed to load port sync status</p>
          ) : (
            <>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <p><span className="font-medium">Enabled:</span> {String(portSyncStatus?.enabled)}</p>
                <p><span className="font-medium">Local enabled:</span> {String(portSyncStatus?.localEnabled)}</p>
                <p><span className="font-medium">Remote enabled:</span> {String(portSyncStatus?.remoteEnabled)}</p>
                <p><span className="font-medium">Retry seconds:</span> {portSyncStatus?.retrySeconds ?? 0}</p>
                <p><span className="font-medium">Pending tasks:</span> {portSyncStatus?.pendingTasks ?? 0}</p>
                <p><span className="font-medium">Local capability:</span> {portSyncStatus?.localCapabilityNote ?? "n/a"}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handlePortSyncNow} disabled={syncNowBusy}>
                  {syncNowBusy ? "Queuing..." : "Run Full Sync"}
                </Button>
                <Button type="button" variant="outline" onClick={handlePortSyncRetry} disabled={retryBusy}>
                  {retryBusy ? "Running..." : "Run Retry Batch"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => mutatePortSync()}>
                  Refresh
                </Button>
              </div>

              {portSyncMsg && (
                <p className={`text-sm ${portSyncMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
                  {portSyncMsg.text}
                </p>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">Pending Task Queue</p>
                {(portSyncStatus?.tasks?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending tasks.</p>
                ) : (
                  <div className="space-y-2">
                    {portSyncStatus?.tasks.map((task) => (
                      <div key={task.id} className="rounded-md border p-2 text-xs">
                        <p>
                          <span className="font-medium">#{task.id}</span>
                          {" "}scope={task.scope}
                          {" "}node={task.nodeId}
                          {" "}attempts={task.attempts}
                        </p>
                        <p className="text-muted-foreground">reason: {task.reason || "-"}</p>
                        {task.lastError ? (
                          <p className="text-destructive">last error: {task.lastError}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
