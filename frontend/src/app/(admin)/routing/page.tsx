"use client";

import useSWR from "swr";
import { useState } from "react";
import { getRouting, saveRouting, type RouteRule } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

const emptyRule = (): RouteRule => ({
  inbound: [],
  network: "",
  domain_suffix: [],
  geoip: [],
  outbound: "",
  action: "",
});

export default function RoutingPage() {
  const { data, isLoading, error, mutate } = useSWR("/api/routing", () =>
    getRouting().then((r) => (r.obj as RouteRule[]) ?? [])
  );

  const [rules, setRules] = useState<RouteRule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const displayRules = rules ?? data ?? [];

  function addRule() {
    setRules([...displayRules, emptyRule()]);
  }

  function removeRule(idx: number) {
    setRules(displayRules.filter((_, i) => i !== idx));
  }

  function updateRule(idx: number, field: keyof RouteRule, value: string) {
    const updated = displayRules.map((r, i) => {
      if (i !== idx) return r;
      if (field === "inbound" || field === "domain_suffix" || field === "geoip") {
        return { ...r, [field]: value ? value.split(",").map((s) => s.trim()) : [] };
      }
      return { ...r, [field]: value };
    });
    setRules(updated);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveRouting(displayRules);
      setSaveMsg("Routing rules saved.");
      mutate(displayRules, false);
    } catch {
      setSaveMsg("Failed to save routing rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Routing Rules</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={addRule}>
            Add Rule
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Rules"}
          </Button>
        </div>
      </div>

      {saveMsg && (
        <p className={`text-sm ${saveMsg.includes("Failed") ? "text-destructive" : "text-green-600"}`}>
          {saveMsg}
        </p>
      )}
      {error && <p className="text-sm text-destructive">Failed to load routing rules.</p>}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Inbound(s)</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Domain Suffix</TableHead>
              <TableHead>GeoIP</TableHead>
              <TableHead>Outbound</TableHead>
              <TableHead>Action</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : displayRules.map((rule, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Input
                        value={(rule.inbound ?? []).join(", ")}
                        onChange={(e) => updateRule(idx, "inbound", e.target.value)}
                        placeholder="inbound-tag"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.network ?? ""}
                        onChange={(e) => updateRule(idx, "network", e.target.value)}
                        placeholder="tcp/udp"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={(rule.domain_suffix ?? []).join(", ")}
                        onChange={(e) => updateRule(idx, "domain_suffix", e.target.value)}
                        placeholder=".example.com"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={(rule.geoip ?? []).join(", ")}
                        onChange={(e) => updateRule(idx, "geoip", e.target.value)}
                        placeholder="IR, CN"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.outbound ?? ""}
                        onChange={(e) => updateRule(idx, "outbound", e.target.value)}
                        placeholder="direct"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.action ?? ""}
                        onChange={(e) => updateRule(idx, "action", e.target.value)}
                        placeholder="route"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-destructive hover:text-destructive"
                        onClick={() => removeRule(idx)}
                      >
                        ✕
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
