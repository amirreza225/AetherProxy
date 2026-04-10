"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, setClientAuthToken } from "@/lib/api";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LanguageToggleButton } from "@/components/layout/LanguageToggleButton";

export default function LoginPage() {
  const t = useTranslations("login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await login(user, pass);
      if (res.success) {
        if (!res.obj?.token) {
          setError(t("connectionFailed"));
          return;
        }
        setClientAuthToken(res.obj.token);
        const from = searchParams.get("from");
        const destination = from && from.startsWith("/") ? from : "/dashboard";
        router.replace(destination);
        router.refresh();
      } else {
        setError(res.msg || t("invalidCredentials"));
      }
    } catch {
      setError(t("connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto flex w-full max-w-sm justify-end pb-4">
        <LanguageToggleButton variant="outline" />
      </div>
      <div className="flex items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl text-center">{t("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="user">{t("username")}</Label>
                <Input
                  id="user"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pass">{t("password")}</Label>
                <Input
                  id="pass"
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("signingIn") : t("signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
