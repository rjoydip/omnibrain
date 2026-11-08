import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { isDev } from "./env";
import {
  appErrorToResponse,
  csrfGuard,
  issueCsrfCookie,
  jsonError,
  originGuard,
  requestId,
  requireSession,
  sessionMiddleware,
  workspaceMiddleware,
  writeRateLimit,
} from "./http";
import { mcpRoutes } from "./mcp";
import { accountRoutes } from "./routes/account";
import { appRoutes, oauthCallbackRoutes } from "./routes/apps";
import { authRoutes } from "./routes/auth";
import { importRoutes } from "./routes/imports";
import { itemRoutes } from "./routes/items";
import { keyRoutes } from "./routes/keys";
import { searchRoutes } from "./routes/search";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", requestId());
    const started = Date.now();
    await next();
    c.header("x-request-id", c.get("requestId"));
    if (isDev(c.env)) {
      console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`);
    }
  });

  app.use("*", async (c, next) => {
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "strict-origin-when-cross-origin");
    c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    c.header("cross-origin-opener-policy", "same-origin");
    // API responses are JSON only; the SPA gets its policy from the static host.
    c.header(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    await next();
  });

  app.use("*", (c, next) =>
    cors({
      origin: (origin) => {
        const allowed = c.env.APP_ORIGIN ?? "http://localhost:5173";
        if (!origin) return allowed;
        if (origin === allowed) return origin;
        try {
          return new URL(origin).host === new URL(c.req.url).host ? origin : "";
        } catch {
          return "";
        }
      },
      credentials: true,
      allowHeaders: [
        "content-type",
        "x-workspace-id",
        "authorization",
        "x-request-id",
        "x-csrf-token",
      ],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["x-request-id"],
      maxAge: 600,
    })(c, next),
  );

  app.get("/health", (c) =>
    c.json({ ok: true, name: "omnibrain-api", version: "0.1.0", time: Date.now() }),
  );

  app.use("/api/v1/*", async (c, next) => {
    await next();
    issueCsrfCookie(c);
  });

  app.route("/api/v1/auth", authRoutes);
  app.route("/api/v1/oauth", oauthCallbackRoutes);
  app.route("/mcp", mcpRoutes);

  const api = new Hono<AppEnv>();
  api.use("*", originGuard);
  api.use("*", sessionMiddleware);
  api.use("*", requireSession);
  api.use("*", csrfGuard);
  api.use("*", workspaceMiddleware);
  api.use("*", writeRateLimit);
  api.route("/items", itemRoutes);
  api.route("/search", searchRoutes);
  api.route("/apps", appRoutes);
  api.route("/imports", importRoutes);
  api.route("/keys", keyRoutes);
  api.route("/", accountRoutes);
  app.route("/api/v1", api);

  app.notFound((c) => jsonError(c, "not_found", "Route not found", 404));
  app.onError((err, c) => appErrorToResponse(c, err));
  return app;
}

export type App = ReturnType<typeof createApp>;
