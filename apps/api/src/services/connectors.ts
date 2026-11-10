import { buildAuthorizeUrl, exchangeCode, syncApp, type TokenSet } from "@omnibrain/connectors";
import { sha256Hex } from "@omnibrain/core";
import { type ConnectionRow, forWorkspace, getProviderCredential } from "@omnibrain/db";
import { canonicalizeUrl } from "@omnibrain/search";
import { decryptSecret } from "../crypto";
import type { Env } from "../env";
import { dbOf } from "../env";

export interface ProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  clientId?: string;
  clientSecret?: string;
  /** Where the credentials came from; `db` wins over env. */
  source?: "db" | "env";
}

export function providerFor(env: Env, appId: string): ProviderConfig | null {
  switch (appId) {
    case "notion":
      return {
        authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
        tokenUrl: "https://api.notion.com/v1/oauth/token",
        scopes: ["read_content"],
        pkce: false,
        clientId: env.NOTION_CLIENT_ID,
        clientSecret: env.NOTION_CLIENT_SECRET,
      };
    case "keep":
      return {
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: ["https://www.googleapis.com/auth/keep.readonly"],
        pkce: true,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      };
    case "github":
      return {
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["gist"],
        pkce: false,
        clientId: env.GH_CLIENT_ID,
        clientSecret: env.GH_CLIENT_SECRET,
      };
    default:
      return null;
  }
}

export async function resolveProvider(env: Env, appId: string): Promise<ProviderConfig | null> {
  const base = providerFor(env, appId);
  if (!base) return null;
  try {
    const stored = await getProviderCredential(dbOf(env), appId);
    if (stored) {
      return {
        ...base,
        clientId: stored.client_id,
        clientSecret: await decryptSecret(
          env.TOKEN_KEY ?? env.AUTH_SECRET,
          stored.client_secret_ciphertext,
        ),
        source: "db",
      };
    }
  } catch {
    // Storage unavailable: fall back to env credentials.
  }
  return base;
}

export function authorizeUrl(
  env: Env,
  appId: string,
  redirectUri: string,
  state: string,
  challenge: string,
): Promise<string | null> {
  return resolveProvider(env, appId).then((provider) => {
    if (!provider?.clientId) return null;
    return buildAuthorizeUrl({
      authorizationUrl: provider.authorizationUrl,
      clientId: provider.clientId,
      redirectUri,
      scopes: provider.scopes,
      state,
      codeChallenge: challenge,
      extra:
        appId === "notion"
          ? { owner: "user" }
          : appId === "keep"
            ? { access_type: "offline", prompt: "consent" }
            : undefined,
    });
  });
}

/**
 * Notion uses JSON + Basic auth; GitHub and Google use form encoding. Both
 * paths are explicit so the token request is never a guess.
 */
export async function exchangeForApp(input: {
  env: Env;
  appId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet & { workspace_id?: string; bot_id?: string }> {
  const provider = await resolveProvider(input.env, input.appId);
  if (!provider?.clientId || !provider.clientSecret) {
    throw new Error(`${input.appId} oauth is not configured`);
  }
  const fetchImpl = input.fetchImpl ?? fetch;

  if (input.appId === "github") {
    // GitHub expects the client secret in the body and only returns JSON when asked.
    const res = await fetchImpl(provider.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        // The authorize URL sends a PKCE challenge; GitHub requires the verifier.
        code_verifier: input.verifier,
      }),
    });
    if (!res.ok) throw new Error(`github token exchange failed (${res.status})`);
    const body = (await res.json()) as TokenSet & { error?: string; error_description?: string };
    if (!body.access_token) {
      throw new Error(
        `github token exchange: ${body.error_description ?? body.error ?? "no token"}`,
      );
    }
    return body;
  }

  if (input.appId === "notion") {
    const res = await fetchImpl(provider.tokenUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${provider.clientId}:${provider.clientSecret}`)}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`notion token exchange failed (${res.status})`);
    return (await res.json()) as TokenSet & { workspace_id?: string; bot_id?: string };
  }

  return exchangeCode({
    tokenUrl: provider.tokenUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    code: input.code,
    redirectUri: input.redirectUri,
    codeVerifier: input.verifier,
    fetchImpl,
  });
}

export async function fetchExternalAccountId(
  env: Env,
  appId: string,
  token: string,
  tokenBody: { workspace_id?: string; bot_id?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (appId === "keep") {
    const res = await fetchImpl("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`google userinfo failed (${res.status})`);
    const body = (await res.json()) as { id?: string; email?: string };
    return body.email ?? body.id ?? "primary";
  }
  if (appId === "github") {
    const res = await fetchImpl("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "omnibrain",
      },
    });
    if (!res.ok) throw new Error(`github user failed (${res.status})`);
    const body = (await res.json()) as { login?: string };
    return body.login ?? "primary";
  }
  return tokenBody.bot_id ?? tokenBody.workspace_id ?? "primary";
}

export interface SyncSummary {
  fetched: number;
  created: number;
  duplicateCount: number;
  duplicates: Array<{ title: string; url: string | null }>;
  cursor: string | null;
}

export async function syncConnection(
  env: Env,
  workspaceId: string,
  connection: ConnectionRow,
  maxPages = 3,
): Promise<SyncSummary> {
  if (!connection.secret_ciphertext) throw new Error("connection has no token");
  const secret = env.TOKEN_KEY ?? env.AUTH_SECRET;
  const tokens = JSON.parse(await decryptSecret(secret, connection.secret_ciphertext)) as TokenSet;

  const repo = forWorkspace(dbOf(env), workspaceId);
  let cursor = connection.cursor;
  let fetched = 0;
  let created = 0;
  let pages = 0;
  const duplicates: Array<{ title: string; url: string | null }> = [];

  try {
    do {
      const page = await syncApp({
        appId: connection.app_id,
        token: tokens.access_token,
        userId: connection.external_account_id,
        cursor,
      });
      let createdThisPage = 0;
      for (const item of page.items) {
        const canonicalUrl = item.url ? canonicalizeUrl(item.url) : null;
        const contentHash = await sha256Hex(
          canonicalUrl ?? `${item.externalId}:${item.title}:${item.note ?? ""}`,
        );
        const res = await repo.createItem({
          kind: item.kind,
          source: connection.app_id,
          connectionId: connection.id,
          externalId: item.externalId,
          url: item.url ?? null,
          canonicalUrl,
          title: item.title || item.url || "Untitled",
          excerpt:
            item.note?.slice(0, item.kind === "note" ? 10_000 : 2000) ??
            item.summary?.slice(0, 2000) ??
            null,
          filesJson: item.files ? JSON.stringify(item.files) : null,
          summary: item.summary ?? null,
          lang: item.lang ?? null,
          tags: item.tags ?? [],
          capturedAt: item.capturedAt ?? Date.now(),
          contentHash,
        });
        fetched++;
        if (res.created) {
          created++;
          createdThisPage++;
        } else {
          // Backfill content for items imported before the adapter fetched it.
          if (item.note && (!res.item.excerpt || (item.files && !res.item.files_json))) {
            await repo.updateItem(res.item.id, {
              excerpt: item.note.slice(0, item.kind === "note" ? 10_000 : 2000),
              lang: item.lang,
              filesJson: item.files ? JSON.stringify(item.files) : undefined,
              embeddingState: "pending",
            });
          }
          if (duplicates.length < 50) {
            duplicates.push({ title: item.title || item.url || "Untitled", url: item.url ?? null });
          }
        }
      }
      cursor = page.nextCursor;
      pages++;
      // Some adapters revisit from the top: stop when a page is all known.
      if (page.items.length > 0 && createdThisPage === 0) break;
    } while (cursor && pages < maxPages);

    await repo.updateConnection(connection.id, {
      status: "connected",
      cursor,
      lastSyncedAt: Date.now(),
      lastError: null,
    });
    return { fetched, created, duplicateCount: fetched - created, duplicates, cursor };
  } catch (error) {
    await repo.updateConnection(connection.id, {
      status: "degraded",
      lastError: String(error).slice(0, 300),
    });
    throw error;
  }
}
