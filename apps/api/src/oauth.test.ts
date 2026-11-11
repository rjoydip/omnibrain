import { describe, expect, test } from "bun:test";
import { memoryClient } from "@omnibrain/db/sqlite";
import { createApp } from "./app";
import type { Env } from "./env";

const ORIGIN = "http://localhost:5173";

function harness() {
  const db = memoryClient();
  const env: Env = {
    DB: db,
    AUTH_SECRET: "test-secret-32-characters-long!!!!",
    TOKEN_KEY: "test-key-32-characters-long!!!!!!!!",
    APP_ORIGIN: ORIGIN,
    DEV_MODE: "1",
    NOTION_CLIENT_ID: "notion-id",
    NOTION_CLIENT_SECRET: "notion-secret",
    GH_CLIENT_ID: "gh-id",
    GH_CLIENT_SECRET: "gh-secret",
  };
  return { env, app: createApp() };
}

const jsonHeaders = (cookie: string) => ({
  "content-type": "application/json",
  origin: ORIGIN,
  cookie,
  "x-csrf-token": /omnibrain_csrf=([^;]+)/.exec(cookie)?.[1] ?? "",
});

async function login(app: ReturnType<typeof createApp>, env: Env, email: string) {
  const otp = await app.request(
    "/api/v1/auth/request-otp",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email }),
    },
    env,
  );
  const { dev_code } = (await otp.json()) as { dev_code: string };
  const verify = await app.request(
    "/api/v1/auth/verify",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, code: dev_code }),
    },
    env,
  );
  return verify.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

const notionPage = {
  id: "p1",
  url: "https://www.notion.so/Page-1",
  last_edited_time: "2024-01-01T00:00:00.000Z",
  properties: { Name: { type: "title", title: [{ plain_text: "Page 1" }] } },
};

const gist = {
  id: "g1",
  html_url: "https://gist.github.com/u/g1",
  description: "Gist one",
  created_at: "2024-01-01T00:00:00Z",
  files: { "a.md": { filename: "a.md", language: "Markdown" } },
};

const realFetch = globalThis.fetch;

function mockProviders() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://api.notion.com/v1/oauth/token"))
      return new Response(JSON.stringify({ access_token: "n-tok", workspace_id: "ws-n" }));
    if (url === "https://api.notion.com/v1/search")
      return new Response(JSON.stringify({ results: [notionPage], has_more: false }));
    if (url.startsWith("https://github.com/login/oauth/access_token"))
      return new Response(JSON.stringify({ access_token: "gh-tok" }));
    if (url === "https://api.github.com/user")
      return new Response(JSON.stringify({ id: 7, login: "octo" }));
    if (url.startsWith("https://api.github.com/gists/"))
      return new Response(
        JSON.stringify({ id: "g1", files: { "a.md": { filename: "a.md", content: "# hi" } } }),
      );
    if (url.startsWith("https://api.github.com/gists")) return new Response(JSON.stringify([gist]));
    return new Response(`unexpected ${url}`, { status: 500 });
  }) as typeof fetch;
}

describe("oauth install", () => {
  for (const [appId, title] of [
    ["notion", "Page 1"],
    ["github", "Gist one"],
  ] as const) {
    test(`${appId}: callback returns to the App Store and the first sync imports items`, async () => {
      const { app, env } = harness();
      const cookie = await login(app, env, `${appId}@example.com`);
      mockProviders();
      try {
        const start = await app.request(
          "/api/v1/apps/connections",
          {
            method: "POST",
            headers: jsonHeaders(cookie),
            body: JSON.stringify({ app_id: appId }),
          },
          env,
        );
        expect(start.status).toBe(200);
        const { authorize_url } = (await start.json()) as { authorize_url: string };
        const state = new URL(authorize_url).searchParams.get("state");

        const callback = await app.request(
          `/api/v1/oauth/${appId}/callback?code=abc&state=${state}`,
          {},
          env,
        );
        expect(callback.status).toBe(302);
        // The SPA picks views from `?view=`; a path would strand the user on Knowledge.
        // The callback also runs the first sync, so the counts ride along.
        expect(callback.headers.get("location")).toBe(
          `${ORIGIN}/?view=apps&installed=${appId}&fetched=1&created=1`,
        );

        // No extra call: the item is already there when the App Store opens.
        const items = (await (
          await app.request("/api/v1/items", { headers: { cookie } }, env)
        ).json()) as { items: Array<{ source: string; title: string }> };
        expect(items.items.some((item) => item.source === appId && item.title === title)).toBe(
          true,
        );
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  }
});
