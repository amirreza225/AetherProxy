"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface LiveStats {
  onlines: Record<string, number>;
  status: {
    cpu?: number;
    mem?: { current: number; total: number };
    uptime?: number;
  };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:2095")
      .replace(/^http/, "ws");
    const token = sessionStorage.getItem("aether_token") ?? "";
    const ws = new WebSocket(`${apiBase}/api/ws/stats`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      try {
        setStats(JSON.parse(e.data) as LiveStats);
      } catch {
        // skip malformed frames
      }
    };
    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, []);

  const onlineCount = stats
    ? Object.values(stats.onlines ?? {}).reduce((a, b) => a + b, 0)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Badge variant={connected ? "default" : "secondary"}>
          {connected ? "Live" : "Connecting…"}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Online Clients"
          value={onlineCount !== null ? String(onlineCount) : null}
        />
        <StatCard
          title="CPU Usage"
          value={
            stats?.status.cpu != null
              ? `${stats.status.cpu.toFixed(1)} %`
              : null
          }
        />
        <StatCard
          title="Memory"
          value={
            stats?.status.mem
              ? `${formatBytes(stats.status.mem.current)} / ${formatBytes(stats.status.mem.total)}`
              : null
          }
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
}: {
  title: string;
  value: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {value !== null ? (
          <p className="text-2xl font-bold">{value}</p>
        ) : (
          <Skeleton className="h-8 w-24" />
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
