"use client";

import useSWR from "swr";
import { useState } from "react";
import { getRouting, saveRouting, type RouteRule } from "@/lib/api";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

// ── Field helpers ─────────────────────────────────────────────────────────────

const ARRAY_FIELDS = [
  "inbound", "protocol", "domain", "domain_suffix", "domain_keyword",
  "geoip", "ip_cidr", "source_ip_cidr", "port", "port_range", "rule_set",
] as const;

const SINGLE_FIELDS = ["network", "outbound", "action", "clash_mode"] as const;

type GuidedState = {
  inbound: string; network: string; protocol: string;
  domain: string; domain_suffix: string; domain_keyword: string;
  geoip: string; ip_cidr: string; source_ip_cidr: string;
  port: string; port_range: string;
  outbound: string; action: string; clash_mode: string; rule_set: string;
};

function arrVal(rule: RouteRule, key: string): string {
  const v = rule[key];
  if (Array.isArray(v)) return (v as string[]).join(", ");
  if (typeof v === "string") return v;
  return "";
}

function singleVal(rule: RouteRule, key: string): string {
  const v = rule[key];
  return typeof v === "string" ? v : "";
}

function ruleToGuided(rule: RouteRule): GuidedState {
  return {
    inbound: arrVal(rule, "inbound"), network: singleVal(rule, "network"),
    protocol: arrVal(rule, "protocol"), domain: arrVal(rule, "domain"),
    domain_suffix: arrVal(rule, "domain_suffix"), domain_keyword: arrVal(rule, "domain_keyword"),
    geoip: arrVal(rule, "geoip"), ip_cidr: arrVal(rule, "ip_cidr"),
    source_ip_cidr: arrVal(rule, "source_ip_cidr"), port: arrVal(rule, "port"),
    port_range: arrVal(rule, "port_range"), outbound: singleVal(rule, "outbound"),
    action: singleVal(rule, "action"), clash_mode: singleVal(rule, "clash_mode"),
    rule_set: arrVal(rule, "rule_set"),
  };
}

function guidedToRule(guided: GuidedState, base: RouteRule): RouteRule {
  const result: RouteRule = { ...base };

  for (const key of ARRAY_FIELDS) {
    const val = guided[key].trim();
    if (val) {
      result[key] = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      delete result[key];
    }
  }
  for (const key of SINGLE_FIELDS) {
    const val = guided[key].trim();
    if (val) {
      result[key] = val;
    } else {
      delete result[key];
    }
  }
  return result;
}

function ruleSummary(rule: RouteRule): string {
  const parts: string[] = [];
  const keys = [
    "inbound", "network", "protocol", "domain", "domain_suffix",
    "domain_keyword", "geoip", "ip_cidr", "source_ip_cidr",
    "port", "port_range", "action", "clash_mode", "rule_set",
  ];
  for (const key of keys) {
    const v = rule[key];
    if (!v) continue;
    if (Array.isArray(v) && (v as unknown[]).length > 0) {
      parts.push(`${key}: ${(v as string[]).join(", ")}`);
    } else if (typeof v === "string" && v) {
      parts.push(`${key}: ${v}`);
    }
  }
  return parts.join(" · ");
}

// ── RuleEditDialog ────────────────────────────────────────────────────────────

function RuleEditDialog({
  rule,
  onSave,
  children,
}: {
  rule: RouteRule;
  onSave: (updated: RouteRule) => void;
  children: React.ReactElement;
}) {
  const t = useTranslations("routing");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("guided");
  const [guided, setGuided] = useState<GuidedState>(() => ruleToGuided(rule));
  const [rawJson, setRawJson] = useState(() => JSON.stringify(rule, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  function syncGuidedToRaw(g: GuidedState) {
    const updated = guidedToRule(g, rule);
    setRawJson(JSON.stringify(updated, null, 2));
    setJsonError(null);
  }

  function syncRawToGuided(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw) as RouteRule;
      setGuided(ruleToGuided(parsed));
      setJsonError(null);
      return true;
    } catch {
      setJsonError(t("rawJsonInvalidJson"));
      return false;
    }
  }

  function handleTabChange(v: string) {
    if (v === "raw") {
      syncGuidedToRaw(guided);
    } else {
      syncRawToGuided(rawJson);
    }
    setTab(v);
  }

  function handleSave() {
    let updated: RouteRule;
    if (tab === "guided") {
      updated = guidedToRule(guided, rule);
    } else {
      try {
        updated = JSON.parse(rawJson) as RouteRule;
      } catch {
        setJsonError(t("rawJsonInvalidJson"));
        return;
      }
    }
    onSave(updated);
    setOpen(false);
  }

  function handleOpen(v: boolean) {
    if (v) {
      setGuided(ruleToGuided(rule));
      setRawJson(JSON.stringify(rule, null, 2));
      setJsonError(null);
      setTab("guided");
    }
    setOpen(v);
  }

  function Field({ fieldKey, label }: { fieldKey: keyof GuidedState; label: string }) {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <Input
          className="h-7 text-xs"
          value={guided[fieldKey]}
          onChange={(e) => setGuided((g) => ({ ...g, [fieldKey]: e.target.value }))}
        />
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={children} />
      <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{t("editRule")}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="guided">{t("guided")}</TabsTrigger>
            <TabsTrigger value="raw">{t("rawJson")}</TabsTrigger>
          </TabsList>

          <TabsContent value="guided" className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("matchFields")}
              </p>
              <Field fieldKey="inbound" label={t("fieldInbound")} />
              <Field fieldKey="network" label={t("fieldNetwork")} />
              <Field fieldKey="protocol" label={t("fieldProtocol")} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("domainFields")}
              </p>
              <Field fieldKey="domain" label={t("fieldDomain")} />
              <Field fieldKey="domain_suffix" label={t("fieldDomainSuffix")} />
              <Field fieldKey="domain_keyword" label={t("fieldDomainKeyword")} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("ipFields")}
              </p>
              <Field fieldKey="geoip" label={t("fieldGeoip")} />
              <Field fieldKey="ip_cidr" label={t("fieldIpCidr")} />
              <Field fieldKey="source_ip_cidr" label={t("fieldSourceIpCidr")} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("portFields")}
              </p>
              <Field fieldKey="port" label={t("fieldPort")} />
              <Field fieldKey="port_range" label={t("fieldPortRange")} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("actionFields")}
              </p>
              <Field fieldKey="outbound" label={t("fieldOutbound")} />
              <Field fieldKey="action" label={t("fieldAction")} />
              <Field fieldKey="clash_mode" label={t("fieldClashMode")} />
              <Field fieldKey="rule_set" label={t("fieldRuleSet")} />
            </div>
          </TabsContent>

          <TabsContent value="raw">
            <Textarea
              className="font-mono text-xs min-h-64 resize-y"
              value={rawJson}
              onChange={(e) => {
                setRawJson(e.target.value);
                setJsonError(null);
              }}
              spellCheck={false}
            />
            {jsonError && <p className="mt-1 text-xs text-destructive">{jsonError}</p>}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" />}
          >
            {t("cancel")}
          </DialogClose>
          <Button onClick={handleSave}>{t("saveRule")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RoutingPage() {
  const t = useTranslations("routing");
  const { data, isLoading, error, mutate } = useSWR("/api/routing", () =>
    getRouting().then((r) => (r.obj as RouteRule[]) ?? [])
  );

  const [rules, setRules] = useState<RouteRule[] | null>(null);
  const [saving, setSaving] = useState(false);

  const displayRules = rules ?? data ?? [];

  function addRule() {
    setRules([...displayRules, {}]);
  }

  function removeRule(idx: number) {
    setRules(displayRules.filter((_, i) => i !== idx));
  }

  function updateRule(idx: number, updated: RouteRule) {
    setRules(displayRules.map((r, i) => (i === idx ? updated : r)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveRouting(displayRules);
      mutate(displayRules, false);
      toast.success(t("saveSuccess"));
    } catch {
      toast.error(t("saveError"));
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

      {error && <p className="text-sm text-destructive">{t("saveError")}</p>}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-3">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : displayRules.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t("noRules")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayRules.map((rule, idx) => {
            const outbound = typeof rule.outbound === "string" ? rule.outbound : "—";
            const summary = ruleSummary(rule);
            return (
              <Card key={idx}>
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {t("ruleCard", { outbound })}
                    </p>
                    {summary && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {summary}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <RuleEditDialog
                      rule={rule}
                      onSave={(updated) => updateRule(idx, updated)}
                    >
                      <Button size="sm" variant="outline">
                        {t("editRule")}
                      </Button>
                    </RuleEditDialog>
                    <ConfirmDialog
                      title={`${t("delete")}?`}
                      confirmLabel={t("delete")}
                      cancelLabel={t("cancel")}
                      onConfirm={() => removeRule(idx)}
                    >
                      <Button size="sm" variant="destructive">✕</Button>
                    </ConfirmDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
