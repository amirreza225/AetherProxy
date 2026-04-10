"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { getClientAuthToken, getNodes } from "@/lib/api";
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

// ── Types matching the backend WebSocket payload ─────────────────────────────

interface Onlines {
  user?: string[];
  inbound?: string[];
  outbound?: string[];
}

interface NetInfo {
  sent: number;
  recv: number;
  psent: number;
  precv: number;
}

interface MemInfo {
  current: number;
  total: number;
}

interface SingboxInfo {
  running: boolean;
  stats: {
    Uptime: number;      // seconds
    NumGoroutine: number;
    Alloc: number;
  };
}

interface DbInfo {
  clients: number;
  inbounds: number;
  outbounds: number;
  services: number;
  endpoints: number;
  clientUp: number;
  clientDown: number;
}

interface StatusPayload {
  cpu?: number;
  mem?: MemInfo;
  net?: NetInfo;
  sbd?: SingboxInfo;
  db?: DbInfo;
}

interface EvasionAlert {
  dateTime: number;
  source: string;
  protocol: string;
  autoAction: string;
  detail: string;
}

interface LiveStats {
  onlines: Onlines;
  status: StatusPayload;
  evasionAlerts?: EvasionAlert[];
}

// ── Chart data ────────────────────────────────────────────────────────────────

interface ThroughputPoint {
  t: number;
  down: number;
  up: number;
}

const MAX_HISTORY = 30;

// ── Formatters ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const t = useTranslations("dashboard");

  const [stats, setStats] = useState<LiveStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState<ThroughputPoint[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Track previous cumulative network counters to compute per-tick throughput.
  const prevNetRef = useRef<{ sent: number; recv: number } | null>(null);

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
      const rawConfiguredApiBase = process.env.NEXT_PUBLIC_API_URL?.trim();
      const configuredApiBase = rawConfiguredApiBase
        ? rawConfiguredApiBase.replace(/\/$/, "")
        : "";
      const localDevApiBase =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? "http://localhost:2095"
          : "";
      const httpBase = configuredApiBase || localDevApiBase;
      const apiBase = httpBase
        ? httpBase.replace(/^http/i, "ws")
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
      const token = getClientAuthToken();
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

          // Compute throughput delta from cumulative net counters.
          const net = frame.status?.net;
          if (net) {
            const prev = prevNetRef.current;
            const downDelta = prev ? Math.max(0, net.recv - prev.recv) : 0;
            const upDelta   = prev ? Math.max(0, net.sent - prev.sent) : 0;
            prevNetRef.current = { sent: net.sent, recv: net.recv };

            setHistory((prev) => {
              const point: ThroughputPoint = { t: Date.now(), down: downDelta, up: upDelta };
              const next = [...prev, point];
              return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
            });
          }
        } catch {
          // skip malformed frame
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
        ws.close();
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────────

  const onlineUsers  = stats?.onlines?.user ?? [];
  const onlineCount  = stats !== null ? onlineUsers.length : null;
  const sbd          = stats?.status?.sbd;
  const db           = stats?.status?.db;
  const mem          = stats?.status?.mem;
  const cpu          = stats?.status?.cpu;

  const pendingAlerts = (stats?.evasionAlerts ?? []).filter(
    (a) => !dismissedAlerts.includes(a.dateTime)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Badge variant={connected ? "default" : "secondary"}>
          {connected ? t("live") : t("connecting")}
        </Badge>
      </div>

      {/* Evasion alerts */}
      {pendingAlerts.map((alert) => (
        <div
          key={alert.dateTime}
          className="flex items-start justify-between rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <div className="space-y-0.5">
            <p className="font-semibold">{t("evasionAlerts")}</p>
            <p className="opacity-80">
              {alert.protocol} — {alert.detail}
              {alert.autoAction ? ` (${alert.autoAction})` : ""}
            </p>
          </div>
          <button
            onClick={() => setDismissedAlerts((p) => [...p, alert.dateTime])}
            className="ml-4 shrink-0 text-xs underline opacity-70 hover:opacity-100"
          >
            {t("evasionAlertDismiss")}
          </button>
        </div>
      ))}

      {/* Top stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("onlineClients")}
          value={onlineCount !== null ? String(onlineCount) : null}
        />
        <StatCard
          title={t("cpuUsage")}
          value={cpu != null ? `${cpu.toFixed(1)} %` : null}
        />
        <StatCard
          title={t("memory")}
          value={
            mem
              ? `${formatBytes(mem.current)} / ${formatBytes(mem.total)}`
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

      {/* Second row: uptime, total clients, singbox status */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={t("uptime")}
          value={sbd?.running && sbd.stats.Uptime ? formatUptime(sbd.stats.Uptime) : sbd ? "—" : null}
        />
        <StatCard
          title={t("totalClients")}
          value={db ? String(db.clients) : null}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              sing-box
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sbd ? (
              <p className={`text-sm font-semibold ${sbd.running ? "text-green-600" : "text-destructive"}`}>
                {sbd.running ? t("singboxRunning") : t("singboxStopped")}
              </p>
            ) : (
              <Skeleton className="h-5 w-24" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Network throughput chart */}
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
                  name={t("networkDown")}
                  stroke="#10b981"
                  fill="url(#downGrad)"
                  dot={false}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="up"
                  name={t("networkUp")}
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

      {/* Active users list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("onlineUsers")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats === null ? (
            <Skeleton className="h-8 w-full" />
          ) : onlineUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noActiveUsers")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {onlineUsers.map((u) => (
                <Badge key={u} variant="secondary">
                  {u}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | null }) {
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
