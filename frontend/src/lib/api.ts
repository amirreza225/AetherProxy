/**
 * Typed fetch wrapper for the AetherProxy API.
 * All requests include the JWT from either the Authorization header or the
 * aether_token cookie (the backend accepts both).
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:2095";

interface ApiResponse<T = unknown> {
  success: boolean;
  msg: string;
  obj: T;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include", // send aether_token cookie
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Let the calling component handle the redirect
    throw new Error("UNAUTHORIZED");
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

// ── Users ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
}

export async function getUsers(headers?: HeadersInit) {
  return apiFetch<User[]>("/api/users", { headers });
}

// ── Full config (inbounds, outbounds, clients, …) ────────────────────────────

export async function loadData(headers?: HeadersInit) {
  return apiFetch<Record<string, unknown>>("/api/load", { headers });
}

export async function loadPartial(
  sections: string[],
  headers?: HeadersInit
) {
  return apiFetch<Record<string, unknown>>(
    `/api/${sections[0]}`,
    { headers }
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(headers?: HeadersInit) {
  return apiFetch<Record<string, unknown>>("/api/settings", { headers });
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

export function subUrl(token: string): string {
  const subBase =
    process.env.NEXT_PUBLIC_SUB_URL ?? BASE_URL.replace("2095", "2096");
  return `${subBase}/sub/${token}`;
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
}

export async function getNodes(headers?: HeadersInit) {
  return apiFetch<Node[]>("/api/nodes", { headers });
}

export async function createNode(node: Omit<Node, "id" | "status" | "lastPing">) {
  return apiFetch<Node>("/api/createNode", {
    method: "POST",
    body: new URLSearchParams(node as unknown as Record<string, string>),
  });
}

export async function updateNode(node: Node) {
  return apiFetch<Node>("/api/updateNode", {
    method: "POST",
    body: new URLSearchParams(node as unknown as Record<string, string>),
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
