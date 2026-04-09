"use client";

import { useState } from "react";
import { subUrl } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QRCodeCanvas } from "qrcode.react";

export default function SubscriptionsPage() {
  const [token, setToken] = useState("");
  const [generated, setGenerated] = useState("");

  function handleGenerate() {
    if (token.trim()) setGenerated(subUrl(token.trim()));
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Subscriptions</h1>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Generate subscription link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="token">Subscription token</Label>
            <Input
              id="token"
              placeholder="Paste user token here"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <Button onClick={handleGenerate} disabled={!token.trim()}>
            Generate
          </Button>

          {generated && (
            <div className="space-y-3 pt-2">
              <p className="text-sm break-all font-mono bg-muted p-2 rounded">
                {generated}
              </p>
              <div className="flex justify-center">
                <QRCodeCanvas value={generated} size={200} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
