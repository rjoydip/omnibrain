import { describe, expect, test } from "bun:test";
import { memoryClient } from "@omnibrain/db/sqlite";
import { createApp } from "./app";
import type { Env } from "./env";

const ORIGIN = "http://localhost:5173";

function harness() {
  const db = memoryClient();
  const env: Env = {
    DB: db,
    AUTH_SECRET: "test-secret",
    APP_ORIGIN: ORIGIN,
    DEV_MODE: "1",
  };
  const app = createApp();
  return { db, env, app };
}

async function login(
  app: ReturnType<typeof createApp>,
  env: Env,
  email = "a@example.com",
): Promise<string> {
  const otp = await app.request(
    "/api/v1/auth/request-otp",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email }),
    },
    env,
  );
  expect(otp.status).toBe(200);
  const body = (await otp.json()) as { dev_code: string };
  expect(body.dev_code).toMatch(/^\d{6}$/);

  const verify = await app.request(
    "/api/v1/auth/verify",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, code: body.dev_code }),
    },
    env,
  );
  expect(verify.status).toBe(200);
  const setCookies = verify.headers.getSetCookie();
  const header = setCookies.map((value) => value.split(";")[0]).join("; ");
  expect(header).toContain("ob_session=");
  expect(header).toContain("omnibrain_csrf=");
  return header;
}

const json = (cookie: string) => ({
  "content-type": "application/json",
  origin: ORIGIN,
  cookie,
  "x-csrf-token": /omnibrain_csrf=([^;]+)/.exec(cookie)?.[1] ?? "",
});

describe("api", () => {
  test("health", async () => {
    const { app, env } = harness();
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("rejects unauthenticated workspace routes", async () => {
    const { app, env } = harness();
    const res = await app.request("/api/v1/items", {}, env);
    expect(res.status).toBe(401);
  });

  test("rejects a wrong OTP", async () => {
    const { app, env } = harness();
    await app.request(
      "/api/v1/auth/request-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: "wrong@example.com" }),
      },
      env,
    );
    const res = await app.request(
      "/api/v1/auth/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: "wrong@example.com", code: "000000" }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  test("production refuses to sign in without email delivery", async () => {
    const { app, env } = harness();
    const res = await app.request(
      "/api/v1/auth/request-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: "prod@example.com" }),
      },
      { ...env, DEV_MODE: undefined },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("email_not_configured");
  });

  test("signup, capture, list and hybrid search", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);

    const me = await app.request("/api/v1/auth/me", { headers: { cookie } }, env);
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { workspace: { id: string; plan: string } };
    expect(meBody.workspace.plan).toBe("free");

    const created = await app.request(
      "/api/v1/items",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({
          url: "https://developers.cloudflare.com/vectorize/",
          title: "Cloudflare Vectorize architecture",
          note: "Namespaces isolate tenants and metadata filters narrow results.",
          tags: ["cloudflare", "vector"],
          enrich: false,
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { created: boolean; item: { id: string } };
    expect(createdBody.created).toBe(true);

    const list = await app.request("/api/v1/items", { headers: { cookie } }, env);
    const listBody = (await list.json()) as { items: unknown[]; total: number };
    expect(listBody.total).toBe(1);

    const search = await app.request(
      "/api/v1/search",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({ query: "vectorize", answer: false }),
      },
      env,
    );
    const searchBody = (await search.json()) as {
      results: Array<{ title: string; matched: string }>;
      meta: { mode: string };
    };
    expect(searchBody.results[0]?.title).toContain("Vectorize");
    expect(searchBody.meta.mode).toBe("lexical");
  });

  test("tenant isolation: one user cannot read another's items", async () => {
    const { app, env } = harness();
    const alice = await login(app, env, "alice@example.com");
    const bob = await login(app, env, "bob@example.com");

    await app.request(
      "/api/v1/items",
      {
        method: "POST",
        headers: json(alice),
        body: JSON.stringify({
          url: "https://secret.example/alice",
          title: "alice private canary",
          enrich: false,
        }),
      },
      env,
    );

    const bobList = await app.request("/api/v1/items", { headers: { cookie: bob } }, env);
    expect(((await bobList.json()) as { total: number }).total).toBe(0);

    const bobSearch = await app.request(
      "/api/v1/search",
      {
        method: "POST",
        headers: json(bob),
        body: JSON.stringify({ query: "canary", answer: false }),
      },
      env,
    );
    expect(((await bobSearch.json()) as { results: unknown[] }).results).toHaveLength(0);
  });

  test("MCP: initialize, tools/list and a scoped search", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);

    await app.request(
      "/api/v1/items",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({
          url: "https://bun.sh/docs",
          title: "Bun workspaces",
          note: "One lockfile for apps and packages.",
          enrich: false,
        }),
      },
      env,
    );

    const keyRes = await app.request(
      "/api/v1/keys",
      { method: "POST", headers: json(cookie), body: JSON.stringify({ name: "test" }) },
      env,
    );
    expect(keyRes.status).toBe(201);
    const { key, apiKey } = (await keyRes.json()) as {
      key: string;
      apiKey: Record<string, unknown>;
    };
    expect(key.startsWith("ob_")).toBe(true);
    expect("key_hash" in apiKey).toBe(false);
    const keyId = String(apiKey.id);

    const init = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "test-client", version: "1.0" } },
        }),
      },
      env,
    );
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as {
      result: { serverInfo: { name: string }; protocolVersion: string };
    };
    expect(initBody.result.serverInfo.name).toBe("omnibrain");

    const tools = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      },
      env,
    );
    const toolsBody = (await tools.json()) as { result: { tools: Array<{ name: string }> } };
    expect(toolsBody.result.tools.map((t) => t.name)).toContain("omnibrain_search");

    const call = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "omnibrain_search", arguments: { query: "workspaces" } },
        }),
      },
      env,
    );
    const callBody = (await call.json()) as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    expect(callBody.result.isError).toBe(false);
    const payload = JSON.parse(callBody.result.content[0]?.text ?? "{}") as {
      results: Array<{ title: string }>;
    };
    expect(payload.results[0]?.title).toContain("Bun");

    const eventsRes = await app.request(
      `/api/v1/keys/${keyId}/events`,
      { headers: { cookie } },
      env,
    );
    expect(eventsRes.status).toBe(200);
    const { events } = (await eventsRes.json()) as {
      events: Array<{ event: string; client_name: string | null; tool: string | null }>;
    };
    expect(events.some((e) => e.event === "connect" && e.client_name === "test-client")).toBe(true);
    expect(events.some((e) => e.event === "tool_call" && e.tool === "omnibrain_search")).toBe(true);
  });

  test("MCP rejects a missing key", async () => {
    const { app, env } = harness();
    const res = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  test("cross-origin mutation is rejected", async () => {
    const { app, env } = harness();
    const res = await app.request(
      "/api/v1/auth/request-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ email: "a@example.com" }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  test("mutation without a CSRF token is rejected", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);
    const res = await app.request(
      "/api/v1/items",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie },
        body: JSON.stringify({ title: "csrf check" }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  test("import batches are idempotent", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);

    const start = await app.request(
      "/api/v1/imports",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({ kind: "browser_html", total: 2 }),
      },
      env,
    );
    expect(start.status).toBe(201);
    const { import: row } = (await start.json()) as { import: { id: string } };

    const batch = {
      items: [
        { url: "https://a.example/one", title: "A", source: "browser" },
        { url: "https://b.example/two", title: "B", source: "browser" },
      ],
    };
    const first = await app.request(
      `/api/v1/imports/${row.id}/batches`,
      { method: "POST", headers: json(cookie), body: JSON.stringify(batch) },
      env,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      created: number;
      duplicates: number;
      import: { status: string; processed: number };
    };
    expect(firstBody.created).toBe(2);
    expect(firstBody.import.processed).toBe(2);
    expect(firstBody.import.status).toBe("done");

    const list = await app.request("/api/v1/items", { headers: { cookie } }, env);
    expect(((await list.json()) as { total: number }).total).toBe(2);

    const second = await app.request(
      "/api/v1/imports",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({ kind: "browser_html", total: 2 }),
      },
      env,
    );
    const { import: row2 } = (await second.json()) as { import: { id: string } };
    const again = await app.request(
      `/api/v1/imports/${row2.id}/batches`,
      { method: "POST", headers: json(cookie), body: JSON.stringify(batch) },
      env,
    );
    const againBody = (await again.json()) as { created: number; duplicates: number };
    expect(againBody.created).toBe(0);
    expect(againBody.duplicates).toBe(2);
  });

  test("a public share link exposes the item until it is revoked", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);

    const created = await app.request(
      "/api/v1/items",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({ title: "Shared note", note: "Hello there" }),
      },
      env,
    );
    const { item } = (await created.json()) as { item: { id: string } };

    const share = await app.request(
      `/api/v1/items/${item.id}/share`,
      { method: "POST", headers: json(cookie), body: JSON.stringify({ recipients: [] }) },
      env,
    );
    expect(share.status).toBe(200);
    const { token } = (await share.json()) as { token: string };
    expect(token.length).toBeGreaterThan(10);

    // No session, no CSRF: the token is the credential.
    const publicRead = await app.request(`/api/v1/public/items/${token}`, {}, env);
    expect(publicRead.status).toBe(200);
    const shared = (await publicRead.json()) as { item: Record<string, unknown> };
    expect(shared.item.title).toBe("Shared note");
    expect(shared.item.excerpt).toBe("Hello there");
    expect(shared.item.workspace_id).toBeUndefined();

    await app.request(
      `/api/v1/items/${item.id}/share`,
      { method: "DELETE", headers: json(cookie) },
      env,
    );
    expect((await app.request(`/api/v1/public/items/${token}`, {}, env)).status).toBe(404);
  });

  test("queue run only starts items that have a url", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);

    await app.request(
      "/api/v1/items",
      {
        method: "POST",
        headers: json(cookie),
        body: JSON.stringify({ title: "Note only", note: "body" }),
      },
      env,
    );

    const res = await app.request(
      "/api/v1/items/queue/run",
      { method: "POST", headers: json(cookie) },
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { started: number }).started).toBe(0);
  });

  test("app catalog reports configuration honestly", async () => {
    const { app, env } = harness();
    const cookie = await login(app, env);

    const catalog = await app.request("/api/v1/apps", { headers: { cookie } }, env);
    expect(catalog.status).toBe(200);
    const { apps } = (await catalog.json()) as {
      apps: Array<{ id: string; configured: boolean; auth: string }>;
    };
    expect(apps.length).toBe(3);
    const notion = apps.find((a) => a.id === "notion");
    expect(notion?.configured).toBe(false);

    // Env credentials make an OAuth app one-click, no in-app setup required.
    env.GH_CLIENT_ID = "gh-id";
    env.GH_CLIENT_SECRET = "gh-secret";
    const configured = await app.request("/api/v1/apps", { headers: { cookie } }, env);
    const { apps: afterEnv } = (await configured.json()) as {
      apps: Array<{ id: string; configured: boolean }>;
    };
    expect(afterEnv.find((a) => a.id === "github")?.configured).toBe(true);

    const oauth = await app.request(
      "/api/v1/apps/connections",
      { method: "POST", headers: json(cookie), body: JSON.stringify({ app_id: "notion" }) },
      env,
    );
    expect(oauth.status).toBe(400);
    const oauthBody = (await oauth.json()) as { error: { code: string } };
    expect(oauthBody.error.code).toBe("connector_not_configured");

    const importOnly = await app.request(
      "/api/v1/apps/connections",
      { method: "POST", headers: json(cookie), body: JSON.stringify({ app_id: "browser" }) },
      env,
    );
    expect(importOnly.status).toBe(400);
    expect(((await importOnly.json()) as { error: { code: string } }).error.code).toBe(
      "bad_request",
    );

    // GitHub can install with a pasted token instead of an OAuth app.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) =>
      String(input).includes("/gists")
        ? new Response("[]", { status: 200 })
        : new Response(JSON.stringify({ login: "octocat" }), { status: 200 })) as typeof fetch;
    try {
      const tokenConnect = await app.request(
        "/api/v1/apps/connections",
        {
          method: "POST",
          headers: json(cookie),
          body: JSON.stringify({ app_id: "github", token: "ghp_test" }),
        },
        env,
      );
      expect(tokenConnect.status).toBe(201);
      expect(((await tokenConnect.json()) as { ok: boolean }).ok).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
