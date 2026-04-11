/**
 * Typed fetch wrapper for the AetherProxy API.
 * All requests include the JWT from either the Authorization header or the
 * aether_token cookie (the backend accepts both).
 */

function resolveDefaultApiBase(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:2095";
  }

  return "";
}

const configuredApiBase = process.env.NEXT_PUBLIC_API_URL?.trim();
const BASE_URL =
  (configuredApiBase ? configuredApiBase.replace(/\/$/, "") : "") ||
  resolveDefaultApiBase();

const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export function getClientAuthToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return sessionStorage.getItem("aether_token") ?? "";
}

export function setClientAuthToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.setItem("aether_token", token);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `aether_token=${encodeURIComponent(token)}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearClientAuthToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.removeItem("aether_token");
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `aether_token=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  msg: string;
  obj: T;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  if (!headers.has("X-Requested-With")) {
    headers.set("X-Requested-With", "XMLHttpRequest");
  }

  const token = getClientAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include", // send aether_token cookie
    headers,
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  // The rate-limit response uses a different shape: { "error": "..." }.
  // Normalise it into the standard ApiResponse so callers don't need to
  // handle the raw 429 body themselves.
  if (res.status === 429) {
    let errorMsg = "Too many requests";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch { /* ignore – keep default message */ }
    return { success: false, msg: errorMsg, obj: undefined as T };
  }

  const data: ApiResponse<T> = await res.json();
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(user: string, pass: string) {
  return apiFetch<{ token: string }>("/api/login", {
    method: "POST",
    body: new URLSearchParams({ user, pass }),
  });
}

export async function logout() {
  return apiFetch("/api/logout");
}

// ── Dashboard / Status ────────────────────────────────────────────────────────

export async function getStatus(headers?: HeadersInit) {
  return apiFetch<Record<string, unknown>>("/api/status", { headers });
}

export async function getOnlines(headers?: HeadersInit) {
  return apiFetch<unknown[]>("/api/onlines", { headers });
}

// ── Admin users (panel login accounts) ───────────────────────────────────────

export interface User {
  id: number;
  username: string;
}

export async function getUsers(headers?: HeadersInit) {
  return apiFetch<User[]>("/api/users", { headers });
}

// ── Subscription clients (traffic-limited end-users) ──────────────────────────

export interface Client {
  id: number;
  enable: boolean;
  name: string;
  volume: number;       // bytes; 0 = unlimited
  expiry: number;       // unix seconds; 0 = never
  down: number;
  up: number;
  totalDown: number;
  totalUp: number;
  autoReset: boolean;
  resetDays: number;
  inbounds: Array<string | number>;
  links?: Array<Record<string, string>>;
  config?: Record<string, unknown>;
  desc?: string;
  group?: string;
  delayStart?: boolean;
}

function normalizeClientPayload(client: Partial<Client>): Record<string, unknown> {
  return {
    ...client,
    inbounds: Array.isArray(client.inbounds) ? client.inbounds : [],
    links: Array.isArray(client.links) ? client.links : [],
    config: client.config && typeof client.config === "object" ? client.config : {},
  };
}

export async function getClients(headers?: HeadersInit) {
  return apiFetch<Client[]>("/api/clients", { headers });
}

export async function getClient(id: number): Promise<Client | null> {
  const res = await apiFetch<Record<string, unknown>>(`/api/clients?id=${id}`);
  const obj = res.obj as { clients?: Client[] } | Client[] | null;
  if (Array.isArray(obj)) return (obj as Client[])[0] ?? null;
  if (obj && Array.isArray((obj as { clients?: Client[] }).clients)) {
    return ((obj as { clients: Client[] }).clients)[0] ?? null;
  }
  return null;
}

export async function createClient(client: Omit<Client, "id" | "down" | "up" | "totalDown" | "totalUp">) {
  return apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "clients",
      action: "new",
      data: JSON.stringify(normalizeClientPayload(client)),
    }),
  });
}

export async function updateClient(client: Client) {
  return apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "clients",
      action: "edit",
      data: JSON.stringify(normalizeClientPayload(client)),
    }),
  });
}

export async function deleteClient(id: number) {
  return apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "clients",
      action: "del",
      data: JSON.stringify(id),
    }),
  });
}

export async function changePass(
  oldPass: string,
  newUsername: string,
  newPass: string
) {
  return apiFetch<Record<string, unknown>>("/api/changePass", {
    method: "POST",
    body: new URLSearchParams({ oldPass, newUsername, newPass }),
  });
}

// ── TLS Profiles ──────────────────────────────────────────────────────────────

export interface TlsProfile {
  id: number;
  name: string;
  server: Record<string, unknown>;
  client?: Record<string, unknown>;
}

export async function getTlsProfiles(headers?: HeadersInit): Promise<TlsProfile[]> {
  const res = await apiFetch<Record<string, unknown>>("/api/tls", { headers });
  const tls = (res.obj as { tls?: unknown }).tls;
  return Array.isArray(tls) ? (tls as TlsProfile[]) : [];
}

/**
 * Creates a TLS profile and returns its database ID.
 * POST /api/save object=tls action=new → response includes full tls list.
 */
export async function createTlsProfile(
  name: string,
  server: Record<string, unknown>,
  client: Record<string, unknown> = {}
): Promise<number> {
  const res = await apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "tls",
      action: "new",
      data: JSON.stringify({ name, server, client }),
    }),
  });
  if (!res.success) throw new Error(res.msg || "Failed to create TLS profile");
  const tls = ((res.obj as Record<string, unknown>).tls ?? []) as TlsProfile[];
  const created = tls.find((t) => t.name === name);
  if (!created) throw new Error("TLS profile not found after creation");
  return created.id;
}

export async function updateTlsProfile(
  id: number,
  name: string,
  server: Record<string, unknown>,
  client: Record<string, unknown> = {}
): Promise<void> {
  const res = await apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "tls",
      action: "edit",
      data: JSON.stringify({ id, name, server, client }),
    }),
  });
  if (!res.success) throw new Error(res.msg || "Failed to update TLS profile");
}

/**
 * Generates a keypair of the given type.
 * k=reality → ["PrivateKey: <b64url>", "PublicKey: <b64url>"]
 */
export async function getKeypairs(k: string): Promise<string[]> {
  const res = await apiFetch<string[]>(`/api/keypairs?k=${k}`);
  return Array.isArray(res.obj) ? (res.obj as string[]) : [];
}

// ── Certificate provisioning ──────────────────────────────────────────────────

/**
 * Requests a Let's Encrypt certificate for a domain via HTTP-01 ACME challenge.
 * The server must be reachable on port 80 from the public internet.
 * Returns the absolute paths where the cert and key were saved.
 */
export async function issueLetsEncryptCert(domain: string, email: string) {
  return apiFetch<{ cert_path: string; key_path: string }>("/api/issueCert", {
    method: "POST",
    body: new URLSearchParams({ domain, email }),
  });
}

/**
 * Saves pasted PEM certificate + key content to files on the server.
 * Useful for Cloudflare Origin Certificates or any externally-obtained cert.
 * Returns the absolute paths where the cert and key were saved.
 */
export async function savePastedCert(tag: string, cert: string, key: string) {
  return apiFetch<{ cert_path: string; key_path: string }>("/api/saveCert", {
    method: "POST",
    body: new URLSearchParams({ tag, cert, key }),
  });
}

// ── Inbounds ──────────────────────────────────────────────────────────────────

export interface Inbound {
  id: number;
  type: string;
  tag: string;
  tls_id?: number;
  listen?: string;
  listen_port?: number;
  users?: string[];
  [key: string]: unknown;
}

export async function getInbounds(headers?: HeadersInit) {
  const res = await apiFetch<{ inbounds: Inbound[] }>("/api/inbounds", { headers });
  const obj = res.obj as unknown;
  if (obj && typeof obj === "object" && Array.isArray((obj as { inbounds?: Inbound[] }).inbounds)) {
    return (obj as { inbounds: Inbound[] }).inbounds;
  }
  return [] as Inbound[];
}

export async function saveInbound(action: "new" | "edit", data: Omit<Inbound, "users">) {
  return apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "inbounds",
      action,
      data: JSON.stringify(data),
    }),
  });
}

export async function deleteInbound(tag: string) {
  return apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "inbounds",
      action: "del",
      data: JSON.stringify(tag),
    }),
  });
}

/** Build the subscription URL for a client by name. */
export function clientSubUrl(clientName: string): string {
  const configuredSubBase = process.env.NEXT_PUBLIC_SUB_URL?.trim();
  const subBase = (configuredSubBase ? configuredSubBase.replace(/\/$/, "") : "")
    || (BASE_URL.includes(":2095") ? BASE_URL.replace(":2095", ":2096") : BASE_URL);
  return `${subBase}/sub/${encodeURIComponent(clientName)}`;
}

// ── Full config (inbounds, outbounds, clients, …) ────────────────────────────

export async function loadData(headers?: HeadersInit) {
  return apiFetch<Record<string, unknown>>("/api/load", { headers });
}

export async function loadPartial(
  section: string,
  headers?: HeadersInit
) {
  return apiFetch<Record<string, unknown>>(
    `/api/${section}`,
    { headers }
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(headers?: HeadersInit) {
  return apiFetch<Record<string, unknown>>("/api/settings", { headers });
}

export async function saveSettings(settings: Record<string, unknown>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    normalized[key] = value == null ? "" : String(value);
  }

  return apiFetch<Record<string, unknown>>("/api/save", {
    method: "POST",
    body: new URLSearchParams({
      object: "settings",
      action: "edit",
      data: JSON.stringify(normalized),
    }),
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getStats(
  resource: string,
  tag: string,
  limit = 100,
  headers?: HeadersInit
) {
  const params = new URLSearchParams({ resource, tag, l: String(limit) });
  return apiFetch<unknown[]>(`/api/stats?${params}`, { headers });
}

// ── Subscription ──────────────────────────────────────────────────────────────

export interface SubscriptionToken {
  id: number;
  desc: string;
  token: string;
  expiry: number;
  userId?: number;
}

export function subUrl(token: string): string {
  const configuredSubBase = process.env.NEXT_PUBLIC_SUB_URL?.trim();
  const subBase = (configuredSubBase ? configuredSubBase.replace(/\/$/, "") : "")
    || (BASE_URL.includes(":2095") ? BASE_URL.replace(":2095", ":2096") : BASE_URL);
  return `${subBase}/sub/${token}`;
}

export async function getTokens(headers?: HeadersInit) {
  return apiFetch<SubscriptionToken[]>("/api/tokens", { headers });
}

export async function addToken(expiryDays: number, desc: string) {
  return apiFetch<string>("/api/addToken", {
    method: "POST",
    body: new URLSearchParams({
      expiry: String(expiryDays),
      desc,
    }),
  });
}

export async function deleteToken(id: number) {
  return apiFetch<Record<string, unknown>>("/api/deleteToken", {
    method: "POST",
    body: new URLSearchParams({ id: String(id) }),
  });
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface Node {
  id: number;
  name: string;
  host: string;
  sshPort: number;
  sshKeyPath: string;
  provider: string;
  status: "online" | "offline" | "unknown";
  lastPing: number;
  /** Base64-encoded host public-key stored on first SSH connection (TOFU).
   *  Empty string means no key has been pinned yet.  Reset to "" to re-trust. */
  sshKnownKey?: string;
}

function toSearchParams(
  values: Record<string, string | number | boolean | null | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue;
    params.set(key, String(value));
  }
  return params;
}

export async function getNodes(headers?: HeadersInit) {
  return apiFetch<Node[]>("/api/nodes", { headers });
}

export async function createNode(node: Omit<Node, "id" | "status" | "lastPing">) {
  return apiFetch<Node>("/api/createNode", {
    method: "POST",
    body: toSearchParams({
      name: node.name,
      host: node.host,
      sshPort: node.sshPort,
      sshKeyPath: node.sshKeyPath,
      provider: node.provider,
    }),
  });
}

export async function updateNode(node: Node) {
  return apiFetch<Node>("/api/updateNode", {
    method: "POST",
    body: toSearchParams({
      id: node.id,
      name: node.name,
      host: node.host,
      sshPort: node.sshPort,
      sshKeyPath: node.sshKeyPath,
      provider: node.provider,
      status: node.status,
      lastPing: node.lastPing,
      sshKnownKey: node.sshKnownKey ?? "",
    }),
  });
}

export async function deleteNode(id: number) {
  return apiFetch("/api/deleteNode", {
    method: "POST",
    body: new URLSearchParams({ id: String(id) }),
  });
}

export async function deployNode(id: number) {
  return apiFetch("/api/deployNode", {
    method: "POST",
    body: new URLSearchParams({ id: String(id) }),
  });
}

// ── Port Sync ────────────────────────────────────────────────────────────────

export interface PortSyncTask {
  id: number;
  scope: "local" | "node";
  nodeId: number;
  reason: string;
  attempts: number;
  lastError: string;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface PortSyncStatus {
  enabled: boolean;
  localEnabled: boolean;
  remoteEnabled: boolean;
  retrySeconds: number;
  ufwBinary: string;
  localCapabilityOk: boolean;
  localCapabilityNote: string;
  pendingTasks: number;
  pendingLocal: number;
  pendingNode: number;
  nextRunAt: number;
  tasks: PortSyncTask[];
}

export async function getPortSyncStatus(limit = 30, headers?: HeadersInit) {
  return apiFetch<PortSyncStatus>(`/api/portsyncStatus?limit=${limit}`, { headers });
}

export async function triggerPortSync(reason = "manual-ui", nodeId?: number) {
  const body = new URLSearchParams({ reason });
  if (typeof nodeId === "number" && Number.isFinite(nodeId) && nodeId > 0) {
    body.set("nodeId", String(nodeId));
  }
  return apiFetch<{ queued: boolean; nodeId: number; reason: string }>("/api/portsyncSync", {
    method: "POST",
    body,
  });
}

export async function retryPortSync(limit = 30) {
  return apiFetch("/api/portsyncRetry", {
    method: "POST",
    body: new URLSearchParams({ limit: String(limit) }),
  });
}

export async function clearPortSync(scope = "", nodeId?: number) {
  const body = new URLSearchParams();
  if (scope) {
    body.set("scope", scope);
  }
  if (typeof nodeId === "number" && Number.isFinite(nodeId) && nodeId > 0) {
    body.set("nodeId", String(nodeId));
  }
  return apiFetch<{ deleted: number; scope: string; nodeId: number }>("/api/portsyncClear", {
    method: "POST",
    body,
  });
}

// ── Routing ───────────────────────────────────────────────────────────────────

export interface RouteRule {
  inbound?: string[];
  network?: string;
  domain_suffix?: string[];
  geoip?: string[];
  outbound?: string;
  action?: string;
}

export async function getRouting(headers?: HeadersInit) {
  return apiFetch<RouteRule[]>("/api/routing", { headers });
}

export async function saveRouting(rules: RouteRule[]) {
  return apiFetch("/api/saveRouting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rules),
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsData {
  perProtocol: Record<string, { up: number; down: number }>;
  evasionEvents: Array<{
    id: number;
    dateTime: number;
    source: string;
    protocol: string;
    port: number;
    domain: string;
    detail: string;
    autoAction: string;
  }>;
  windowHours: number;
}

export async function getAnalytics(hours = 24, headers?: HeadersInit) {
  return apiFetch<AnalyticsData>(`/api/analytics?h=${hours}`, { headers });
}

// ── Plugins ───────────────────────────────────────────────────────────────────

export interface PluginInfo {
  name: string;
  description: string;
  enabled: boolean;
  config: unknown;
}

export async function getPlugins(headers?: HeadersInit) {
  return apiFetch<PluginInfo[]>("/api/plugins", { headers });
}

export async function setPluginEnabled(name: string, enabled: boolean) {
  return apiFetch("/api/setPluginEnabled", {
    method: "POST",
    body: new URLSearchParams({ name, enabled: String(enabled) }),
  });
}

export async function setPluginConfig(name: string, config: unknown) {
  return apiFetch("/api/setPluginConfig", {
    method: "POST",
    body: new URLSearchParams({ name, config: JSON.stringify(config) }),
  });
}

// ── Decentralized Discovery ───────────────────────────────────────────────────

export interface DiscoveryStatus {
  running: boolean;
  memberCount: number;
}

export interface PeerNode {
  id: number;
  name: string;
  address: string;
  gossipPort: number;
  version: string;
  status: "alive" | "suspect" | "dead" | "left";
  lastSeen: number;
}

export async function getDiscoveryStatus(headers?: HeadersInit) {
  return apiFetch<DiscoveryStatus>("/api/discoveryStatus", { headers });
}

export async function getDiscoveryPeers(headers?: HeadersInit) {
  return apiFetch<PeerNode[]>("/api/discoveryPeers", { headers });
}

export async function discoveryJoin() {
  return apiFetch("/api/discoveryJoin", { method: "POST", body: "" });
}

export async function discoveryLeave() {
  return apiFetch("/api/discoveryLeave", { method: "POST", body: "" });
}

export async function discoveryAddPeer(addr: string) {
  return apiFetch("/api/discoveryAddPeer", {
    method: "POST",
    body: new URLSearchParams({ addr }),
  });
}
