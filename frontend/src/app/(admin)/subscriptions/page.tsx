"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  addToken,
  deleteToken,
  getTokens,
  getClients,
  clientSubUrl,
  getOfflineBundleUrl,
  type Client,
} from "@/lib/api";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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

  // sing-box app requires a deep-link URI to import a remote profile.
  // Plain https:// URLs are rejected with "not a valid sing-box remote profile uri".
  const selectedSingboxQrUrl = selectedJsonUrl
    ? `sing-box://import-remote-profile?url=${encodeURIComponent(selectedJsonUrl)}#${encodeURIComponent(selectedClientName)}`
    : "";

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

  const { data: tokensData, mutate: mutateTokens } = useSWR("/api/tokens", () =>
    getTokens().then((r) => r.obj ?? [])
  );

  async function handleCreateToken() {
    setCreating(true);
    try {
      const expiry = Math.max(0, Number(tokenExpiryDays) || 0);
      const res = await addToken(expiry, tokenDesc.trim());
      if (!res.success || !res.obj) {
        toast.error(res.msg || t("createTokenError"));
        return;
      }
      setTokenDesc("");
      toast.success(t("createTokenSuccess"));
      mutateTokens();
    } catch {
      toast.error(t("createTokenError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteToken(id: number) {
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    { label: t("qrDefault"), value: selectedUrl },
                    { label: t("qrClash"),   value: selectedClashUrl },
                    { label: t("qrSingbox"), value: selectedSingboxQrUrl },
                  ] as { label: string; value: string }[]
                ).map(({ label, value }) => (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <div className="rounded-xl border p-3">
                      <QRCodeCanvas value={value} size={160} />
                    </div>
                  </div>
                ))}
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
                    <ConfirmDialog
                      title={t("confirmDeleteToken")}
                      confirmLabel={t("deleteToken")}
                      cancelLabel={tc("cancel")}
                      onConfirm={() => handleDeleteToken(item.id)}
                    >
                      <Button size="sm" variant="destructive">
                        {t("deleteToken")}
                      </Button>
                    </ConfirmDialog>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Offline Bundle ────────────────────────────────────────────────── */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Offline Bundle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Download a ZIP archive containing pre-rendered proxy configs for all
            enabled clients. Use this bundle to distribute configs without
            requiring clients to fetch a live subscription URL — useful before
            planned maintenance or when the panel may be temporarily unreachable.
          </p>
          <Button
            size="sm"
            variant="outline"
            render={<a href={getOfflineBundleUrl()} download />}
          >
            ⬇ Download Offline Bundle
          </Button>
        </CardContent>
      </Card>

      {/* ── Telegram Notifications ────────────────────────────────────────── */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Telegram Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            AetherProxy can send out-of-band alerts to a Telegram channel when
            a censorship event triggers an automatic protocol switch. Set the
            following environment variables on the backend to enable this:
          </p>
          <div className="rounded-md bg-muted p-3 font-mono text-xs space-y-1">
            <p>AETHER_TELEGRAM_BOT_TOKEN=&lt;your-bot-token&gt;</p>
            <p>AETHER_TELEGRAM_CHANNEL_ID=@yourchannel</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Create a bot via <a className="text-primary underline-offset-2 hover:underline" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> and
            add it as an administrator to your channel. The channel ID can be
            a @username or a numeric chat ID.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
