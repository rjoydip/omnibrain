# Architecture

## Topology

```
Browser ──► Vite SPA (apps/web) ──► Hono API Worker (apps/api)
                                      │
                                      ├─ D1        items, users, connections, usage
                                      ├─ FTS5      lexical index, triggers on items
                                      ├─ R2        extracted text snapshots
                                      ├─ Vectorize chunk embeddings (namespace = workspace)
                                      ├─ Workers AI embeddings + summaries
                                      ├─ Email Service  OTP delivery (`send_email` binding)
                                      └─ Queue     optional enrichment consumer

MCP client (Claude/Cursor) ──POST /mcp──► same Worker ──► same repository
```

Local development replaces D1 with `bun:sqlite` through the same `SqlClient` interface, and the API
runs under `Bun.serve` (`apps/api/src/dev.ts`). There is no preview Worker stage.

## Request lifecycle

`apps/api/src/app.ts` builds one Hono app:

1. **Request context** — generate `requestId`, log method/path/status/duration in dev.
2. **Security headers** — nosniff, DENY framing, referrer/permissions policy, HSTS and
   `Cross-Origin-Opener-Policy: same-origin`, plus a strict JSON CSP (`default-src 'none'`).
3. **CORS** — only `APP_ORIGIN` (or same host) with credentials; allows `x-csrf-token`.
4. **Public routes** — `/health`, `/api/v1/auth/*`, `/api/v1/oauth/:app/callback`, `/mcp`.
5. **Protected group** (`/api/v1/*`):
   - `originGuard` — rejects unsafe methods with a foreign `Origin`.
   - `sessionMiddleware` — resolves the `ob_session` cookie if present.
   - `requireSession` — 401 when absent.
   - `csrfGuard` — unsafe methods need `x-csrf-token` matching `omnibrain_csrf`, unless the browser
     reports `Sec-Fetch-Site: same-origin|same-site`.
   - `workspaceMiddleware` — resolves `x-workspace-id` (validated against membership) or the first
     workspace, then sets `workspaceId`, `workspace`, `role`.
   - `writeRateLimit` — 120 mutations/minute per workspace+user; reads are unmetered.

Errors are normalised by `appErrorToResponse`: `AppError` → `{ error: { code, message, requestId } }`;
anything else is logged and becomes a generic 500.

## SPA data flow

- `apps/web/src/App.tsx` owns the session, the loaded item page, and local preferences. There is no
  global store; the server is the source of truth.
- URL search params (`view`, `status`, `source`, `layout`, `fstart`/`fend`/`flabel`/`fsrc`) are the
  navigation source of truth: changes `pushState`, `popstate` hydrates, so back/forward and deep
  links work. Theme, accent and inspector width persist in localStorage.
- `refresh()` fetches items + account with an `AbortController`; starting a new refresh aborts the
  previous one, and `AbortError` is ignored.
- Archive, trash, restore, purge and retry update the list optimistically and only resync on failure.
- The first load and status switches show `SectionLoading` skeletons until data arrives. Lazy chunks
  share the same fallback, and list rows are memoized with stable callbacks.

## Tenancy

The tenant key is `workspaceId`, applied at every boundary:

| Surface   | Scoping                                                                  |
| --------- | ------------------------------------------------------------------------ |
| D1 rows   | `workspace_id` on every table; `forWorkspace(db, id)` injects the filter |
| Vectorize | vector `namespace` + `workspaceId` metadata filter (defence in depth)    |
| R2        | keys start with `ws/<workspaceId>/`                                      |
| Sessions  | membership row checked per request                                       |
| MCP keys  | key row carries `workspace_id`; tools use that id only                   |
| Usage     | per-workspace daily rows                                                 |

`packages/db/src/repo.ts` exports the `forWorkspace()` facade as the app-facing API. The canary test
in `packages/db/src/repo.test.ts` writes a unique string into workspace A and asserts workspace B
cannot read it through list, get, count, or FTS search.

## Data model

Core tables: `users`, `sessions`, `otp_codes`, `workspaces`, `memberships`, `items`, `item_chunks`,
`tags`, `item_tags`, `connections`, `imports`, `api_keys`, `usage_daily`, `query_cache`,
`audit_log`.

`items` keeps metadata and the first 2 KB excerpt; full extracted text lives in R2. FTS5 indexes
title, excerpt and tags through triggers, so lexical search never scans the full text table.
`item_chunks` records vector ids and R2 keys for cleanup.

## Capture and enrichment

```
POST /items ──► canonicalize URL ──► dedupe by canonical_url / (connection, external_id)
            ──► insert item (pending)
            ──► ENRICH_QUEUE.send() or background waitUntil()
                 ──► SSRF-guarded fetch ──► regex readability ──► R2 text
                 ──► Workers AI summary + tags ──► chunk ──► embed ──► Vectorize upsert
                 ──► update item (ready | skipped | failed)
```

Enrichment is idempotent per content hash and replaces old vectors through `item_chunks`. The queue
consumer retries failed messages; inline background work is best-effort. See
[connectors.md](./connectors.md) for imports and sync.

## Search

1. Blank query returns recent items.
2. Lexical: `buildFtsQuery()` produces a safe prefix-OR MATCH expression; FTS5 returns ranked ids.
3. Semantic (when AI + Vectorize are bound): embed the query, query the workspace namespace, keep
   the first chunk per item.
4. Fuse with Reciprocal Rank Fusion (`k = 60`).
5. Apply a small recency boost and a per-source diversity cap.
6. Hydrate from D1; never return vectors or R2 keys to the client.
7. Optional answer synthesis uses the top 5 summaries and must cite sources.

The UI displays the mode (`lexical`, `hybrid`, `recent`) and counts so "no AI configured" is visible
rather than hidden.

## Background work

`apps/api/src/worker.ts` exports:

- `fetch` — the Hono app.
- `queue` — enrichment consumer with `ack`/`retry`.
- `scheduled` — deletes expired sessions and cache rows, purges trash older than 30 days, and
  deletes the associated vectors.

A cron trigger is not bound in `alchemy.run.ts` yet; see [operations.md](./operations.md).

## MCP

`/mcp` is mounted in the API Worker. It accepts JSON-RPC over POST (Streamable HTTP), authenticates
with an `ob_…` bearer key (hashed at rest), checks the daily call quota, and exposes
`omnibrain_search`, `omnibrain_fetch`, `omnibrain_recent`, `omnibrain_save_note`. Tools call the same
tenant-scoped repository and search service as the web app. Each request is recorded in `mcp_events`
(client name/version, tool, status, duration), visible per key in the MCP screen. OAuth 2.1 discovery is deferred; API keys work with clients that allow custom headers.

## Deployment

`alchemy.run.ts` provisions:

- D1 database with migrations from `packages/db/migrations`.
- R2 bucket for extracted text.
- Vectorize index (1024 dimensions, cosine).
- API Worker with D1/R2/Vectorize/Email Service bindings and secrets from the environment.
- Vite site, with `VITE_API_URL` inlined at build time and a build-time CSP `<meta>` injected.

Production compute is workerd. Bun is the local/runtime toolchain, not the deployed runtime.

## Known limits

- Rate limits are per-isolate `Map` windows; Durable Object counters are planned. The OTP resend
  cooldown is the exception: it is derived from the stored code row, so it holds across isolates.
- Inline enrichment can be lost if an isolate dies; bind the queue for production confidence.
- OAuth token refresh is not automatic; a 401 marks the connection `degraded`.
- Billing is modelled but Stripe is not wired.
- The regex readability extractor is intentionally simple; see DECISIONS §5.
