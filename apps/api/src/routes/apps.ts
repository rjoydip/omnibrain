import { APP_CATALOG, getApp, pkceChallenge } from "@omnibrain/connectors";
import {
  AppError,
  ConnectionCreateSchema,
  PLANS,
  canSyncInterval,
  checkEntitlement,
  type PlanId,
  quotaExceeded,
  randomToken,
  syncIntervalsFor,
} from "@omnibrain/core";
import {
  deleteProviderCredential,
  getCached,
  getWorkspace,
  setCached,
  upsertProviderCredential,
} from "@omnibrain/db";
import { Hono } from "hono";
import { z } from "zod";
import { encryptSecret } from "../crypto";
import { type AppEnv, dbOf, repoOf } from "../env";
import { requireRole } from "../http";
import {
  authorizeUrl,
  exchangeForApp,
  fetchExternalAccountId,
  resolveProvider,
  syncConnection,
} from "../services/connectors";
import { body } from "../validate";
import { planUsage } from "./items";

interface PendingOAuth {
  appId: string;
  workspaceId: string;
  userId: string;
  verifier: string;
  redirectUri: string;
}

/** Seed a new connection from the catalog's default cron (`*\/15 * * * *` → 15). */
function defaultInterval(appId: string): number {
  const match = getApp(appId)?.schedule?.match(/^\*\/(\d+) \* \* \* \*$/);
  return match?.[1] ? Number(match[1]) : 0;
}

/** Clamp the catalog default to a cadence the plan actually allows. */
function planDefaultInterval(plan: PlanId, appId: string): number {
  const allowed = syncIntervalsFor(plan);
  const candidate = defaultInterval(appId);
  return allowed.includes(candidate) ? candidate : (allowed[0] ?? 0);
}

export const appRoutes = new Hono<AppEnv>();

appRoutes.get("/", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const connections = await repo.listConnections();
  const plan = c.get("workspace").plan as PlanId;
  const intervals = syncIntervalsFor(plan);
  const byApp = new Map(connections.map((conn) => [conn.app_id, conn]));
  const apps = await Promise.all(
    APP_CATALOG.map(async (app) => {
      const conn = byApp.get(app.id);
      const provider = app.auth === "oauth2" ? await resolveProvider(c.env, app.id) : null;
      return {
        ...app,
        configured:
          app.auth === "oauth2" ? Boolean(provider?.clientId && provider.clientSecret) : true,
        token_auth: Boolean(app.tokenAuth),
        credential_source: provider?.source ?? null,
        installed: Boolean(conn),
        connection: conn
          ? {
              id: conn.id,
              status: conn.status,
              last_synced_at: conn.last_synced_at,
              last_error: conn.last_error,
              scopes: conn.scopes,
              // Downgrades can leave an out-of-plan cadence stored; show a valid one.
              sync_interval_minutes: intervals.includes(conn.sync_interval_minutes)
                ? conn.sync_interval_minutes
                : (intervals[0] ?? 0),
            }
          : null,
      };
    }),
  );
  return c.json({ apps, sync_intervals: intervals });
});

const CredentialsSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(500),
});

/** Store OAuth app credentials encrypted; env vars remain the fallback. */
appRoutes.put("/:id/credentials", body(CredentialsSchema), async (c) => {
  requireRole(c, ["owner", "admin"]);
  const appId = c.req.param("id");
  const app = getApp(appId);
  if (!app || app.auth !== "oauth2") {
    throw new AppError("bad_request", "Only OAuth apps accept credentials", 400);
  }
  const { clientId, clientSecret } = c.req.valid("json");
  const ciphertext = await encryptSecret(c.env.TOKEN_KEY ?? c.env.AUTH_SECRET, clientSecret);
  await upsertProviderCredential(dbOf(c.env), appId, clientId, ciphertext);
  await repoOf(c.env, c.get("workspaceId")).audit(
    c.get("session").user_id,
    "provider.credentials.set",
    appId,
  );
  return c.json({ ok: true });
});

appRoutes.delete("/:id/credentials", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const appId = c.req.param("id");
  const app = getApp(appId);
  if (!app || app.auth !== "oauth2") {
    throw new AppError("bad_request", "Only OAuth apps accept credentials", 400);
  }
  await deleteProviderCredential(dbOf(c.env), appId);
  await repoOf(c.env, c.get("workspaceId")).audit(
    c.get("session").user_id,
    "provider.credentials.delete",
    appId,
  );
  return c.json({ ok: true });
});

appRoutes.get("/connections", async (c) => {
  const connections = await repoOf(c.env, c.get("workspaceId")).listConnections();
  return c.json({
    connections: connections.map(({ secret_ciphertext, ...safe }) => safe),
  });
});

const ConnectSchema = ConnectionCreateSchema;

appRoutes.post("/connections", body(ConnectSchema), async (c) => {
  requireRole(c, ["owner", "admin"]);
  const { app_id, token } = c.req.valid("json");
  const app = getApp(app_id);
  if (!app) throw new AppError("not_found", "Unknown app", 404);

  const workspaceId = c.get("workspaceId");
  const repo = repoOf(c.env, workspaceId);
  const usage = await planUsage(repo);
  const ent = checkEntitlement(c.get("workspace").plan as PlanId, usage, "connection");
  if (!ent.allowed) throw quotaExceeded(ent.reason ?? "Connection limit reached");

  if (app.auth === "file-import") {
    throw new AppError("bad_request", `${app.name} is import-only. Use the import flow.`, 400, {
      use_import: app.id,
    });
  }

  if (app.auth !== "oauth2" && !app.tokenAuth) {
    throw new AppError("bad_request", `${app.name} connections are not available yet`, 400);
  }

  // Token path: the alternative to the OAuth sign-in. Verify before storing so
  // a typo never becomes a silently degraded source.
  if (token) {
    if (!app.tokenAuth) {
      throw new AppError("bad_request", `${app.name} does not accept access tokens`, 400);
    }
    let externalId: string;
    try {
      externalId = await fetchExternalAccountId(c.env, app.id, token, {});
    } catch {
      throw new AppError("bad_request", `${app.name} rejected that token. Check its scopes.`, 400);
    }
    const ciphertext = await encryptSecret(
      c.env.TOKEN_KEY ?? c.env.AUTH_SECRET,
      JSON.stringify({ access_token: token }),
    );
    const connection = await repo.upsertConnection({
      appId: app.id,
      externalAccountId: externalId,
      scopes: app.scopes,
      secretCiphertext: ciphertext,
      status: "connected",
      syncIntervalMinutes: planDefaultInterval(c.get("workspace").plan as PlanId, app.id),
    });
    await repo.audit(c.get("session").user_id, "connection.install", connection.id, {
      app: app.id,
      method: "token",
    });
    // The client triggers the first sync so it can report the item counts.
    return c.json({ ok: true, connection_id: connection.id }, 201);
  }

  const provider = await resolveProvider(c.env, app.id);
  if (!provider?.clientId || !provider.clientSecret) {
    throw new AppError(
      "connector_not_configured",
      `${app.name} OAuth credentials are missing. Add them in the App Store.`,
      400,
      { app_id: app.id },
    );
  }

  const state = randomToken(24);
  const verifier = randomToken(48);
  const redirectUri = new URL(`/api/v1/oauth/${app.id}/callback`, c.req.url).toString();
  const url = await authorizeUrl(c.env, app.id, redirectUri, state, await pkceChallenge(verifier));
  if (!url) throw new AppError("connector_not_configured", "OAuth start failed", 500);

  const pending: PendingOAuth = {
    appId: app.id,
    workspaceId,
    userId: c.get("session").user_id,
    verifier,
    redirectUri,
  };
  await setCached(dbOf(c.env), `oauth:${state}`, pending, 10 * 60 * 1000);
  return c.json({ authorize_url: url, state });
});

appRoutes.post("/connections/:id/sync", async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const connection = await repo.getConnection(c.req.param("id"));
  if (!connection) throw new AppError("not_found", "Connection not found", 404);
  try {
    const summary = await syncConnection(c.env, c.get("workspaceId"), connection, 3);
    await repo.audit(c.get("session").user_id, "connection.sync", connection.id, {
      fetched: summary.fetched,
      created: summary.created,
      duplicateCount: summary.duplicateCount,
    });
    return c.json({ ok: true, ...summary });
  } catch (error) {
    throw new AppError("bad_request", `Sync failed: ${String(error).slice(0, 200)}`, 502);
  }
});

const ScheduleSchema = z.object({
  interval_minutes: z
    .number()
    .int()
    .min(0)
    .max(10_080) // one week
    .refine((value) => value === 0 || value >= 15, "Auto-sync runs at most every 15 minutes"),
});

appRoutes.patch("/connections/:id/schedule", body(ScheduleSchema), async (c) => {
  requireRole(c, ["owner", "admin"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const connection = await repo.getConnection(c.req.param("id"));
  if (!connection) throw new AppError("not_found", "Connection not found", 404);

  const { interval_minutes } = c.req.valid("json");
  const plan = c.get("workspace").plan as PlanId;
  if (!canSyncInterval(plan, interval_minutes)) {
    const options = syncIntervalsFor(plan)
      .map((minutes) => (minutes === 0 ? "manual" : `${minutes}m`))
      .join(", ");
    throw new AppError(
      "forbidden",
      `${PLANS[plan].name} plan allows these sync schedules: ${options}.`,
      403,
      { sync_intervals: syncIntervalsFor(plan) },
    );
  }
  await repo.updateConnection(connection.id, { syncIntervalMinutes: interval_minutes });
  await repo.audit(c.get("session").user_id, "connection.schedule", connection.id, {
    interval_minutes,
  });
  return c.json({ ok: true, sync_interval_minutes: interval_minutes });
});

appRoutes.post("/connections/:id/pause", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const connection = await repo.getConnection(c.req.param("id"));
  if (!connection) throw new AppError("not_found", "Connection not found", 404);
  await repo.updateConnection(connection.id, { status: "paused" });
  return c.json({ ok: true });
});

appRoutes.post("/connections/:id/resume", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const connection = await repo.getConnection(c.req.param("id"));
  if (!connection) throw new AppError("not_found", "Connection not found", 404);
  await repo.updateConnection(connection.id, { status: "connected", lastError: null });
  return c.json({ ok: true });
});

appRoutes.delete("/connections/:id", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const workspaceId = c.get("workspaceId");
  const repo = repoOf(c.env, workspaceId);
  const connection = await repo.getConnection(c.req.param("id"));
  if (!connection) throw new AppError("not_found", "Connection not found", 404);

  if (c.req.query("delete_items") === "1") {
    const removed = await repo.deleteItemsByConnection(connection.id);
    if (c.env.VECTORS && removed.vectors.length) {
      for (let i = 0; i < removed.vectors.length; i += 100) {
        await c.env.VECTORS.deleteByIds(removed.vectors.slice(i, i + 100));
      }
    }
  }
  await repo.deleteConnection(connection.id);
  await repo.audit(c.get("session").user_id, "connection.delete", connection.id, {
    app: connection.app_id,
    delete_items: c.req.query("delete_items") === "1",
  });
  return c.json({ ok: true });
});

/** Public: the provider redirects the browser here. State binds the workspace. */
export const oauthCallbackRoutes = new Hono<AppEnv>();

oauthCallbackRoutes.get("/:app/callback", async (c) => {
  const appId = c.req.param("app");
  const appOrigin = (c.env.APP_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
  // The SPA selects views with `?view=`, not a path: `/apps` would land on Knowledge
  // and the post-install sync effect would never mount.
  const redirect = (params: string) => c.redirect(`${appOrigin}/?view=apps&${params}`);

  if (c.req.query("error")) {
    return redirect(`error=${encodeURIComponent(c.req.query("error") ?? "oauth_denied")}`);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return redirect("error=missing_code");

  const db = dbOf(c.env);
  const pending = await getCached<PendingOAuth>(db, `oauth:${state}`);
  if (!pending || pending.appId !== appId) return redirect("error=expired_state");

  try {
    const tokens = await exchangeForApp({
      env: c.env,
      appId,
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
    });
    const externalId = await fetchExternalAccountId(c.env, appId, tokens.access_token, tokens);
    const secret = c.env.TOKEN_KEY ?? c.env.AUTH_SECRET;
    const ciphertext = await encryptSecret(secret, JSON.stringify(tokens));
    const repo = repoOf(c.env, pending.workspaceId);
    const workspace = await getWorkspace(dbOf(c.env), pending.workspaceId);
    const connection = await repo.upsertConnection({
      appId,
      externalAccountId: externalId,
      scopes: tokens.scope ? tokens.scope.split(" ") : (getApp(appId)?.scopes ?? []),
      secretCiphertext: ciphertext,
      status: "connected",
      syncIntervalMinutes: planDefaultInterval((workspace?.plan ?? "free") as PlanId, appId),
    });
    await repo.audit(pending.userId, "connection.install", connection.id, { app: appId });
    // First sync runs here so the App Store opens with data already in place.
    // One page keeps the callback within Worker subrequest limits; the rest
    // arrives on the next scheduled or manual sync.
    let counts = "";
    try {
      const summary = await syncConnection(c.env, pending.workspaceId, connection, 1);
      counts = `&fetched=${summary.fetched}&created=${summary.created}`;
    } catch {
      // The connection is marked degraded with last_error; the user can retry.
    }
    return redirect(`installed=${encodeURIComponent(appId)}${counts}`);
  } catch (error) {
    console.error(`[oauth] ${appId} callback failed`, error);
    return redirect(`error=${encodeURIComponent(String(error).slice(0, 120))}`);
  }
});
