"use client";

import useSWR from "swr";
import { loadPartial } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Inbound {
  tag: string;
  type: string;
  listen_port?: number;
  enabled?: boolean;
}

export default function NodesPage() {
  const { data, isLoading, error } = useSWR("/api/inbounds", () =>
    loadPartial(["inbounds"]).then((r) => r.obj as { inbounds?: Inbound[] })
  );

  const inbounds = data?.inbounds ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nodes / Inbounds</h1>
      <p className="text-sm text-muted-foreground">
        Phase 1 shows sing-box inbounds. Multi-VPS node management arrives in
        Phase 2.
      </p>

      {error && (
        <p className="text-sm text-destructive">Failed to load inbounds.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-20" />
                </CardContent>
              </Card>
            ))
          : inbounds.map((ib) => (
              <Card key={ib.tag}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    {ib.tag}
                    <Badge
                      variant={ib.enabled === false ? "secondary" : "default"}
                    >
                      {ib.enabled === false ? "disabled" : "active"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p>Protocol: {ib.type}</p>
                  {ib.listen_port && <p>Port: {ib.listen_port}</p>}
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}
