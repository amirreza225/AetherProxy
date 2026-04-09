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
