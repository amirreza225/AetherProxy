"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { getNodes } from "@/lib/api";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface LiveStats {
  onlines: Record<string, number>;
  status: {
    cpu?: number;
    mem?: { current: number; total: number };
    uptime?: number;
    down?: number;
    up?: number;
  };
}

interface TrafficPoint {
  t: number;
  down: number;
  up: number;
}

const MAX_HISTORY = 30;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");

  const [stats, setStats] = useState<LiveStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const { data: nodesData } = useSWR("/api/nodes", () =>
    getNodes().then((r) => r.obj ?? [])
  );
  const nodesOnline = (nodesData ?? []).filter((n) => n.status === "online").length;
  const nodesOffline = (nodesData ?? []).filter((n) => n.status === "offline").length;

  useEffect(() => {
    let reconnectTimer: number | null = null;
    let closedByCleanup = false;
    let reconnectAttempt = 0;

    const connect = () => {
      if (closedByCleanup) return;
      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:2095")
        .replace(/^http/, "ws");
      const token = sessionStorage.getItem("aether_token");
      const wsUrl = token
        ? `${apiBase}/api/ws/stats?token=${encodeURIComponent(token)}`
        : `${apiBase}/api/ws/stats`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data) as LiveStats;
          setStats(frame);
          setHistory((prev) => {
            const point: TrafficPoint = {
              t: Date.now(),
              down: frame.status?.down ?? 0,
              up: frame.status?.up ?? 0,
            };
            const next = [...prev, point];
            return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
          });
        } catch {
          // skip malformed
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (closedByCleanup) return;

        const delay = Math.min(10000, 1000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Trigger onclose so a reconnect can be scheduled.
        ws.close();
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const onlineCount = stats
    ? Object.values(stats.onlines ?? {}).reduce((a, b) => a + b, 0)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Badge variant={connected ? "default" : "secondary"}>
          {connected ? t("live") : t("connecting")}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("onlineClients")}
          value={onlineCount !== null ? String(onlineCount) : null}
        />
        <StatCard
          title={t("cpuUsage")}
          value={
            stats?.status.cpu != null
              ? `${stats.status.cpu.toFixed(1)} %`
              : null
          }
        />
        <StatCard
          title={t("memory")}
          value={
            stats?.status.mem
              ? `${formatBytes(stats.status.mem.current)} / ${formatBytes(stats.status.mem.total)}`
              : null
          }
        />
        {nodesData !== undefined && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("nodeStatus")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-sm font-semibold text-green-600">
                {t("nodesOnline", { count: nodesOnline })}
              </p>
              {nodesOffline > 0 && (
                <p className="text-sm font-semibold text-destructive">
                  {t("nodesOffline", { count: nodesOffline })}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("trafficHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length < 2 ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart
                data={history}
                margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis tickFormatter={formatBytes} tick={{ fontSize: 10 }} width={60} />
                <Tooltip
                  formatter={(v) => formatBytes(Number(v))}
                  labelFormatter={() => ""}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="down"
                  name="Download"
                  stroke="#10b981"
                  fill="url(#downGrad)"
                  dot={false}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="up"
                  name="Upload"
                  stroke="#3b82f6"
                  fill="url(#upGrad)"
                  dot={false}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
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
