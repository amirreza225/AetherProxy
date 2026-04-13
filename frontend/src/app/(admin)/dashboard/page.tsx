"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { getClientAuthToken, getNodes, getTelemetryStats, type TelemetryStats, restartApp, restartSb, getSingboxConfigUrl } from "@/lib/api";
import { useTranslations } from "next-intl";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  Cpu,
  HardDrive,
  Server,
  Users,
  Network,
  Clock,
  Database,
  X,
  ShieldAlert,
  Circle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  stats: { Uptime: number; NumGoroutine: number; Alloc: number };
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

interface ThroughputPoint {
  t: number;
  down: number;
  up: number;
}

const MAX_HISTORY = 30;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function MemoryBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const color =
    pct > 85 ? "bg-destructive" : pct > 65 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatBytes(current)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">of {formatBytes(total)}</p>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  value?: string | null;
  icon: React.ElementType;
  iconColor: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className={`rounded-lg p-2 ${iconColor}`}>
            <Icon className="size-4 text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {children ?? (
          value != null ? (
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          ) : (
            <Skeleton className="h-8 w-28" />
          )
        )}
      </CardContent>
    </Card>
  );
}

// ── Telemetry Card ────────────────────────────────────────────────────────────

function TelemetryCard({ stats }: { stats: TelemetryStats[] | undefined }) {
  if (!stats) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Protocol Health (last hour)</CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
    );
  }
  if (stats.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Protocol Health (last hour)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No telemetry data yet. Clients will report connectivity as they connect.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Protocol Health (last hour)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stats.map((s) => {
            const pct = Math.round(s.successRate * 100);
            const color = pct >= 90 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-destructive";
            return (
              <div key={s.protocol} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{s.protocol}</span>
                  <span className="text-muted-foreground">
                    {pct}% success · {s.total} samples · avg {Math.round(s.avgLatency)}ms
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const t = useTranslations("dashboard");

  const [stats, setStats]                   = useState<LiveStats | null>(null);
  const [connected, setConnected]           = useState(false);
  const [history, setHistory]               = useState<ThroughputPoint[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<number[]>([]);
  const wsRef     = useRef<WebSocket | null>(null);
  const prevNetRef = useRef<{ sent: number; recv: number } | null>(null);

  const { data: nodesData } = useSWR("/api/nodes", () =>
    getNodes().then((r) => r.obj ?? [])
  );
  const nodesOnline  = (nodesData ?? []).filter((n) => n.status === "online").length;
  const nodesOffline = (nodesData ?? []).filter((n) => n.status === "offline").length;

  const { data: telemetryData } = useSWR("/api/telemetryStats", () =>
    getTelemetryStats().then((r) => r.obj ?? []),
    { refreshInterval: 60_000 }
  );

  useEffect(() => {
    let reconnectTimer: number | null = null;
    let closedByCleanup = false;
    let reconnectAttempt = 0;

    const connect = () => {
      if (closedByCleanup) return;
      const rawBase = process.env.NEXT_PUBLIC_API_URL?.trim();
      const configBase = rawBase ? rawBase.replace(/\/$/, "") : "";
      const localBase =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? "http://localhost:2095"
          : "";
      const httpBase = configBase || localBase;
      const apiBase = httpBase
        ? httpBase.replace(/^http/i, "ws")
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
      const token = getClientAuthToken();
      const wsUrl = token
        ? `${apiBase}/api/ws/stats?token=${encodeURIComponent(token)}`
        : `${apiBase}/api/ws/stats`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => { reconnectAttempt = 0; setConnected(true); };

      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data) as LiveStats;
          setStats(frame);
          const net = frame.status?.net;
          if (net) {
            const prev = prevNetRef.current;
            const downDelta = prev ? Math.max(0, net.recv - prev.recv) : 0;
            const upDelta   = prev ? Math.max(0, net.sent - prev.sent) : 0;
            prevNetRef.current = { sent: net.sent, recv: net.recv };
            setHistory((p) => {
              const pt: ThroughputPoint = { t: Date.now(), down: downDelta, up: upDelta };
              const next = [...p, pt];
              return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
            });
          }
        } catch { /* skip malformed */ }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (closedByCleanup) return;
        const delay = Math.min(10000, 1000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const onlineUsers     = stats?.onlines?.user ?? [];
  const onlineCount     = stats !== null ? onlineUsers.length : null;
  const sbd             = stats?.status?.sbd;
  const db              = stats?.status?.db;
  const mem             = stats?.status?.mem;
  const cpu             = stats?.status?.cpu;
  const pendingAlerts   = (stats?.evasionAlerts ?? []).filter(
    (a) => !dismissedAlerts.includes(a.dateTime)
  );

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Badge
          variant={connected ? "default" : "secondary"}
          className={connected ? "bg-primary/15 text-primary border-primary/30" : ""}
        >
          <Circle
            className={`mr-1.5 size-2 fill-current ${connected ? "text-green-500" : "text-muted-foreground"}`}
          />
          {connected ? t("live") : t("connecting")}
        </Badge>
      </div>

      {/* ── Evasion alerts ── */}
      {pendingAlerts.map((alert) => (
        <div
          key={alert.dateTime}
          className="flex items-start justify-between rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3"
        >
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">{t("evasionAlerts")}</p>
              <p className="text-sm text-muted-foreground">
                {alert.protocol} — {alert.detail}
                {alert.autoAction ? ` · ${alert.autoAction}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={() => setDismissedAlerts((p) => [...p, alert.dateTime])}
            className="ml-4 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      {/* ── Primary stats row ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("onlineClients")}
          value={onlineCount !== null ? String(onlineCount) : null}
          icon={Users}
          iconColor="bg-indigo-500"
        />
        <StatCard
          title={t("cpuUsage")}
          value={cpu != null ? `${cpu.toFixed(1)} %` : null}
          icon={Cpu}
          iconColor={cpu != null && cpu > 85 ? "bg-destructive" : cpu != null && cpu > 65 ? "bg-amber-500" : "bg-sky-500"}
        />
        <StatCard
          title={t("memory")}
          icon={HardDrive}
          iconColor={mem && mem.current / mem.total > 0.85 ? "bg-destructive" : mem && mem.current / mem.total > 0.65 ? "bg-amber-500" : "bg-violet-500"}
        >
          {mem ? (
            <MemoryBar current={mem.current} total={mem.total} />
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </StatCard>
        {nodesData !== undefined ? (
          <StatCard
            title={t("nodeStatus")}
            icon={Server}
            iconColor={nodesOffline > 0 ? "bg-amber-500" : "bg-emerald-500"}
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold text-emerald-600">
                {t("nodesOnline", { count: nodesOnline })}
              </p>
              {nodesOffline > 0 && (
                <p className="text-sm font-semibold text-destructive">
                  {t("nodesOffline", { count: nodesOffline })}
                </p>
              )}
            </div>
          </StatCard>
        ) : (
          <StatCard title={t("nodeStatus")} icon={Server} iconColor="bg-emerald-500" />
        )}
      </div>

      {/* ── Secondary stats row ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={t("uptime")}
          value={
            sbd
              ? sbd.running && sbd.stats.Uptime
                ? formatUptime(sbd.stats.Uptime)
                : "—"
              : null
          }
          icon={Clock}
          iconColor="bg-teal-500"
        />
        <StatCard
          title={t("totalClients")}
          value={db ? String(db.clients) : null}
          icon={Database}
          iconColor="bg-pink-500"
        />
        <StatCard
          title="sing-box"
          icon={Activity}
          iconColor={sbd ? (sbd.running ? "bg-emerald-500" : "bg-destructive") : "bg-muted-foreground"}
        >
          {sbd ? (
            <div className="flex items-center gap-2">
              <span
                className={`inline-block size-2.5 rounded-full ${sbd.running ? "bg-emerald-500" : "bg-destructive"}`}
              />
              <span className={`text-sm font-semibold ${sbd.running ? "text-emerald-600" : "text-destructive"}`}>
                {sbd.running ? t("singboxRunning") : t("singboxStopped")}
              </span>
            </div>
          ) : (
            <Skeleton className="h-5 w-28" />
          )}
        </StatCard>
      </div>

      {/* ── Network throughput chart ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("trafficHistory")}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {history.length < 2 ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart
                data={history}
                margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis tickFormatter={formatBytes} tick={{ fontSize: 10 }} width={62} />
                <Tooltip
                  formatter={(v) => formatBytes(Number(v))}
                  labelFormatter={() => ""}
                  contentStyle={{ borderRadius: "0.5rem", fontSize: "0.75rem" }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem" }} />
                <Area
                  type="monotone"
                  dataKey="down"
                  name={t("networkDown")}
                  stroke="#6366f1"
                  fill="url(#downGrad)"
                  dot={false}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="up"
                  name={t("networkUp")}
                  stroke="#10b981"
                  fill="url(#upGrad)"
                  dot={false}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Active users list ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("onlineUsers")}
              {onlineCount !== null && onlineCount > 0 && (
                <span className="ms-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {onlineCount}
                </span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {stats === null ? (
            <div className="flex gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
            </div>
          ) : onlineUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noActiveUsers")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {onlineUsers.map((u) => (
                <span
                  key={u}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-3 py-0.5 text-sm font-medium text-primary"
                >
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {u}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Telemetry / Protocol Health ── */}
      <TelemetryCard stats={telemetryData} />

      {/* ── Quick Actions ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("quickActions")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={async () => {
                if (!window.confirm("Restart sing-box core?")) return;
                try {
                  const res = await restartSb();
                  if (res.success) toast.success(t("restartCoreSuccess"));
                  else toast.error(t("restartCoreError"));
                } catch {
                  toast.error(t("restartCoreError"));
                }
              }}
            >
              {t("restartCore")}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!window.confirm("Restart panel?")) return;
                try {
                  const res = await restartApp();
                  if (res.success) {
                    toast.success(t("restartPanelSuccess"));
                    setTimeout(() => { window.location.href = "/login"; }, 3000);
                  } else {
                    toast.error(t("restartPanelError"));
                  }
                } catch {
                  toast.error(t("restartPanelError"));
                }
              }}
            >
              {t("restartPanel")}
            </Button>
            <a href={getSingboxConfigUrl()} download className="contents">
              <Button variant="outline" className="w-full">
                {t("downloadConfig")}
              </Button>
            </a>
            <Button variant="outline" render={<Link href="/analytics" />}>
              {t("viewAnalytics")}
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
