const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "error",
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers,
    body,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(
      err?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.error?.code,
    );
  }
  return data as T;
}

export interface Item {
  id: string;
  workspace_id: string;
  kind: "bookmark" | "note" | "highlight" | "file";
  source: string;
  connection_id: string | null;
  external_id: string | null;
  url: string | null;
  title: string;
  excerpt: string | null;
  content_r2_key: string | null;
  summary: string | null;
  lang: string | null;
  author: string | null;
  captured_at: number;
  tags_text: string;
  embedding_state: "pending" | "ready" | "failed" | "skipped";
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SearchHit extends Item {
  score: number;
  matched: "lexical" | "semantic" | "both" | "recent";
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
  answer: string | null;
  meta: {
    lexical: number;
    semantic: number;
    tookMs: number;
    mode: "hybrid" | "lexical" | "recent";
  };
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "team";
}

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Me {
  user: User;
  workspace: Workspace;
  workspaces: Workspace[];
}

export interface QuotaBucket {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  reason?: string;
}

export interface Account {
  user: {
    user_id: string;
    email: string;
    name: string | null;
    session_id: string;
    expires_at: number;
  };
  workspace: Workspace;
  role: "owner" | "admin" | "member" | "viewer";
  usage: {
    items: number;
    connections: number;
    seats: number;
    api_keys: number;
    mcp_calls_day: number;
    enrichments_month: number;
  };
  entitlements: Record<string, QuotaBucket>;
}

export interface AppInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "ga" | "beta" | "import-only";
  auth: "oauth2" | "token" | "file-import" | "none";
  scopes: string[];
  capabilities: string[];
  glyph: string;
  tone: "amber" | "cobalt" | "mint" | "coral" | "muted";
  schedule?: string;
  configured: boolean;
  credential_source: "db" | "env" | null;
  installed: boolean;
  connection: {
    id: string;
    status: "authorizing" | "connected" | "degraded" | "paused" | "revoked";
    last_synced_at: number | null;
    last_error: string | null;
    scopes: string;
  } | null;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export interface McpEvent {
  id: string;
  api_key_id: string | null;
  event: "connect" | "tools_list" | "tool_call" | "error" | "request";
  tool: string | null;
  client_name: string | null;
  client_version: string | null;
  status: "ok" | "error";
  duration_ms: number;
  detail: string | null;
  created_at: number;
}

export interface ImportRow {
  id: string;
  kind: string;
  status: string;
  total: number;
  processed: number;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

export const api = {
  requestOtp: (email: string) =>
    request<{
      sent: boolean;
      delivered: boolean;
      expires_at: number;
      dev_code?: string;
      email_configured: boolean;
    }>("/auth/request-otp", { method: "POST", body: { email } }),
  verifyOtp: (email: string, code: string) =>
    request<{ user: User; workspace: Workspace }>("/auth/verify", {
      method: "POST",
      body: { email, code },
    }),
  me: () => request<Me>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  items: (params: { limit?: number; source?: string; kind?: string; cursor?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    return request<{ items: Item[]; total: number; nextCursor: string | null }>(`/items?${qs}`);
  },
  item: (id: string) => request<{ item: Item }>(`/items/${id}`),
  createItem: (input: {
    url?: string;
    title?: string;
    note?: string;
    tags?: string[];
    source?: string;
    kind?: string;
    enrich?: boolean;
  }) => request<{ item: Item; created: boolean }>("/items", { method: "POST", body: input }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/items/${id}`, { method: "DELETE" }),
  retryItem: (id: string) => request<{ ok: boolean }>(`/items/${id}/retry`, { method: "POST" }),

  search: (input: {
    query: string;
    limit?: number;
    answer?: boolean;
    source?: string;
    kind?: string;
  }) => request<SearchResponse>("/search", { method: "POST", body: input }),

  account: () => request<Account>("/account"),
  changePlan: (plan: "free" | "pro" | "team") =>
    request<{ ok: boolean; plan: string }>("/plan", {
      method: "PATCH",
      body: { plan },
    }),
  workspaces: () => request<{ workspaces: Workspace[] }>("/workspaces"),

  apps: () => request<{ apps: AppInfo[] }>("/apps"),
  setCredentials: (app_id: string, clientId: string, clientSecret: string) =>
    request<{ ok: boolean }>(`/apps/${app_id}/credentials`, {
      method: "PUT",
      body: { clientId, clientSecret },
    }),
  deleteCredentials: (app_id: string) =>
    request<{ ok: boolean }>(`/apps/${app_id}/credentials`, { method: "DELETE" }),
  connect: (app_id: string) =>
    request<{ authorize_url?: string; state?: string }>("/apps/connections", {
      method: "POST",
      body: { app_id },
    }),
  syncConnection: (id: string) =>
    request<{
      ok: boolean;
      fetched: number;
      created: number;
      duplicateCount: number;
      duplicates: Array<{ title: string; url: string | null }>;
    }>(`/apps/connections/${id}/sync`, { method: "POST" }),
  pauseConnection: (id: string) =>
    request<{ ok: boolean }>(`/apps/connections/${id}/pause`, { method: "POST" }),
  resumeConnection: (id: string) =>
    request<{ ok: boolean }>(`/apps/connections/${id}/resume`, { method: "POST" }),
  disconnect: (id: string, deleteItems: boolean) =>
    request<{ ok: boolean }>(`/apps/connections/${id}?delete_items=${deleteItems ? "1" : "0"}`, {
      method: "DELETE",
    }),

  createImport: (kind: "browser_html" | "keep_takeout" | "obsidian_zip", total: number) =>
    request<{ import: ImportRow }>("/imports", { method: "POST", body: { kind, total } }),
  importBatch: (
    id: string,
    items: Array<{
      url?: string;
      title?: string;
      note?: string;
      tags?: string[];
      source?: string;
      kind?: string;
      captured_at?: number;
    }>,
  ) =>
    request<{ import: ImportRow; created: number; duplicates: number; blocked: number }>(
      `/imports/${id}/batches`,
      { method: "POST", body: { items } },
    ),
  finishImport: (id: string, status: "done" | "failed", error?: string) =>
    request<{ ok: boolean }>(`/imports/${id}/finish`, { method: "POST", body: { status, error } }),

  keys: () => request<{ keys: ApiKey[] }>("/keys"),
  keyEvents: (id: string) => request<{ events: McpEvent[] }>(`/keys/${id}/events`),
  createKey: (name: string) =>
    request<{ key: string; apiKey: ApiKey }>("/keys", { method: "POST", body: { name } }),
  revokeKey: (id: string) => request<{ ok: boolean }>(`/keys/${id}`, { method: "DELETE" }),

  deleteAccount: () => request<{ ok: boolean }>("/account", { method: "DELETE" }),
};

export async function exportData(): Promise<Blob> {
  const res = await fetch(`${BASE}/api/v1/export`, { credentials: "include" });
  if (!res.ok) throw new ApiError("Export failed", res.status);
  return res.blob();
}

export async function callMcp<T>(
  endpoint: string,
  apiKey: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const data = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new ApiError(data.error?.message ?? "MCP call failed", res.status);
  return data;
}

export const mcpEndpoint = `${BASE || window.location.origin}/mcp`;
export const apiConfigured = true;
