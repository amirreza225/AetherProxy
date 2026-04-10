"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  addToken,
  deleteToken,
  getTokens,
  getClients,
  clientSubUrl,
  type Client,
} from "@/lib/api";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

export default function SubscriptionsPage() {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");

  // ── Client-based subscriptions ────────────────────────────────────────────

  const { data: clientsData } = useSWR("/api/clients", () =>
    getClients().then((r) => {
      const obj = r.obj as unknown;
      if (Array.isArray(obj)) return obj as Client[];
      if (obj && typeof obj === "object" && Array.isArray((obj as { clients?: Client[] }).clients)) {
        return (obj as { clients: Client[] }).clients;
      }
      return [] as Client[];
    })
  );

  const [selectedClientName, setSelectedClientName] = useState("");
  const [clientCopied, setClientCopied] = useState(false);

  const selectedUrl = selectedClientName ? clientSubUrl(selectedClientName) : "";
  const selectedClashUrl = selectedUrl ? `${selectedUrl}?format=clash` : "";
  const selectedJsonUrl  = selectedUrl ? `${selectedUrl}?format=json`  : "";

  async function handleClientCopyLink() {
    if (!selectedUrl) return;
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setClientCopied(true);
      setTimeout(() => setClientCopied(false), 2000);
    } catch {
      setClientCopied(false);
    }
  }

  // ── API token management ──────────────────────────────────────────────────

  const [tokenDesc, setTokenDesc] = useState("");
  const [tokenExpiryDays, setTokenExpiryDays] = useState("30");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: tokensData, mutate: mutateTokens } = useSWR("/api/tokens", () =>
    getTokens().then((r) => r.obj ?? [])
  );

  async function handleCreateToken() {
    setCreateMsg(null);
    setCreating(true);
    try {
      const expiry = Math.max(0, Number(tokenExpiryDays) || 0);
      const res = await addToken(expiry, tokenDesc.trim());
      if (!res.success || !res.obj) {
        setCreateMsg({ ok: false, text: res.msg || t("createTokenError") });
        return;
      }
      setTokenDesc("");
      setCreateMsg({ ok: true, text: t("createTokenSuccess") });
      mutateTokens();
    } catch {
      setCreateMsg({ ok: false, text: t("createTokenError") });
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteToken(id: number) {
    if (!confirm(t("confirmDeleteToken"))) return;
    try {
      const res = await deleteToken(id);
      if (!res.success) {
        toast.error(res.msg || t("deleteTokenError"));
        return;
      }
      mutateTokens();
      toast.success(t("deleteTokenSuccess"));
    } catch {
      toast.error(t("deleteTokenError"));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {/* ── Client subscriptions (primary workflow) ────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("clientSubsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("clientSubsHint")}</p>

          <div className="space-y-1">
            <Label htmlFor="clientSelect">{t("selectClient")}</Label>
            {(clientsData ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noClients")}</p>
            ) : (
              <select
                id="clientSelect"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={selectedClientName}
                onChange={(e) => {
                  setSelectedClientName(e.target.value);
                  setClientCopied(false);
                }}
              >
                <option value="">{t("selectClient")}</option>
                {(clientsData ?? []).map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedUrl && (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-muted-foreground">{t("mainLink")}</p>
              <p className="break-all rounded bg-muted p-2 font-mono text-sm">{selectedUrl}</p>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleClientCopyLink}>
                  {clientCopied ? t("copied") : t("copyLink")}
                </Button>
                <Button size="sm" variant="outline" render={<a href={selectedUrl} target="_blank" rel="noreferrer" />}>
                  {t("openLink")}
                </Button>
              </div>

              <div className="space-y-1 rounded-md border p-3 text-xs">
                <p className="font-medium text-foreground">{t("advancedFormats")}</p>
                <a className="block break-all text-primary underline-offset-4 hover:underline" href={selectedClashUrl} target="_blank" rel="noreferrer">
                  Clash/Mihomo: {selectedClashUrl}
                </a>
                <a className="block break-all text-primary underline-offset-4 hover:underline" href={selectedJsonUrl} target="_blank" rel="noreferrer">
                  sing-box JSON: {selectedJsonUrl}
                </a>
              </div>

              <div className="flex justify-center">
                <div className="rounded-xl border p-3">
                  <QRCodeCanvas value={selectedUrl} size={200} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("scanHint")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── API access tokens ─────────────────────────────────────────────── */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">{t("apiTokensTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("apiTokensHint")}</p>

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{t("quickCreate")}</p>
            <div className="space-y-1">
              <Label htmlFor="tokenDesc">{t("tokenDesc")}</Label>
              <Input
                id="tokenDesc"
                placeholder={t("tokenDescPlaceholder")}
                value={tokenDesc}
                onChange={(e) => setTokenDesc(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tokenExpiryDays">{t("tokenExpiryDays")}</Label>
              <Input
                id="tokenExpiryDays"
                type="number"
                min={0}
                value={tokenExpiryDays}
                onChange={(e) => setTokenExpiryDays(e.target.value)}
              />
            </div>
            {createMsg && (
              <p className={`text-sm ${createMsg.ok ? "text-green-600" : "text-destructive"}`}>
                {createMsg.text}
              </p>
            )}
            <Button onClick={handleCreateToken} disabled={creating}>
              {creating ? tc("saving") : t("createAndGenerate")}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("existingTokens")}</p>
            {(tokensData ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noTokens")}</p>
            ) : (
              <div className="space-y-2">
                {(tokensData ?? []).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.desc || t("tokenNoDesc")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("tokenMasked")} {item.token}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.expiry > 0
                          ? `${t("expiresAt")} ${new Date(item.expiry * 1000).toLocaleDateString()}`
                          : t("neverExpires")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteToken(item.id)}
                    >
                      {t("deleteToken")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
