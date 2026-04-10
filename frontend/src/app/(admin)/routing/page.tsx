"use client";

import useSWR from "swr";
import { useState } from "react";
import { getRouting, saveRouting, type RouteRule } from "@/lib/api";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("routing");
  const { data, isLoading, error, mutate } = useSWR("/api/routing", () =>
    getRouting().then((r) => (r.obj as RouteRule[]) ?? [])
  );

  const [rules, setRules] = useState<RouteRule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
      setSaveMsg({ ok: true, text: t("saveSuccess") });
      mutate(displayRules, false);
    } catch {
      setSaveMsg({ ok: false, text: t("saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={addRule}>
            {t("addRule")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      {saveMsg && (
        <p className={`text-sm ${saveMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
          {saveMsg.text}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{t("saveError")}</p>}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inbound")}</TableHead>
              <TableHead>{t("network")}</TableHead>
              <TableHead>{t("domainSuffix")}</TableHead>
              <TableHead>{t("geoip")}</TableHead>
              <TableHead>{t("outbound")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
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
