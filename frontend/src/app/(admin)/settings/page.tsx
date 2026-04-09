"use client";

import useSWR from "swr";
import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/lib/api";
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

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
                  className={`text-sm ${msg.ok ? "text-green-600" : "text-destructive"}`}
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
    </div>
  );
}
