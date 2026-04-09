"use client";

import useSWR from "swr";
import { useState } from "react";
import { getAnalytics, type AnalyticsData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const WINDOWS = [24, 168, 720] as const;
const LABELS: Record<number, string> = { 24: "24h", 168: "7d", 720: "30d" };

export default function AnalyticsPage() {
  const [windowHours, setWindowHours] = useState<24 | 168 | 720>(24);

  const { data, isLoading, error } = useSWR(
    ["/api/analytics", windowHours],
    () => getAnalytics(windowHours).then((r) => r.obj as AnalyticsData)
  );

  const chartData = data
    ? Object.entries(data.perProtocol).map(([tag, stats]) => ({
        tag,
        up: stats.up,
        down: stats.down,
      }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
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

      {error && <p className="text-sm text-destructive">Failed to load analytics.</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-Protocol Traffic ({LABELS[windowHours]})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No analytics data available yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <XAxis dataKey="tag" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={formatBytes} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatBytes(v)} />
                <Legend />
                <Bar dataKey="up" name="Upload" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="down" name="Download" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Censorship Events</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !data || data.evasionEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evasion events detected yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3">Time</th>
                    <th className="py-1 pr-3">Protocol</th>
                    <th className="py-1 pr-3">Port</th>
                    <th className="py-1 pr-3">Domain</th>
                    <th className="py-1 pr-3">Action</th>
                    <th className="py-1">Detail</th>
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
                      <td className="py-1 pr-3 text-amber-600">{e.autoAction || "—"}</td>
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
