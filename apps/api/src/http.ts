import { destroySession, resolveSession, SESSION_COOKIE } from "@omnibrain/auth";
import { AppError, forbidden, unauthorized } from "@omnibrain/core";
import { getMembership, listWorkspaces } from "@omnibrain/db";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { type AppEnv, dbOf } from "./env";

export type Ctx = Context<AppEnv>;

export function requestId(): string {
  return crypto.randomUUID();
}

export function jsonError(
  c: Ctx,
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return c.json(
    { error: { code, message, requestId: c.get("requestId"), details } },
    status as 400,
  );
}

export function background(c: Ctx, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise.catch((err) => console.error("background task failed", err));
  }
}

/** Resolve the session cookie, if any. Public routes stay public. */
export async function sessionMiddleware(c: Ctx, next: () => Promise<void>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = await resolveSession(dbOf(c.env), token);
    if (session) c.set("session", session);
  }
  await next();
}

export async function requireSession(c: Ctx, next: () => Promise<void>) {
  if (!c.get("session")) {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = await resolveSession(dbOf(c.env), token);
      if (session) c.set("session", session);
    }
  }
  if (!c.get("session")) throw unauthorized();
  await next();
}

/**
 * Resolves x-workspace-id (validated against membership) or the user's first
 * workspace. Every protected handler runs behind this.
 */
export async function workspaceMiddleware(c: Ctx, next: () => Promise<void>) {
  const session = c.get("session");
  if (!session) throw unauthorized();
  const db = dbOf(c.env);
  const requested = c.req.header("x-workspace-id");
  const workspaces = await listWorkspaces(db, session.user_id);

  if (workspaces.length === 0) throw forbidden("No workspace for this account");

  const workspace = requested ? workspaces.find((w) => w.id === requested) : workspaces[0];
  if (!workspace) throw forbidden("Not a member of that workspace");

  const membership = await getMembership(db, workspace.id, session.user_id);
  if (!membership) throw forbidden("Not a member of that workspace");

  c.set("workspaceId", workspace.id);
  c.set("workspace", workspace);
  c.set("role", membership.role);
  await next();
}

export function requireRole(c: Ctx, roles: Array<"owner" | "admin" | "member" | "viewer">) {
  if (!roles.includes(c.get("role"))) throw forbidden("Requires a higher role");
}

export function issueCookie(c: Ctx, token: string, maxAge: number) {
  const https = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: https,
    sameSite: https ? "None" : "Lax",
    path: "/",
    maxAge,
  });
}

export function clearCookie(c: Ctx) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export const CSRF_COOKIE = "omnibrain_csrf";

/** Readable double-submit token; paired with the session cookie on every mutation. */
export function issueCsrfCookie(c: Ctx) {
  if (getCookie(c, CSRF_COOKIE)) return;
  const https = new URL(c.req.url).protocol === "https:";
  setCookie(c, CSRF_COOKIE, crypto.randomUUID(), {
    httpOnly: false,
    secure: https,
    sameSite: https ? "None" : "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function csrfGuard(c: Ctx, next: () => Promise<void>) {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  // Browsers cannot forge Sec-Fetch-Site; same-origin tabs are already covered by originGuard.
  const site = c.req.header("sec-fetch-site");
  if (site === "same-origin" || site === "same-site") return next();
  const cookie = getCookie(c, CSRF_COOKIE);
  const header = c.req.header("x-csrf-token");
  if (!cookie || !header || cookie !== header) {
    throw forbidden("CSRF token missing or invalid");
  }
  return next();
}

export async function logout(c: Ctx) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(dbOf(c.env), token);
  clearCookie(c);
}

const buckets = new Map<string, { count: number; reset: number }>();

/** Best-effort per-isolate limiter. DO counters are the durable path (see PLAN §14). */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count++;
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  }
  return bucket.count <= limit;
}

export function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
}

export function originAllowed(c: Ctx, origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients; cookie CSRF still requires a browser origin
  const app = c.env.APP_ORIGIN ?? "http://localhost:5173";
  if (origin === app) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

export function originGuard(c: Ctx, next: () => Promise<void>) {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (!originAllowed(c, c.req.header("origin"))) {
      throw forbidden("Cross-origin request rejected");
    }
  }
  return next();
}

/** Per-user write budget; reads stay unmetered. Best-effort per isolate, like rateLimit. */
export function writeRateLimit(c: Ctx, next: () => Promise<void>) {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const key = `write:${c.get("workspaceId")}:${c.get("session")?.user_id ?? "anon"}`;
  if (!rateLimit(key, 120, 60_000)) {
    throw new AppError("rate_limited", "Too many writes. Try again in a minute.", 429);
  }
  return next();
}

export function appErrorToResponse(c: Ctx, err: unknown) {
  if (err instanceof AppError) {
    return jsonError(c, err.code, err.message, err.status, err.details);
  }
  console.error("unhandled", err);
  return jsonError(c, "internal", "Something went wrong", 500);
}
