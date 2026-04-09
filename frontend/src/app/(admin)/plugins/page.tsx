"use client";

import useSWR from "swr";
import { getPlugins, setPluginEnabled, type PluginInfo } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PluginsPage() {
  const { data, isLoading, error, mutate } = useSWR("/api/plugins", () =>
    getPlugins().then((r) => (r.obj as PluginInfo[]) ?? [])
  );

  const plugins = data ?? [];

  async function togglePlugin(name: string, enabled: boolean) {
    await setPluginEnabled(name, !enabled);
    mutate();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Plugins</h1>
      <p className="text-sm text-muted-foreground">
        AetherProxy outbound plugins extend sing-box with custom obfuscation
        transports. Compile a plugin as a Go shared object (.so) and place it
        in the{" "}
        <code className="rounded bg-muted px-1 text-xs">plugins/</code> directory
        next to the backend binary.
      </p>

      {error && <p className="text-sm text-destructive">Failed to load plugins.</p>}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-muted-foreground text-sm">No plugins installed.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {plugins.map((p) => (
            <Card key={p.name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  {p.name}
                  <Badge variant={p.enabled ? "default" : "secondary"}>
                    {p.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{p.description}</p>
                <Button
                  size="sm"
                  variant={p.enabled ? "destructive" : "default"}
                  onClick={() => togglePlugin(p.name, p.enabled)}
                >
                  {p.enabled ? "Disable" : "Enable"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
