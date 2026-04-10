"use client";

import { useState } from "react";
import useSWR from "swr";
import { addToken, deleteToken, getTokens, subUrl } from "@/lib/api";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QRCodeCanvas } from "qrcode.react";

export default function SubscriptionsPage() {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const [token, setToken] = useState("");
  const [generated, setGenerated] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokenDesc, setTokenDesc] = useState("");
  const [tokenExpiryDays, setTokenExpiryDays] = useState("30");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: tokensData, mutate: mutateTokens } = useSWR("/api/tokens", () =>
    getTokens().then((r) => r.obj ?? [])
  );

  async function handleCreateTokenAndGenerate() {
    setCreateMsg(null);
    setCreating(true);
    try {
      const expiry = Math.max(0, Number(tokenExpiryDays) || 0);
      const res = await addToken(expiry, tokenDesc.trim());
      if (!res.success || !res.obj) {
        setCreateMsg({ ok: false, text: res.msg || t("createTokenError") });
        return;
      }

      const created = String(res.obj);
      setToken(created);
      setGenerated(subUrl(created));
      setCopied(false);
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
    await deleteToken(id);
    mutateTokens();
  }

  function handleGenerate() {
    if (!token.trim()) return;
    setGenerated(subUrl(token.trim()));
    setCopied(false);
  }

  async function handleCopyLink() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const clashUrl = generated ? `${generated}?format=clash` : "";
  const jsonUrl = generated ? `${generated}?format=json` : "";
  const qrUrl = generated ? generated.replace("/sub/", "/sub/qr/") : "";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("howToConnectTitle")}</p>
        <ol className="mt-2 list-decimal space-y-1 ps-4">
          <li>{t("howToConnectStep1New")}</li>
          <li>{t("howToConnectStep2")}</li>
          <li>{t("howToConnectStep3")}</li>
        </ol>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">{t("quickCreate")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <Button onClick={handleCreateTokenAndGenerate} disabled={creating}>
            {creating ? tc("saving") : t("createAndGenerate")}
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">{t("generate")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="token">{t("token")}</Label>
            <Input
              id="token"
              placeholder={t("tokenPlaceholder")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <Button onClick={handleGenerate} disabled={!token.trim()}>
            {t("generateButton")}
          </Button>

          {generated && (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground">{t("mainLink")}</p>
              <p className="break-all rounded bg-muted p-2 font-mono text-sm">
                {generated}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyLink}>
                  {copied ? t("copied") : t("copyLink")}
                </Button>
                <Button size="sm" variant="outline" render={<a href={generated} target="_blank" rel="noreferrer" />}>
                  {t("openLink")}
                </Button>
              </div>

              <div className="space-y-1 rounded-md border p-3 text-xs">
                <p className="font-medium text-foreground">{t("advancedFormats")}</p>
                <a className="block break-all text-primary underline-offset-4 hover:underline" href={clashUrl} target="_blank" rel="noreferrer">
                  Clash/Mihomo: {clashUrl}
                </a>
                <a className="block break-all text-primary underline-offset-4 hover:underline" href={jsonUrl} target="_blank" rel="noreferrer">
                  sing-box JSON: {jsonUrl}
                </a>
                <a className="block break-all text-primary underline-offset-4 hover:underline" href={qrUrl} target="_blank" rel="noreferrer">
                  QR endpoint: {qrUrl}
                </a>
              </div>

              <div className="flex justify-center">
                <div className="rounded-xl border p-3">
                  <QRCodeCanvas value={generated} size={200} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{t("scanHint")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">{t("existingTokens")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
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
        </CardContent>
      </Card>
    </div>
  );
}

