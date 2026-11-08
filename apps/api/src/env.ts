import type { SessionUser } from "@omnibrain/db";
import {
  type D1Like,
  forWorkspace,
  fromD1,
  type SqlClient,
  type WorkspaceRow,
} from "@omnibrain/db";

/** The Cloudflare Email Service `send_email` binding. */
export interface EmailSender {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

export interface Env {
  DB: D1Like | SqlClient;
  BLOBS?: R2Bucket;
  VECTORS?: VectorizeIndex;
  AI?: Ai;
  ENRICH_QUEUE?: Queue<{ workspaceId: string; itemId: string }>;
  AUTH_SECRET: string;
  TOKEN_KEY?: string;
  APP_ORIGIN?: string;
  DEV_MODE?: string;
  EMAIL?: EmailSender;
  EMAIL_FROM?: string;
  NOTION_CLIENT_ID?: string;
  NOTION_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  RAINDROP_CLIENT_ID?: string;
  RAINDROP_CLIENT_SECRET?: string;
}

export interface Variables {
  requestId: string;
  session: SessionUser;
  workspaceId: string;
  workspace: WorkspaceRow;
  role: "owner" | "admin" | "member" | "viewer";
}

export type AppEnv = { Bindings: Env; Variables: Variables };

function isSqlClient(db: unknown): db is SqlClient {
  const d = db as { all?: unknown; prepare?: unknown };
  return typeof d.all === "function" && typeof d.prepare !== "function";
}

export function dbOf(env: Env): SqlClient {
  return isSqlClient(env.DB) ? env.DB : fromD1(env.DB as unknown as D1Like);
}

export function repoOf(env: Env, workspaceId: string) {
  return forWorkspace(dbOf(env), workspaceId);
}

export function isDev(env: Env): boolean {
  return env.DEV_MODE === "1" || env.DEV_MODE === "true";
}
