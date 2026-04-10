"use client";

import useSWR from "swr";
import { useState } from "react";
import { getAnalytics, type AnalyticsData } from "@/lib/api";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const WINDOWS = [24, 168, 720] as const;
type WindowHours = (typeof WINDOWS)[number];

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const [windowHours, setWindowHours] = useState<WindowHours>(WINDOWS[0]);

  const { data, isLoading, error } = useSWR(
    ["/api/analytics", windowHours],
    () => getAnalytics(windowHours).then((r) => r.obj as AnalyticsData)
  );

  const LABELS: Record<WindowHours, string> = {
    24: t("range24h"),
    168: t("range7d"),
    720: t("range30d"),
  };

  const chartData = data
    ? Object.entries(data.perProtocol).map(([tag, stats]) => ({
        tag,
        up: stats.up,
        down: stats.down,
        total: stats.up + stats.down,
      }))
    : [];

  // Per-protocol as percentage of total for the share chart
  const totalTraffic = chartData.reduce((s, d) => s + d.total, 0);
  const shareData = chartData.map((d) => ({
    tag: d.tag,
    pct: totalTraffic > 0 ? Math.round((d.total / totalTraffic) * 100) : 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={windowHours === w ? "default" : "outline"}
              onClick={() => setWindowHours(w)}
            >
              {LABELS[w]}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{t("loadError")}</p>}

      {/* Volume chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("perProtocol")} ({LABELS[windowHours]})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
              >
                <XAxis dataKey="tag" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={formatBytes} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatBytes(Number(v))} />
                <Legend />
                <Bar
                  dataKey="up"
                  name={t("upload")}
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="down"
                  name={t("download")}
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-protocol share chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
                {t("protocolShare")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={shareData}
                margin={{ top: 4, right: 10, left: 10, bottom: 4 }}
              >
                <XAxis dataKey="tag" tick={{ fontSize: 11 }} />
                <YAxis
                  unit="%"
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  width={36}
                />
                <Tooltip formatter={(v) => `${v}%`} />
                <Bar
                  dataKey="pct"
                  name={t("share")}
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Censorship events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("censorshipEvents")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !data || data.evasionEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noEvents")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3">{t("evasionTime")}</th>
                    <th className="py-1 pr-3">{t("evasionProtocol")}</th>
                    <th className="py-1 pr-3">{t("evasionPort")}</th>
                    <th className="py-1 pr-3">{t("evasionDomain")}</th>
                    <th className="py-1 pr-3">{t("evasionAction")}</th>
                    <th className="py-1">{t("evasionDetail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.evasionEvents.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-1 pr-3 text-muted-foreground">
                        {new Date(e.dateTime * 1000).toLocaleString()}
                      </td>
                      <td className="py-1 pr-3">{e.protocol}</td>
                      <td className="py-1 pr-3">{e.port || "—"}</td>
                      <td className="py-1 pr-3">{e.domain || "—"}</td>
                      <td className="py-1 pr-3 text-amber-600">
                        {e.autoAction || "—"}
                      </td>
                      <td className="py-1 text-muted-foreground">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
