"use client";

import useSWR from "swr";
import { getSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  const { data, isLoading, error } = useSWR("/api/settings", () =>
    getSettings().then((r) => r.obj)
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {error && (
        <p className="text-sm text-destructive">Failed to load settings.</p>
      )}

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Current settings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-96">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
