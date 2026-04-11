"use client";

import useSWR from "swr";
import { useState } from "react";
import {
  getInbounds,
  deleteInbound,
  saveInbound,
  getTlsProfiles,
  createTlsProfile,
  updateTlsProfile,
  getKeypairs,
  issueLetsEncryptCert,
  savePastedCert,
  type Inbound,
  type TlsProfile,
} from "@/lib/api";
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// ── Constants ──────────────────────────────────────────────────────────────────

type Preset = "vless-reality" | "hysteria2" | "trojan" | "shadowsocks" | "custom";

const PRESETS: { id: Preset; label: string; desc: string; badge: string }[] = [
  { id: "vless-reality", label: "VLESS + Reality",  badge: "Recommended", desc: "Camouflages as real HTTPS — best for high-censorship environments" },
  { id: "hysteria2",     label: "Hysteria2",         badge: "High speed",  desc: "QUIC/UDP-based — ideal for high-throughput or lossy networks" },
  { id: "trojan",        label: "Trojan",            badge: "Universal",   desc: "TLS-based protocol with wide client support" },
  { id: "shadowsocks",   label: "Shadowsocks",       badge: "Simple",      desc: "Simple and fast — pair with ShadowTLS for extra obfuscation" },
  { id: "custom",        label: "Custom",            badge: "Advanced",    desc: "Any sing-box inbound type — raw JSON editor for advanced config" },
];

const FINGERPRINTS = ["chrome","firefox","safari","ios","edge","qq","random","randomized"];
const SS_METHODS = [
  "aes-128-gcm","aes-256-gcm","chacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm","2022-blake3-aes-256-gcm","2022-blake3-chacha20-poly1305",
];
const INBOUND_TYPES = [
  "vless","vmess","trojan","shadowsocks","hysteria2","tuic","naive",
  "shadowtls","http","socks","mixed","tun","direct","redirect","tproxy",
];

// ── Form state interfaces ─────────────────────────────────────────────────────

interface VlessForm {
  tag: string; listen: string; listen_port: number;
  server_name: string; handshake_server: string; handshake_port: number;
  private_key: string; public_key: string; short_ids: string; fingerprint: string;
}
interface Hy2Form {
  tag: string; listen: string; listen_port: number;
  up_mbps: number; down_mbps: number;
  obfs: boolean; obfs_password: string;
  cert_path: string; key_path: string;
}
interface TrojanForm { tag: string; listen: string; listen_port: number; cert_path: string; key_path: string; }
interface SsForm     { tag: string; listen: string; listen_port: number; method: string; password: string; network: string; }
interface CustomForm { type: string; tag: string; listen: string; listen_port: number; tls_id: number; advJson: string; }

// ── Preset detection & defaults ───────────────────────────────────────────────

function detectPreset(inb: Inbound, profiles: TlsProfile[]): Preset {
  const tls = profiles.find((t) => t.id === (inb.tls_id as number));
  if (inb.type === "vless"       && (tls?.server as Record<string,unknown>|undefined)?.reality) return "vless-reality";
  if (inb.type === "hysteria2")  return "hysteria2";
  if (inb.type === "trojan")     return "trojan";
  if (inb.type === "shadowsocks") return "shadowsocks";
  return "custom";
}

function defaultVless(inb?: Inbound, tls?: TlsProfile): VlessForm {
  const srv = (tls?.server ?? {}) as Record<string,unknown>;
  const cli = (tls?.client ?? {}) as Record<string,unknown>;
  const reality = (srv.reality ?? {}) as Record<string,unknown>;
  const cliReality = (cli.reality ?? {}) as Record<string,unknown>;
  const hs = (reality.handshake ?? {}) as Record<string,unknown>;
  const utls = (cli.utls ?? {}) as Record<string,unknown>;
  return {
    tag: (inb?.tag as string) ?? "", listen: (inb?.listen as string) ?? "0.0.0.0",
    listen_port: (inb?.listen_port as number) ?? 443,
    server_name: (srv.server_name as string) ?? "",
    handshake_server: (hs.server as string) ?? "", handshake_port: (hs.server_port as number) ?? 443,
    private_key: (reality.private_key as string) ?? "", public_key: (cliReality.public_key as string) ?? "",
    short_ids: ((reality.short_id as string[]) ?? []).join(", "),
    fingerprint: (utls.fingerprint as string) ?? "chrome",
  };
}
function defaultHy2(inb?: Inbound, tls?: TlsProfile): Hy2Form {
  const srv = (tls?.server ?? {}) as Record<string,unknown>;
  const obfsObj = (inb?.obfs as Record<string,unknown>) ?? {};
  return {
    tag: (inb?.tag as string) ?? "", listen: (inb?.listen as string) ?? "0.0.0.0",
    listen_port: (inb?.listen_port as number) ?? 443,
    up_mbps: (inb?.up_mbps as number) ?? 0, down_mbps: (inb?.down_mbps as number) ?? 0,
    obfs: !!obfsObj.type, obfs_password: (obfsObj.password as string) ?? "",
    cert_path: (srv.certificate_path as string) ?? "", key_path: (srv.key_path as string) ?? "",
  };
}
function defaultTrojan(inb?: Inbound, tls?: TlsProfile): TrojanForm {
  const srv = (tls?.server ?? {}) as Record<string,unknown>;
  return { tag: (inb?.tag as string) ?? "", listen: (inb?.listen as string) ?? "0.0.0.0",
    listen_port: (inb?.listen_port as number) ?? 443,
    cert_path: (srv.certificate_path as string) ?? "", key_path: (srv.key_path as string) ?? "" };
}
function defaultSs(inb?: Inbound): SsForm {
  return { tag: (inb?.tag as string) ?? "", listen: (inb?.listen as string) ?? "0.0.0.0",
    listen_port: (inb?.listen_port as number) ?? 8388,
    method: (inb?.method as string) ?? "aes-128-gcm",
    password: (inb?.password as string) ?? "", network: (inb?.network as string) ?? "" };
}
function defaultCustom(inb?: Inbound): CustomForm {
  if (!inb) return { type: "vless", tag: "", listen: "0.0.0.0", listen_port: 443, tls_id: 0, advJson: "{}" };
  const { id: _id, type, tag, listen, listen_port, tls_id, users: _u, ...rest } = inb;
  return { type: type as string, tag: tag as string, listen: (listen as string) ?? "0.0.0.0",
    listen_port: (listen_port as number) ?? 443, tls_id: (tls_id as number) ?? 0,
    advJson: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "{}" };
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}{hint && <span className="ml-1 text-xs text-muted-foreground font-normal">({hint})</span>}</Label>
      {children}
    </div>
  );
}
function SectionHead({ children }: { children: React.ReactNode }) {
  return <p className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}
function ListenRow({ listen, listenPort, onListen, onPort }: {
  listen: string; listenPort: number; onListen: (v: string) => void; onPort: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_7rem] gap-3">
      <Field label="Listen Address"><Input value={listen} onChange={(e) => onListen(e.target.value)} placeholder="0.0.0.0" /></Field>
      <Field label="Port"><Input type="number" min={1} max={65535} value={listenPort} onChange={(e) => onPort(Number(e.target.value))} /></Field>
    </div>
  );
}

// ── Protocol form sections ────────────────────────────────────────────────────

function VlessSection({ form, setForm, generatingKeys, onGenerateKeys }: {
  form: VlessForm; setForm: React.Dispatch<React.SetStateAction<VlessForm>>;
  generatingKeys: boolean; onGenerateKeys: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Inbound Tag" hint="unique identifier">
        <Input value={form.tag} placeholder="vless-reality-in" required onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} />
      </Field>
      <SectionHead>Network</SectionHead>
      <ListenRow listen={form.listen} listenPort={form.listen_port}
        onListen={(v) => setForm((f) => ({ ...f, listen: v }))}
        onPort={(v) => setForm((f) => ({ ...f, listen_port: v }))} />
      <SectionHead>Reality TLS</SectionHead>
      <Field label="SNI — Domain to Impersonate" hint="domain only, e.g. www.microsoft.com">
        <Input value={form.server_name} placeholder="www.microsoft.com" required
          onChange={(e) => {
            const v = e.target.value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
            setForm((f) => ({ ...f, server_name: v,
              handshake_server: f.handshake_server === f.server_name ? v : f.handshake_server }));
          }} />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field label="Handshake Server" hint="domain only">
          <Input value={form.handshake_server} placeholder="www.microsoft.com" required
            onChange={(e) => setForm((f) => ({
              ...f,
              handshake_server: e.target.value.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""),
            }))} />
        </Field>
        <Field label="Port">
          <Input type="number" min={1} max={65535} value={form.handshake_port}
            onChange={(e) => setForm((f) => ({ ...f, handshake_port: Number(e.target.value) }))} />
        </Field>
      </div>
      <Field label="Private Key">
        <div className="flex gap-2">
          <Input value={form.private_key} placeholder="Base64url — click Generate" required
            className="font-mono text-xs" onChange={(e) => setForm((f) => ({ ...f, private_key: e.target.value }))} />
          <Button type="button" variant="outline" size="sm" className="shrink-0"
            disabled={generatingKeys} onClick={onGenerateKeys}>{generatingKeys ? "…" : "Generate"}</Button>
        </div>
      </Field>
      {form.public_key && (
        <Field label="Public Key" hint="give this to clients">
          <Input readOnly value={form.public_key} className="font-mono text-xs bg-muted" />
        </Field>
      )}
      <Field label="Short IDs" hint="hex only (0-9 a-f), comma-separated">
        <div className="flex gap-2">
          <Input value={form.short_ids} placeholder="a1b2c3d4 (hex only)" className="font-mono text-xs"
            onChange={(e) => setForm((f) => ({ ...f, short_ids: e.target.value }))} />
          <Button type="button" variant="outline" size="sm" className="shrink-0"
            onClick={() => {
              const hex = Array.from(crypto.getRandomValues(new Uint8Array(8)))
                .map((b) => b.toString(16).padStart(2, "0")).join("");
              setForm((f) => ({ ...f, short_ids: hex }));
            }}>Gen</Button>
        </div>
      </Field>
      <SectionHead>uTLS Fingerprint</SectionHead>
      <Field label="Browser to mimic">
        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={form.fingerprint} onChange={(e) => setForm((f) => ({ ...f, fingerprint: e.target.value }))}>
          {FINGERPRINTS.map((fp) => <option key={fp} value={fp}>{fp}</option>)}
        </select>
      </Field>
    </div>
  );
}

// ── Certificate Setup Widget ──────────────────────────────────────────────────

/**
 * CertSetupWidget — lets the user obtain TLS certificates in two ways:
 *   A) Let's Encrypt  — auto-issues via HTTP-01 ACME (port 80 must be open)
 *   B) Paste / Cloudflare Origin Certificate — user pastes PEM content
 *
 * Once a cert is obtained either way the parent's cert_path / key_path are
 * auto-filled, but remain editable so the user can override them.
 */
function CertSetupWidget({
  tag,
  certPath,
  keyPath,
  onCertReady,
}: {
  tag: string;
  certPath: string;
  keyPath: string;
  onCertReady: (certPath: string, keyPath: string) => void;
}) {
  type Mode = "letsencrypt" | "paste";
  const [mode, setMode] = useState<Mode>("letsencrypt");
  const [domain, setDomain] = useState("");
  const [email, setEmail]   = useState("");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem]   = useState("");
  const [busy, setBusy]       = useState(false);
  const [certErr, setCertErr] = useState<string | null>(null);
  const [certOk, setCertOk]   = useState(false);

  async function handleIssue() {
    setCertErr(null); setCertOk(false); setBusy(true);
    try {
      const res = await issueLetsEncryptCert(domain.trim(), email.trim());
      if (!res.success || !res.obj) { setCertErr(res.msg || "Issuance failed"); return; }
      onCertReady(res.obj.cert_path, res.obj.key_path);
      setCertOk(true);
    } catch (e) {
      setCertErr(String(e));
    } finally { setBusy(false); }
  }

  async function handleSavePaste() {
    setCertErr(null); setCertOk(false); setBusy(true);
    try {
      const effectiveTag = tag.trim() || "custom";
      const res = await savePastedCert(effectiveTag, certPem.trim(), keyPem.trim());
      if (!res.success || !res.obj) { setCertErr(res.msg || "Save failed"); return; }
      onCertReady(res.obj.cert_path, res.obj.key_path);
      setCertOk(true);
    } catch (e) {
      setCertErr(String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex gap-1 rounded-lg border p-1 text-sm w-fit">
        <button type="button"
          className={`rounded-md px-3 py-1 transition-colors ${mode === "letsencrypt" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          onClick={() => { setMode("letsencrypt"); setCertErr(null); setCertOk(false); }}>
          Let&apos;s Encrypt
        </button>
        <button type="button"
          className={`rounded-md px-3 py-1 transition-colors ${mode === "paste" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          onClick={() => { setMode("paste"); setCertErr(null); setCertOk(false); }}>
          Paste Certificate
        </button>
      </div>

      {mode === "letsencrypt" && (
        <div className="space-y-3">
          {/* Cloudflare note */}
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
            <p className="font-medium">Using Cloudflare? Read this first</p>
            <p>
              Hysteria2 uses <strong>QUIC/UDP</strong> — Cloudflare&apos;s proxy only handles TCP.
              Set your DNS record to <strong>DNS only</strong> (grey cloud) before issuing.
            </p>
            <p>
              Port <strong>80</strong> must be reachable from the internet for the HTTP challenge.
            </p>
          </div>
          <Field label="Domain" hint="e.g. proxy.example.com">
            <Input value={domain} placeholder="proxy.example.com" onChange={(e) => setDomain(e.target.value)} />
          </Field>
          <Field label="Email" hint="optional — used for expiry notifications">
            <Input type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="button" size="sm" disabled={busy || !domain.trim()} onClick={handleIssue}>
            {busy ? "Issuing…" : "Issue Certificate"}
          </Button>
        </div>
      )}

      {mode === "paste" && (
        <div className="space-y-3">
          {/* Cloudflare Origin Certificate note */}
          <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-400 space-y-1">
            <p className="font-medium">Cloudflare Origin Certificate</p>
            <p>
              Go to <strong>Cloudflare → SSL/TLS → Origin Server → Create Certificate</strong>,
              choose PEM format, copy both the certificate and the private key below.
            </p>
            <p>
              Keep the DNS record on <strong>DNS only</strong> (grey cloud) — Cloudflare cannot
              proxy QUIC/UDP traffic used by Hysteria2.
            </p>
          </div>
          <Field label="Certificate (PEM)" hint="paste the -----BEGIN CERTIFICATE----- block">
            <textarea
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              rows={5}
              value={certPem}
              placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
              onChange={(e) => setCertPem(e.target.value)}
            />
          </Field>
          <Field label="Private Key (PEM)" hint="paste the -----BEGIN PRIVATE KEY----- block">
            <textarea
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              rows={5}
              value={keyPem}
              placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
              onChange={(e) => setKeyPem(e.target.value)}
            />
          </Field>
          <Button type="button" size="sm" disabled={busy || !certPem.trim() || !keyPem.trim()} onClick={handleSavePaste}>
            {busy ? "Saving…" : "Save Certificate"}
          </Button>
        </div>
      )}

      {certErr && (
        <p className="text-xs text-destructive">{certErr}</p>
      )}
      {certOk && (
        <p className="text-xs text-green-600 dark:text-green-400">Certificate saved — paths filled below.</p>
      )}

      {/* Always-visible path fields — auto-filled but still editable */}
      <Field label="Certificate Path" hint="absolute path on server">
        <Input value={certPath} placeholder="/path/to/fullchain.pem" required
          onChange={(e) => onCertReady(e.target.value, keyPath)} />
      </Field>
      <Field label="Private Key Path" hint="absolute path on server">
        <Input value={keyPath} placeholder="/path/to/privkey.pem" required
          onChange={(e) => onCertReady(certPath, e.target.value)} />
      </Field>
    </div>
  );
}

function Hy2Section({ form, setForm }: { form: Hy2Form; setForm: React.Dispatch<React.SetStateAction<Hy2Form>> }) {
  return (
    <div className="space-y-3">
      <Field label="Inbound Tag" hint="unique identifier">
        <Input value={form.tag} placeholder="hysteria2-in" required onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} />
      </Field>
      <SectionHead>Network</SectionHead>
      <ListenRow listen={form.listen} listenPort={form.listen_port}
        onListen={(v) => setForm((f) => ({ ...f, listen: v }))}
        onPort={(v) => setForm((f) => ({ ...f, listen_port: v }))} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Upload Limit" hint="Mbps, 0=unlimited"><Input type="number" min={0} value={form.up_mbps} onChange={(e) => setForm((f) => ({ ...f, up_mbps: Number(e.target.value) }))} /></Field>
        <Field label="Download Limit" hint="Mbps, 0=unlimited"><Input type="number" min={0} value={form.down_mbps} onChange={(e) => setForm((f) => ({ ...f, down_mbps: Number(e.target.value) }))} /></Field>
      </div>
      <SectionHead>Obfuscation (optional)</SectionHead>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="obfs" checked={form.obfs} onChange={(e) => setForm((f) => ({ ...f, obfs: e.target.checked }))} />
        <label htmlFor="obfs" className="text-sm">Enable Salamander obfuscation</label>
      </div>
      {form.obfs && (
        <Field label="Obfuscation Password">
          <Input value={form.obfs_password} placeholder="Strong random password" required={form.obfs}
            onChange={(e) => setForm((f) => ({ ...f, obfs_password: e.target.value }))} />
        </Field>
      )}
      <SectionHead>TLS Certificate</SectionHead>
      <CertSetupWidget
        tag={form.tag}
        certPath={form.cert_path}
        keyPath={form.key_path}
        onCertReady={(cp, kp) => setForm((f) => ({ ...f, cert_path: cp, key_path: kp }))}
      />
    </div>
  );
}

function TrojanSection({ form, setForm }: { form: TrojanForm; setForm: React.Dispatch<React.SetStateAction<TrojanForm>> }) {
  return (
    <div className="space-y-3">
      <Field label="Inbound Tag" hint="unique identifier">
        <Input value={form.tag} placeholder="trojan-in" required onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} />
      </Field>
      <SectionHead>Network</SectionHead>
      <ListenRow listen={form.listen} listenPort={form.listen_port}
        onListen={(v) => setForm((f) => ({ ...f, listen: v }))}
        onPort={(v) => setForm((f) => ({ ...f, listen_port: v }))} />
      <SectionHead>TLS Certificate</SectionHead>
      <CertSetupWidget
        tag={form.tag}
        certPath={form.cert_path}
        keyPath={form.key_path}
        onCertReady={(cp, kp) => setForm((f) => ({ ...f, cert_path: cp, key_path: kp }))}
      />
    </div>
  );
}

function SsSection({ form, setForm }: { form: SsForm; setForm: React.Dispatch<React.SetStateAction<SsForm>> }) {
  return (
    <div className="space-y-3">
      <Field label="Inbound Tag" hint="unique identifier">
        <Input value={form.tag} placeholder="shadowsocks-in" required onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} />
      </Field>
      <SectionHead>Network</SectionHead>
      <ListenRow listen={form.listen} listenPort={form.listen_port}
        onListen={(v) => setForm((f) => ({ ...f, listen: v }))}
        onPort={(v) => setForm((f) => ({ ...f, listen_port: v }))} />
      <Field label="Allowed Transport" hint="blank = TCP+UDP">
        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={form.network} onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}>
          <option value="">TCP + UDP</option>
          <option value="tcp">TCP only</option>
          <option value="udp">UDP only</option>
        </select>
      </Field>
      <SectionHead>Encryption</SectionHead>
      <Field label="Method">
        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
          {SS_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Password">
        <Input value={form.password} placeholder="Strong random password" required
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
      </Field>
    </div>
  );
}

function CustomSection({ form, setForm }: { form: CustomForm; setForm: React.Dispatch<React.SetStateAction<CustomForm>> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Protocol Type">
          <select className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={form.type as string} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {INBOUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="TLS Profile ID" hint="0 = none">
          <Input type="number" min={0} value={form.tls_id as number}
            onChange={(e) => setForm((f) => ({ ...f, tls_id: Number(e.target.value) }))} />
        </Field>
      </div>
      <Field label="Inbound Tag" hint="unique identifier">
        <Input value={form.tag as string} required onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} />
      </Field>
      <ListenRow listen={form.listen as string} listenPort={form.listen_port as number}
        onListen={(v) => setForm((f) => ({ ...f, listen: v }))}
        onPort={(v) => setForm((f) => ({ ...f, listen_port: v }))} />
      <Field label="Additional Options (JSON)" hint="merged into sing-box inbound config">
        <textarea className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" rows={7}
          value={form.advJson} onChange={(e) => setForm((f) => ({ ...f, advJson: e.target.value }))} />
      </Field>
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function InboundDialog({ initialData, tlsProfiles, onSaved, trigger }: {
  initialData?: Inbound; tlsProfiles: TlsProfile[];
  onSaved: () => void; trigger: React.ReactElement;
}) {
  const tc = useTranslations("common");
  const initTls = tlsProfiles.find((t) => t.id === (initialData?.tls_id as number));

  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>(() =>
    initialData ? detectPreset(initialData, tlsProfiles) : "vless-reality"
  );
  const [vless,   setVless]   = useState<VlessForm>  (() => defaultVless(initialData, initTls));
  const [hy2,     setHy2]     = useState<Hy2Form>    (() => defaultHy2(initialData, initTls));
  const [trojan,  setTrojan]  = useState<TrojanForm> (() => defaultTrojan(initialData, initTls));
  const [ss,      setSs]      = useState<SsForm>     (() => defaultSs(initialData));
  const [custom,  setCustom]  = useState<CustomForm> (() => defaultCustom(initialData));
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v) {
      const tls = tlsProfiles.find((t) => t.id === (initialData?.tls_id as number));
      setPreset(initialData ? detectPreset(initialData, tlsProfiles) : "vless-reality");
      setVless(defaultVless(initialData, tls)); setHy2(defaultHy2(initialData, tls));
      setTrojan(defaultTrojan(initialData, tls)); setSs(defaultSs(initialData));
      setCustom(defaultCustom(initialData)); setError(null);
    }
  }

  async function handleGenerateRealityKeys() {
    setGeneratingKeys(true);
    try {
      const kp = await getKeypairs("reality");
      const priv = kp.find((s) => s.startsWith("PrivateKey: "))?.replace("PrivateKey: ", "") ?? "";
      const pub  = kp.find((s) => s.startsWith("PublicKey: "))?.replace("PublicKey: ", "") ?? "";
      setVless((f) => ({ ...f, private_key: priv, public_key: pub }));
    } catch { /* user can fill manually */ }
    finally { setGeneratingKeys(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const isEdit = !!initialData;
      const existingTlsId = (initialData?.tls_id as number) ?? 0;

      async function upsertTls(
        tag: string,
        server: Record<string, unknown>,
        client: Record<string, unknown> = {}
      ): Promise<number> {
        if (isEdit && existingTlsId > 0) {
          await updateTlsProfile(existingTlsId, `${tag}-tls`, server, client);
          return existingTlsId;
        }
        return createTlsProfile(`${tag}-tls`, server, client);
      }

      if (preset === "vless-reality") {
        const shortIds = vless.short_ids.split(",").map((s) => s.trim()).filter(Boolean);
        const invalidId = shortIds.find((s) => !/^[0-9a-fA-F]+$/.test(s));
        if (invalidId) { setError(`Short ID "${invalidId}" is not valid hex (use 0-9 and a-f only)`); setSaving(false); return; }
        const tlsServer = {
          enabled: true,
          server_name: vless.server_name,
          reality: {
            enabled: true,
            handshake: { server: vless.handshake_server, server_port: vless.handshake_port },
            private_key: vless.private_key,
            short_id: shortIds.length ? shortIds : [""],
          },
        };
        const tlsClient = {
          utls: { enabled: true, fingerprint: vless.fingerprint },
          reality: { enabled: false, public_key: vless.public_key, short_id: "" },
        };
        const tlsId = await upsertTls(vless.tag, tlsServer, tlsClient);
        const res = await saveInbound(isEdit ? "edit" : "new", {
          ...(isEdit ? { id: initialData!.id } : {}),
          type: "vless", tag: vless.tag, listen: vless.listen, listen_port: vless.listen_port, tls_id: tlsId,
        });
        if (!res.success) { setError(res.msg || "Failed to save"); return; }

      } else if (preset === "hysteria2") {
        const tlsId = await upsertTls(hy2.tag, {
          enabled: true, alpn: ["h3"], certificate_path: hy2.cert_path, key_path: hy2.key_path,
        });
        const payload: Record<string, unknown> = {
          ...(isEdit ? { id: initialData!.id } : {}),
          type: "hysteria2", tag: hy2.tag, listen: hy2.listen, listen_port: hy2.listen_port, tls_id: tlsId,
          ...(hy2.up_mbps > 0   ? { up_mbps:   hy2.up_mbps   } : {}),
          ...(hy2.down_mbps > 0 ? { down_mbps: hy2.down_mbps } : {}),
          ...(hy2.obfs ? { obfs: { type: "salamander", password: hy2.obfs_password } } : {}),
        };
        const res = await saveInbound(isEdit ? "edit" : "new", payload as Parameters<typeof saveInbound>[1]);
        if (!res.success) { setError(res.msg || "Failed to save"); return; }

      } else if (preset === "trojan") {
        const tlsId = await upsertTls(trojan.tag, {
          enabled: true, alpn: ["h2", "http/1.1"],
          certificate_path: trojan.cert_path, key_path: trojan.key_path,
        });
        const res = await saveInbound(isEdit ? "edit" : "new", {
          ...(isEdit ? { id: initialData!.id } : {}),
          type: "trojan", tag: trojan.tag, listen: trojan.listen, listen_port: trojan.listen_port, tls_id: tlsId,
        });
        if (!res.success) { setError(res.msg || "Failed to save"); return; }

      } else if (preset === "shadowsocks") {
        const payload: Record<string, unknown> = {
          ...(isEdit ? { id: initialData!.id } : {}),
          type: "shadowsocks", tag: ss.tag, listen: ss.listen, listen_port: ss.listen_port,
          method: ss.method, password: ss.password,
          ...(ss.network ? { network: ss.network } : {}),
        };
        const res = await saveInbound(isEdit ? "edit" : "new", payload as Parameters<typeof saveInbound>[1]);
        if (!res.success) { setError(res.msg || "Failed to save"); return; }

      } else {
        let extra: Record<string, unknown> = {};
        try { extra = JSON.parse(custom.advJson); }
        catch { setError("Invalid JSON in advanced options"); return; }
        const res = await saveInbound(isEdit ? "edit" : "new", {
          ...extra, ...(isEdit ? { id: initialData!.id } : {}),
          type: custom.type, tag: custom.tag, listen: custom.listen,
          listen_port: custom.listen_port, tls_id: custom.tls_id,
        });
        if (!res.success) { setError(res.msg || "Failed to save"); return; }
      }

      onSaved();
      toast.success(isEdit ? tc("updated") : tc("created"));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  }

  const isEdit = !!initialData;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[92vh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Inbound" : "Add Inbound"}</DialogTitle>
        </DialogHeader>

        {/* Protocol picker — create mode only */}
        {!isEdit && (
          <div className="space-y-1.5 pb-1">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPreset(p.id)}
                className={[
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  preset === p.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                ].join(" ")}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.label}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">{p.badge}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                </div>
                {preset === p.id && <span className="mt-0.5 shrink-0 text-primary text-sm">✓</span>}
              </button>
            ))}
          </div>
        )}

        {isEdit && (
          <p className="text-xs text-muted-foreground -mt-1 mb-1">
            Protocol: <span className="font-medium">{PRESETS.find((p) => p.id === preset)?.label ?? preset}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {preset === "vless-reality" && (
            <VlessSection form={vless} setForm={setVless}
              generatingKeys={generatingKeys} onGenerateKeys={handleGenerateRealityKeys} />
          )}
          {preset === "hysteria2"    && <Hy2Section    form={hy2}    setForm={setHy2} />}
          {preset === "trojan"       && <TrojanSection form={trojan} setForm={setTrojan} />}
          {preset === "shadowsocks"  && <SsSection     form={ss}     setForm={setSs} />}
          {preset === "custom"       && <CustomSection form={custom} setForm={setCustom} />}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={saving}>{saving ? tc("saving") : tc("save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InboundsPage() {
  const t = useTranslations("inbounds");

  const { data: inbounds = [], isLoading, error, mutate } = useSWR("/api/inbounds", () => getInbounds());
  const { data: tlsProfiles = [] } = useSWR("/api/tls", () => getTlsProfiles());

  async function handleDelete(tag: string) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      const res = await deleteInbound(tag);
      if (!res.success) {
        toast.error(res.msg || t("deleteError"));
        return;
      }
      mutate();
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteError"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <InboundDialog tlsProfiles={tlsProfiles} onSaved={() => mutate()}
          trigger={<Button size="sm">{t("add")}</Button>} />
      </div>

      {error && <p className="text-sm text-destructive">{t("loadError")}</p>}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("id")}</TableHead>
              <TableHead>{t("tag")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{t("port")}</TableHead>
              <TableHead>{t("users")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : inbounds.map((inb) => (
                  <TableRow key={inb.id}>
                    <TableCell className="text-muted-foreground text-xs">{inb.id}</TableCell>
                    <TableCell className="font-medium font-mono text-sm">{inb.tag as string}</TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {inb.type as string}
                        {(inb.tls_id as number) > 0 && <span className="ml-1 text-muted-foreground">+TLS</span>}
                      </span>
                    </TableCell>
                    <TableCell>{(inb.listen_port as number) ?? "—"}</TableCell>
                    <TableCell>{inb.users?.length ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <InboundDialog initialData={inb} tlsProfiles={tlsProfiles}
                          onSaved={() => mutate()}
                          trigger={<Button size="sm" variant="outline">{t("edit")}</Button>} />
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(inb.tag as string)}>
                          {t("delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
