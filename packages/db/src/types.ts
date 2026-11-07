export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "team";
  stripe_customer_id: string | null;
  created_at: number;
  deleted_at: number | null;
}

export interface MembershipRow {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: number;
}

export interface ItemRow {
  id: string;
  workspace_id: string;
  kind: "bookmark" | "note" | "highlight" | "file";
  source: string;
  connection_id: string | null;
  external_id: string | null;
  url: string | null;
  canonical_url: string | null;
  title: string;
  excerpt: string | null;
  content_r2_key: string | null;
  summary: string | null;
  lang: string | null;
  author: string | null;
  published_at: number | null;
  captured_at: number;
  content_hash: string;
  tags_text: string;
  embedding_state: "pending" | "ready" | "failed" | "skipped";
  archived_at: number | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ConnectionRow {
  id: string;
  workspace_id: string;
  app_id: string;
  external_account_id: string | null;
  status: "authorizing" | "connected" | "degraded" | "paused" | "revoked";
  scopes: string;
  secret_ciphertext: string | null;
  cursor: string | null;
  last_synced_at: number | null;
  last_error: string | null;
  created_at: number;
}

export interface ImportRow {
  id: string;
  workspace_id: string;
  kind: string;
  status: "queued" | "parsing" | "enriching" | "done" | "failed";
  total: number;
  processed: number;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

export interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_hash: string;
  prefix: string;
  scopes: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export interface SessionUser {
  user_id: string;
  email: string;
  name: string | null;
  session_id: string;
  expires_at: number;
}
