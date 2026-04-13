"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  getPlugins,
  setPluginEnabled,
  setPluginConfig,
  type PluginInfo,
} from "@/lib/api";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const TRANSPORT_PLUGINS = new Set(["h2disguise", "wscdn", "grpcobfs", "mux"]);

function PluginCard({
  plugin,
  conflictNames,
  onMutate,
}: {
  plugin: PluginInfo;
  conflictNames: string;
  onMutate: () => void;
}) {
  const t = useTranslations("plugins");
  const tc = useTranslations("common");
  const [configText, setConfigText] = useState(
    JSON.stringify(plugin.config, null, 2)
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const isTransport = TRANSPORT_PLUGINS.has(plugin.name);
  const hasConflict = isTransport && conflictNames.length > 0;

  async function handleToggle() {
    setToggling(true);
    try {
      await setPluginEnabled(plugin.name, !plugin.enabled);
      toast.success(plugin.enabled ? t("disableSuccess") : t("enableSuccess"));
      onMutate();
    } catch {
      toast.error(t("toggleError"));
    } finally {
      setToggling(false);
    }
  }

  async function handleSaveConfig() {
    setConfigError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText);
    } catch {
      setConfigError(t("invalidJson"));
      return;
    }
    try {
      setSaving(true);
      const res = await setPluginConfig(plugin.name, parsed);
      if (!res.success) {
        setConfigError(res.msg || t("saveConfigError"));
      } else {
        toast.success(t("saveConfigSuccess"));
        onMutate();
      }
    } catch {
      setConfigError(t("saveConfigError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {plugin.name}
            {hasConflict && plugin.enabled && (
              <Badge variant="secondary" className="text-amber-600 border-amber-300 bg-amber-50 text-xs">
                {t("conflictsWith")}
              </Badge>
            )}
          </span>
          <Badge variant={plugin.enabled ? "default" : "secondary"}>
            {plugin.enabled ? t("enabled") : t("disabled")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{plugin.description}</p>

        {hasConflict && plugin.enabled && (
          <p className="text-xs text-amber-600">
            {t("conflictsWithActive", { names: conflictNames })}
          </p>
        )}

        <div className="space-y-1">
          <Label className="text-xs">{t("configJson")}</Label>
          <Textarea
            className="font-mono text-xs min-h-30 resize-y"
            value={configText}
            onChange={(e) => {
              setConfigText(e.target.value);
              setConfigError(null);
            }}
            spellCheck={false}
          />
          {configError && (
            <p className="text-xs text-destructive">{configError}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={plugin.enabled ? "destructive" : "default"}
            disabled={toggling}
            onClick={handleToggle}
          >
            {toggling
              ? "..."
              : plugin.enabled
              ? t("disable")
              : t("enable")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={handleSaveConfig}
          >
            {saving ? tc("loading") : tc("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PluginsPage() {
  const t = useTranslations("plugins");
  const { data, isLoading, error, mutate } = useSWR("/api/plugins", () =>
    getPlugins().then((r) => (r.obj as PluginInfo[]) ?? [])
  );

  const plugins = data ?? [];

  const enabledTransportPlugins = plugins
    .filter((p) => TRANSPORT_PLUGINS.has(p.name) && p.enabled)
    .map((p) => p.name);

  const hasTransportConflict = enabledTransportPlugins.length > 1;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("description")}
      </p>

      {error && (
        <p className="text-sm text-destructive">{t("loadError")}</p>
      )}

      {hasTransportConflict && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ {t("transportConflictWarning", { names: enabledTransportPlugins.join(", ") })}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-muted-foreground text-sm">{t("noPlugins")}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {plugins.map((p) => {
            const otherEnabled = enabledTransportPlugins.filter((n) => n !== p.name);
            return (
              <PluginCard
                key={p.name}
                plugin={p}
                conflictNames={otherEnabled.join(", ")}
                onMutate={mutate}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}


