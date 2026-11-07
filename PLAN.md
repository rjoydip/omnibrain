# OmniBrain AI — Build Plan v2

**Status:** draft for approval · **Date:** 2026-11-06 · **Shape:** multi-tenant SaaS
**Surfaces:** web app (PWA), HTTP API, connector App Store, remote MCP server
**Rule of this doc:** every phase ends with an exit criterion you can test. Anything that cannot be tested is not in the plan.

---

## 1. Product thesis

Everyone's knowledge is scattered across bookmarks, Notion, Keep, X, Readwise, and random tabs. Existing tools make you choose one silo or manually re-file everything. OmniBrain is the **recall layer**: install your sources once, then find anything by meaning, in one keystroke, from any AI client.

Three promises, in priority order:

1. **Recall is instant and cited.** Semantic + lexical hybrid search with source links, not a chatbot guessing.
2. **Install once, stays in sync.** A real connector lifecycle (auth, sync, health, disconnect), not a CSV upload.
3. **The UI feels like memory, not a database.** Spatial, calm, keyboard-first. No generic dashboard grid.

Non-goals for v1 (deliberate, revisit only with data): real-time collaborative editing, arbitrary third-party plugin code execution, native iOS/Android apps, self-hosted Postgres, a force-directed knowledge graph, AI chat over the entire corpus.

---

## 2. Users, plans, core journeys

| Persona         | Job                                   | Success moment                                                 |
| --------------- | ------------------------------------- | -------------------------------------------------------------- |
| Researcher / PM | Re-find a thing read months ago       | Types a fuzzy half-memory, gets the exact page + quote in < 1s |
| Builder         | Keep docs, repos, tweets in one place | Installs 3 sources, searches across all of them                |
| AI power user   | Let Claude/Cursor read their notes    | Adds MCP endpoint, agent answers from their own corpus         |
| Team lead       | Shared team knowledge                 | Invites members, shared collections, per-seat billing          |

Plans (numbers are placeholders to validate in Phase 4, enforcement code is shared client/server):

| Limit                  | Free    | Pro $9/mo        | Team $19/seat/mo |
| ---------------------- | ------- | ---------------- | ---------------- |
| Items                  | 500     | 25,000           | 100,000 shared   |
| AI enrichments / mo    | 200     | 5,000 (fair use) | 20,000 shared    |
| Connections            | 1       | 5                | unlimited        |
| MCP calls / day        | 100     | 5,000            | 20,000           |
| Seats                  | 1       | 1                | 3+               |
| Retention after delete | 30 days | 30 days          | 30 days          |

**Journey A — first value in 3 minutes:** sign up (email OTP or Google) → pick a starter source (browser bookmarks file or Notion) → watch sync progress → land on Atlas with results already searchable → "Recall" demo query pre-filled.

**Journey B — install an app:** App Store → card → scope sheet → OAuth popup → backfill progress → health chip turns green.

**Journey C — recall:** `⌘K` → type intent → streamed answer + citation cards → open item → jump to original URL at the matched section.

**Journey D — agent access:** Settings → MCP → create client (DCR) → copy config → paste into Claude Desktop → agent calls `search`.

---

## 3. Stack and the "Bun all over" reality check

| Layer                     | Choice                                                                                            | Why                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Package manager / scripts | **Bun** (`bun install`, `bun run`, `bunx`) with committed `bun.lock`                              | One tool, fast, no npm/pnpm/node in the repo                              |
| Language                  | **TypeScript** strict everywhere; shared types via `hono/client` RPC                              | End-to-end types without codegen                                          |
| Local dev                 | `bun --watch`, `bun alchemy dev`                                                                  | No Docker required for core flows                                         |
| Unit tests                | `bun test`                                                                                        | Native, zero config                                                       |
| Worker integration tests  | `bunx vitest run` + `@cloudflare/vitest-pool-workers`                                             | `bun test` cannot run inside workerd; this is the one justified exception |
| E2E                       | `bunx playwright`                                                                                 | Standard, reliable                                                        |
| Infra                     | **Alchemy** (`alchemy` + `@alchemy.run/cloudflare`), `bun alchemy deploy`                         | TypeScript-native IaC, no hand-written wrangler configs                   |
| Compute                   | Cloudflare Workers (workerd)                                                                      | Edge, scales to zero                                                      |
| Relational                | D1 (SQLite) + FTS5 + parameterized SQL                                                            | Simple, cheap, full-text search included                                  |
| Vectors                   | Vectorize (1024-dim, cosine)                                                                      | Native to Workers AI                                                      |
| Objects                   | R2                                                                                                | Snapshots, exports, large imports                                         |
| Async                     | Queues + Cron Triggers + Durable Objects                                                          | Enrichment, sync, quotas                                                  |
| AI                        | Workers AI: `@cf/baai/bge-m3` embeddings (multilingual), pinned instruct model for summaries/tags | No external API keys for the core path                                    |
| Frontend                  | React 19 + Vite + Tailwind v4 + Radix primitives                                                  | Fast, accessible, no heavy UI kit                                         |
| Auth                      | Email OTP + opaque hashed session tokens (no provider lock-in)                                    | No per-MAU tax, self-hosted sessions                                      |
| Billing                   | Stripe Checkout + Customer Portal + webhooks                                                      | Standard, Workers-compatible                                              |
| Email                     | Resend (transactional)                                                                            | Simple fetch-based API                                                    |
| Observability             | Workers Logs → Axiom, Sentry, Analytics Engine                                                    | Errors + product metrics                                                  |
| CI/CD                     | GitHub Actions + Alchemy                                                                          | CI on PR, prod on tag (no preview worker)                                 |

**Honest caveat:** production compute is Cloudflare Workers (`workerd`), not Bun. "Bun all over" means every developer-facing surface — install, scripts, tests, builds, deploys, seeds, CLIs — is Bun. Do not design code that depends on Bun-only runtime APIs inside a Worker. Do not add `nodejs_compat` unless a dependency forces it; if it does, isolate that dependency in `packages/` and note why.

**Pinned toolchain:** Bun 1.4.4 pinned in GitHub Actions (`setup-bun`). Formatting is `bun fmt` (configured in `bunfig.toml`), linting is `oxlint`, and typechecking is `bun typecheck`. No `.bun-version` file, no `.nvmrc`, no `engines` field.

---

## 4. Repository layout

```sh
omnibrain/
├── apps/
│   ├── web/                  # React SPA + PWA (Vite, Tailwind v4)
│   ├── api/                  # Hono Worker: REST, OAuth callbacks, MCP mount, cron
│   └── extension/            # MV3 browser extension (planned, Phase 3)
├── packages/
│   ├── core/                 # Zod schemas, domain types, errors, entitlements
│   ├── db/                   # SQL schema/migration, D1 + SQLite client, tenant repository
│   ├── auth/                 # OTP + session primitives
│   ├── ai/                   # Embeddings, chunking, summarization, prompts
│   ├── search/               # Hybrid search, RRF, canonicalize, dedupe
│   ├── connectors/           # Manifest catalog, parsers, OAuth helpers, adapters
│   └── ui/                   # Design tokens, primitives
├── alchemy.run.ts            # The entire infrastructure graph
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── docs/                     # Architecture, API, connectors, security, ops, design
├── bunfig.toml               # Bun formatter config
├── bun.lock
└── package.json              # Bun workspaces: ["apps/*", "packages/*"]
```

Rules: no app imports another app (only packages). `packages/connectors` must not import `apps/api`. Every package exports from `src/index.ts`. One `tsconfig.base.json`; `bun typecheck` runs `tsc --noEmit` per project.

---

## 5. Environments and infrastructure as code (Alchemy)

Stages: `dev` (shared, seeded), `pr-<number>` (ephemeral, no prod data), `prod`.

```ts
// alchemy.run.ts — Phase 0 verifies exact binding shapes against the installed
// @alchemy.run/cloudflare version; do not copy-paste from blogs.
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "OmniBrain",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1.Database("Db", {
      migrations: "./packages/db/migrations",
    });
    const blobs = yield* Cloudflare.R2.Bucket("Blobs");

    const api = yield* Cloudflare.Worker("Api", {
      main: "./apps/api/src/worker.ts",
      env: { DB: db, BLOBS: blobs },
      url: true,
    });

    const web = yield* Cloudflare.Website.Vite("Web", { rootDir: "./apps/web" });

    return { apiUrl: api.url, webUrl: web.url };
  }),
);
```

Resources to add in Phase 0, each proven by a deploy + a smoke request:

| Resource                                                                                   | Used for                                                                                                 | Notes                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Vectorize.Index` (1024, cosine) + `MetadataIndex` (`workspaceId`) + `SearchIndex` binding | Semantic search                                                                                          | One index for all tenants; `workspaceId` as namespace + metadata filter |
| `Queue` + consumer                                                                         | Enrichment jobs                                                                                          | At-least-once; handlers must be idempotent; DLQ after 5 attempts        |
| `DurableObject`                                                                            | Per-workspace quota counters, OAuth refresh locks, sync leases                                           | One DO per workspace (`idFromName(workspaceId)`)                        |
| Cron Triggers                                                                              | Connector sync, trash purge, usage flush                                                                 | Every 15 min (Pro/Team), hourly (Free)                                  |
| Secrets                                                                                    | `BETTER_AUTH_SECRET`, `MASTER_KEY` (AES-GCM), `STRIPE_SECRET`, `RESEND_KEY`, provider client IDs/secrets | Never in `alchemy.run.ts` values; bind from env/secret store            |

**Alchemy rules:** `alchemy.run.ts` is the only place resources are declared. No `wrangler.toml` in any app. Preview stages are destroyed on PR close. Prod deploy is blocked unless `ci` is green on the same commit. State lives in Cloudflare (`Cloudflare.state()`); no local state file in CI.

**Phase 0 spike must prove:** clean clone → `bun install` → `bun alchemy deploy --stage dev` produces a working URL, D1 migration applies, Vite SPA serves, one queued job round-trips, and the Vectorize binding inserts + queries a test vector. This de-risks Alchemy API drift before any product code.

---

## 6. Multi-tenancy and security model

**Tenant key:** `workspaceId` on every row, every vector namespace, every R2 key (`ws/<id>/...`), every DO name, every log line, every metric.

**Enforcement, not convention:**

- A single data-access layer, `forWorkspace(workspaceId)`, is the only way app code touches tenant rows; the facade is what `@omnibrain/db` exports.
- Every query test runs against a **canary workspace** seeded with unique strings; any cross-tenant leak fails CI.
- Vectorize queries always pass both `namespace: workspaceId` and metadata filter `workspaceId = $id` (defense in depth).
- R2 get/put/delete helpers take `workspaceId` and prefix internally; presigned URLs are scoped and expire in 5 minutes.
- DO ids derive from workspace; no global mutable counters in D1 (D1 write throughput is the first thing to fall over).

**AuthN/AuthZ:**

- Email OTP (10 min, 5 attempts, hashed and peppered), opaque 256-bit session tokens hashed in D1, 30-day expiry, HttpOnly `SameSite` cookies, explicit logout.
- Roles: `owner`, `admin`, `member`, `viewer`. Only owner/admin can manage billing, connections, members, API keys. Viewers cannot trigger paid AI actions.
- Every mutating route requires an explicit `requireRole()` middleware. No implicit "logged in = allowed".
- CSRF: SameSite=Lax cookies + `Origin` check on non-GET; OAuth state bound to session, single-use, 10 min TTL.
- Rate limits: per IP (unauthenticated), per user, per workspace, per connector. Token bucket in the workspace DO. 429 with `Retry-After`.

**Secrets at rest:** provider tokens encrypted with AES-GCM-256 using a per-workspace DEK, DEK wrapped by `MASTER_KEY` (Worker secret). Ciphertext format `v1:<iv>:<ct>`. Tokens never returned to the client; UI shows only `••••` + last 4 + scopes + last refreshed. Rotation: re-wrap DEKs, lazy re-encrypt on next use. Never log tokens, auth headers, or raw provider payloads.

**Ingestion safety (SSRF is the most likely real incident):**

- Block private/link-local/loopback/metadata ranges (IPv4 + IPv6), `.local`, and non-HTTP(S) schemes.
- Re-validate every redirect (max 3), 10s timeout, 5MB body cap, content-type allowlist (`text/html`, `application/json`, `text/plain`, PDF only if size < 10MB).
- Per-host concurrency 2, global concurrency cap. Respect `robots.txt` for user-triggered fetches; skip if disallowed.
- Sanitize extracted HTML with a strict allowlist before rendering; never `dangerouslySetInnerHTML` raw provider content.
- Treat all imported text as **untrusted content, never instructions**. AI prompts wrap it in delimiters, output is schema-validated JSON, and model output is never executed or used to call tools.

**Compliance posture:** GDPR export (JSONL zip) and delete (D1 cascade + vector delete + R2 prefix delete + audit entry) implemented in Phase 1, not bolted on. Audit log for auth, role changes, connection install/revoke, exports, deletes, billing. Data residency (EU R2/D1) deferred to enterprise.

---

## 7. Data model (core DDL)

`packages/db/schema.ts` mirrors this; migrations are generated SQL, applied by Alchemy. Timestamps are integer epoch millis.

```sql
create table workspaces (
  id text primary key,
  name text not null,
  slug text not null unique,
  plan text not null default 'free' check (plan in ('free','pro','team')),
  stripe_customer_id text,
  created_at integer not null,
  deleted_at integer
);

create table memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at integer not null,
  primary key (workspace_id, user_id)
);

create table connections (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  app_id text not null,                        -- 'notion','keep','x','browser',...
  external_account_id text,
  status text not null check (status in ('authorizing','connected','degraded','paused','revoked')),
  scopes text not null,                        -- JSON array
  secret_ciphertext text,                      -- v1:<iv>:<ct>; null for file-only sources
  cursor text,                                 -- provider delta token
  last_synced_at integer,
  last_error text,
  created_at integer not null,
  unique (workspace_id, app_id, external_account_id)
);

create table items (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('bookmark','note','highlight','file')),
  source text not null,                        -- 'web','browser','notion','keep','x','raindrop','readwise','mcp'
  connection_id text references connections(id) on delete set null,
  external_id text,
  url text,
  canonical_url text,
  title text not null,
  excerpt text,                                -- first 2KB, for cards + FTS
  content_r2_key text,                         -- full sanitized text/markdown
  summary text,
  lang text,
  author text,
  published_at integer,
  captured_at integer not null,
  content_hash text not null,                  -- sha256 of normalized content
  embedding_state text not null default 'pending'
    check (embedding_state in ('pending','ready','failed','skipped')),
  deleted_at integer,
  created_at integer not null,
  updated_at integer not null
);

create unique index items_external
  on items(workspace_id, connection_id, external_id)
  where external_id is not null;
create unique index items_canonical
  on items(workspace_id, canonical_url)
  where canonical_url is not null and deleted_at is null;
create index items_ws_captured on items(workspace_id, captured_at desc);
create index items_ws_source on items(workspace_id, source);

create virtual table items_fts using fts5(
  title, excerpt, tags, tokenize = 'unicode61 remove_diacritics 2'
);
-- rowid = items rowid; kept in sync by AFTER INSERT/UPDATE/DELETE triggers.

create table item_chunks (
  item_id text not null references items(id) on delete cascade,
  chunk_index integer not null,
  vector_id text not null unique,              -- sha256(item_id || chunk_index)
  content_r2_key text not null,
  token_count integer not null,
  primary key (item_id, chunk_index)
);

create table tags (
  workspace_id text not null,
  id text not null,
  name text not null,
  primary key (workspace_id, id)
);

create table item_tags (
  workspace_id text not null,
  item_id text not null references items(id) on delete cascade,
  tag_id text not null references tags(id) on delete cascade,
  primary key (item_id, tag_id)
);

create table imports (
  id text primary key,
  workspace_id text not null,
  kind text not null,                          -- 'browser_html','keep_takeout','obsidian_zip'
  status text not null check (status in ('queued','parsing','enriching','done','failed')),
  total integer not null default 0,
  processed integer not null default 0,
  error text,
  created_at integer not null,
  finished_at integer
);

create table usage_daily (
  workspace_id text not null,
  day text not null,                           -- YYYY-MM-DD UTC
  enrichments integer not null default 0,
  mcp_calls integer not null default 0,
  items integer not null default 0,
  primary key (workspace_id, day)
);

create table audit_log (
  id text primary key,
  workspace_id text not null,
  actor_user_id text,
  action text not null,
  target text,
  ip_hash text,
  meta text,                                   -- JSON, no secrets
  created_at integer not null
);
```

Other tables: `users`, `sessions`, `otp_codes`, `api_keys` (hashed, prefix displayed), Stripe subscription mirror, `oauth_grants` (planned for MCP OAuth), deletion tombstones. Sessions are owned by `packages/auth`, not a third-party schema.

**Why D1 is safe here:** item text lives in R2; D1 stores metadata + first 2KB + FTS. A 100k-item workspace stays well under D1 size limits, and the hot path (search) is read-mostly. Counter writes go to DOs and flush to `usage_daily` hourly, never per request.

---

## 8. Search architecture

**Two indexes, one ranking:**

1. **Lexical:** D1 FTS5 (BM25) over title, excerpt, tags. Exact names, error codes, quotes.
2. **Semantic:** Vectorize, `bge-m3` 1024-dim, cosine, chunked at ~800 tokens with 100 overlap, namespace = workspace.

**Query flow (`packages/search`):**

```
normalize query
  ├─ detect language (cheap heuristic; bge-m3 handles the rest)
  ├─ classify intent: keyword | question | url | command
  ├─ embed query (cached 24h in D1 by sha256(model + normalized query))
  ├─ Vectorize.query(topK=60, namespace=ws, filter=kind/source/date)
  └─ FTS5 MATCH(topK=60, sanitized MATCH expression)
      ↓
  RRF fuse: score(item) = Σ 1/(60 + rank_i)
      ↓
  recency boost: × (1 + 0.15 · e^(−ageDays/180))
  source diversity: max 3 per source in top 20
  dedupe: canonical_url + normalized title
      ↓
  hydrate from D1 → items with url, summary, matched chunk excerpt
      ↓
  if intent = question and top score ≥ threshold:
      stream answer with [n] citations (SSE); refuse when no sources
```

Rules:

- `topK` is a constant per plan; no unbounded scans.
- Empty/whitespace query returns recent items, not an error.
- `url` intent returns the single canonical match or a "capture this" action.
- Answer synthesis is optional UI, never required for results; citations resolve to exact item + chunk.
- Cache search results for 60s per (workspace, query, filters) in D1 to absorb repeat queries; invalidate on write.
- Latency target: p95 ≤ 400ms for results (no answer), p95 ≤ 2.5s to first answer token.

**Embedding lifecycle:** content hash unchanged → skip. Changed → delete old vector ids (`deleteByIds`), re-chunk, upsert. Deleted item → delete vectors by prefix (tracked in `item_chunks`). Nightly reconciliation job samples 1% of items and asserts vector id existence; mismatches are repaired or deleted (`ponytail:` sampling, full sweep if drift > 0.5%).

---

## 9. Ingestion pipeline

```
capture / import / connector tick
        ↓ (validate + canonicalize + dedupe)
   items row (embedding_state = pending, content in R2)
        ↓ enqueue batch (50)
   consumer: fetch (if URL) → sanitize → readability → summary + tags
        ↓
   chunk → embed (batch 20) → Vectorize upsert
        ↓
   FTS trigger + embedding_state = ready
```

- **Idempotency:** every consumer re-reads the row, compares `content_hash`, and exits if already `ready` with the same hash. At-least-once delivery is assumed.
- **Backoff:** 429/5xx retry with jitter, max 5 attempts, then DLQ + `embedding_state = failed` + a UI "retry" action. Never retry 4xx auth errors; mark the connection `degraded` instead.
- **Backfill:** connector backfill writes items in pages of 100 and reports progress to `imports`; UI subscribes via SSE or polls 2s.
- **Canonical URL:** lowercase host, strip `utm_*`, `fbclid`, `gclid`, `ref`, trailing slash, fragment (keep `#!`), sort query params. Hash to `canonical_url` for dedupe. Never dedupe across workspaces.
- **Browser import:** parse `bookmarks.html` **client-side** with `DOMParser` (privacy + zero server CPU); POST 500-item batches. Server also accepts a file upload for CLI/automation, parsed with `linkedom` and capped at 20MB. Re-import is a no-op thanks to canonical dedupe.
- **Keep Takeout / Obsidian:** client-side zip read (JSZip) → markdown/HTML → same batch path. No server-side unzip unless a signed-in user uploads via API.
- **Snapshots:** store sanitized text in R2 (`ws/<id>/items/<itemId>.md`, max 256KB). Raw HTML is not retained by default (privacy + cost); if enabled per workspace, 30-day lifecycle rule.

---

## 10. Connector framework and per-provider reality

### 10.1 Model

A connector is a **manifest + adapter functions**, executed in-process by the API Worker. Users "install" a connection, not arbitrary code. This is the load-bearing security decision: no third-party JavaScript runs in our Workers in v1.

```ts
// packages/connectors/src/sdk.ts (shape)
export const notion = defineConnector({
  id: "notion",
  name: "Notion",
  category: "Knowledge hub",
  auth: { type: "oauth2", pkce: true, scopes: ["read_content"] },
  capabilities: ["import", "incremental", "revoke"],
  rateLimit: { rps: 3, burst: 5 },
  schedule: "*/15 * * * *",
  status: "ga", // ga | beta | import-only
  async list(ctx, cursor) {
    /* returns { items, nextCursor } */
  },
  async revoke(ctx) {
    /* best-effort token revoke */
  },
});
```

Install flow (sequence):

```
UI POST /api/v1/connections { appId }
  → API creates connection(status=authorizing) + state (KV-free: D1 row, 10 min TTL)
  → returns { authorizeUrl }
Browser → provider consent → GET /api/v1/oauth/:app/callback?code&state
  → validate state (session-bound, single-use) → exchange code (PKCE)
  → encrypt tokens → connection(status=connected) → enqueue backfill
  → redirect to /apps/:app?installed=1
UI polls GET /api/v1/connections/:id → shows progress + first items
```

Sync loop: acquire a lease in the workspace DO (prevents overlapping runs) → call `list(cursor)` → upsert items → persist cursor → release. On 401: refresh token under a DO lock; if refresh fails, `degraded` + email. On 403 scope error: `degraded` with a "reconnect with scopes" CTA. On 429: honor `Retry-After`, backoff, do not burn quota.

Disconnect: best-effort revoke at provider → status `revoked` → ask "keep imported items or delete them?" (default keep; delete purges D1 rows, vectors, R2 prefix, with audit entry).

### 10.2 Provider matrix (this is where most plans lie)

| Provider                                       | Auth                         | API reality                                                                                                                                     | Sync                                                     | Launch                                       |
| ---------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Browser bookmarks (Chrome/Edge/Firefox/Safari) | none                         | HTML/JSON export is stable; extension uses `chrome.bookmarks` / `browser.bookmarks` (MV3)                                                       | File import; extension live sync                         | **File import v1**, extension Phase 3        |
| Notion                                         | OAuth 2 public integration   | Official API, ~3 req/s average per integration; no reliable page-content webhooks at GA                                                         | Poll by `last_edited_time` cursor, 15 min                | Phase 3                                      |
| X (Twitter)                                    | OAuth 2.0 PKCE, user context | `GET /2/users/:id/bookmarks`, **paid API tier required**, tight per-user rate limits, pagination only (no `since_id`)                           | Stop at first known tweet id; archive import as fallback | Phase 3, gated on API access                 |
| Google Keep                                    | **No consumer API**          | Keep API is Google Workspace only (service account + domain-wide delegation, admin consent). Unofficial libraries are not acceptable for a SaaS | **Takeout import only** (`Takeout/Keep/*.json`/HTML)     | Phase 2 import; Workspace connector Phase 4+ |
| Readwise / Reader                              | API token                    | Stable, generous; highlights + documents                                                                                                        | Incremental by `updatedAfter`                            | Phase 3                                      |
| Raindrop.io                                    | OAuth/token                  | Official API, collections + bookmarks                                                                                                           | Incremental by `lastUpdate`                              | Phase 3                                      |
| Pocket                                         | —                            | **Discontinued July 2025**                                                                                                                      | Import from export only; no live sync                    | Import only, if demand exists                |
| Obsidian                                       | none                         | Local vault; no cloud API (Sync is proprietary)                                                                                                 | Markdown zip import                                      | Phase 4                                      |
| Instapaper                                     | OAuth 1.0a / xAuth           | Works, dated                                                                                                                                    | Archive import                                           | Phase 4                                      |
| Any URL                                        | none                         | Quick capture + bookmarklet + PWA share target                                                                                                  | Immediate                                                | Phase 1                                      |

**Decision:** launch with browser file import + Notion + X (if API access is granted) + Raindrop. Keep is an import, not a sync, and the UI must say so. Do not promise Keep live sync in marketing.

### 10.3 App Store UX

- Grid of cards: logo, name, category, one-line value, `Read-only` / `Import only` / `Beta` badge, connection health dot.
- Detail sheet before install: **exactly which scopes**, what is read, what is written, retention, "disconnect at any time", link to privacy page. No dark patterns.
- Installing: provider OAuth in a popup, then an in-app progress panel ("Imported 128 / 1,204 · summarizing 12 pages").
- Installed card: last sync time, item count, health (`Connected`, `Needs reconnect`, `Paused`), `Sync now`, `Disconnect`.
- Failure states are first-class: expired token banner with one-click reconnect, per-connection sync log (last 20 events, redacted), retry.
- Kill switches: per-connector global flag (D1 config) and per-connection pause, both usable without a deploy.

---

## 11. Remote MCP server

- **Transport:** Streamable HTTP at `https://mcp.omnibrain.ai/mcp` (SSE is legacy; do not build it).
- **Auth:** OAuth 2.1 with dynamic client registration via `@cloudflare/workers-oauth-provider`; scopes `kb.read`, `kb.write`. Session state in a Durable Object (`McpAgent` pattern from `agents/mcp`).
- **Tools (namespaced):**
  - `omnibrain_search(query, limit?, source?, since?)` → ranked items with URLs + excerpts; never raw embeddings.
  - `omnibrain_fetch(item_id)` → full sanitized text + metadata.
  - `omnibrain_recent(limit?)` → latest captures.
  - `omnibrain_save_note(text, tags?, url?)` → writes an item (requires `kb.write`), returns id.
- **Safety:** per-token rate limit, workspace scoping identical to the web app, per-key event log (`connect`, `tools_list`, `tool_call`, `error`), max response size 64KB, `omnibrain_search` caps `limit` at 20. No admin or bulk-delete tools.
- **Client setup page:** copy-paste config for Claude Desktop/Cursor, plus a live "test call" console (the existing prototype's MCP console, restyled).

---

## 12. HTTP API (v1)

Hono + `@hono/zod-openapi`. Everything under `/api/v1`. Errors use one shape: `{ error: { code, message, requestId, details? } }`. Idempotency keys on all POSTs that create billable work.

| Area             | Routes                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth             | `POST /auth/otp`, `POST /auth/verify`, `GET /auth/:provider`, `GET /auth/:provider/callback`, `POST /auth/logout`                                                                                 |
| Workspaces       | `GET/POST /workspaces`, `GET/PATCH /workspaces/:id`, `GET/POST/DELETE /workspaces/:id/members`, `POST /workspaces/:id/invites`                                                                    |
| Items            | `GET/POST /items`, `GET/PATCH/DELETE /items/:id`, `POST /items/batch` (import), `POST /items/:id/retry`, `GET /items/:id/content`                                                                 |
| Search           | `POST /search`, `GET /search/stream` (answer SSE), `GET /items/:id/related`                                                                                                                       |
| Tags/collections | `GET/POST /tags`, `GET/POST /collections`, `POST /collections/:id/items`                                                                                                                          |
| App Store        | `GET /apps`, `GET /apps/:id`, `GET/POST /connections`, `GET /connections/:id`, `POST /connections/:id/sync`, `POST /connections/:id/pause`, `DELETE /connections/:id`, `GET /oauth/:app/callback` |
| Imports          | `POST /imports` (metadata), `POST /imports/:id/batches`, `GET /imports/:id`, `POST /imports/:id/cancel`                                                                                           |
| Billing          | `POST /billing/checkout`, `POST /billing/portal`, `POST /billing/webhook` (raw body, signature verify)                                                                                            |
| MCP/OAuth        | `GET /.well-known/oauth-*`, `POST /oauth/register`, `POST /oauth/token`, `GET /oauth/authorize`                                                                                                   |
| Ops              | `GET /health`, `GET /me/export`, `DELETE /me`, `GET /audit` (admin)                                                                                                                               |

Frontend consumes the API through Hono's typed RPC client, so schema drift is a type error, not a runtime bug. OpenAPI is generated for external consumers and MCP discovery.

---

## 13. UI/UX system — "Living Atlas"

**Intent:** the interface should feel like navigating your own memory, not operating a CRUD admin. Calm surfaces, strong hierarchy, one obvious input, motion that explains state.

### 13.1 Layout

```
┌────────────┬──────────────────────────────────────┬─────────────┐
│ Rail       │ Canvas                               │ Inspector   │
│ · Recall   │  Atlas (default) / List / Item       │ preview,    │
│ · Sources  │  density map + recent cards          │ provenance, │
│ · Collections│                                    │ actions     │
│ · Apps     │                                      │             │
│ · Settings │                                      │             │
└────────────┴──────────────────────────────────────┴─────────────┘
```

- **Rail** collapses to icons < 1024px; bottom tab bar < 768px.
- **Canvas** is the product; no widget dashboard. Default view = **Atlas**: a zoomable density map of captures by week × source, rendered on canvas (not SVG), with heat cells and a scrubber. Click a cell → filtered list. This is the "innovative" surface; it is cheap (2D canvas, no graph physics) and genuinely useful for "when did I save that?". In the shipped UI this surface is labelled **Memory map**; _Atlas_ is the internal codename.
- **List** view remains for scanning; virtualized, grouped by day, sticky date headers.
- **Inspector** shows item preview, source, tags, AI provenance ("summarized from 4.2k chars · model · 2m ago"), original link, related items.

### 13.2 Signature interaction: Recall

One omnibox (`⌘K` / `Ctrl+K`), always available:

| Input       | Behavior                                           |
| ----------- | -------------------------------------------------- |
| `https://…` | Capture sheet with prefilled URL                   |
| `/`         | Command mode (navigate, install, theme, export)    |
| plain text  | Hybrid search, streamed answer with citation chips |
| `?`         | Shortcut overlay                                   |

Keyboard: `j/k` navigate, `Enter` open, `o` open original, `c` capture, `g a` Atlas, `g l` List, `Esc` close. Full focus trap, no mouse required.

### 13.3 Visual language

- **Dark-first, not dark-only.** Default "Ink", optional "Paper" light and "Contrast" high-contrast themes. No purple gradient clichés, no glassmorphism everywhere, no neon glow.
- **Palette (oklch, in `@theme`):** ink `oklch(0.18 0.02 250)`, surface `oklch(0.23 0.015 250)`, paper `oklch(0.97 0.006 85)`, signal amber `oklch(0.80 0.15 78)` (primary action), cobalt `oklch(0.62 0.16 255)` (links/selection), mint `oklch(0.78 0.13 160)` (success), coral `oklch(0.68 0.17 25)` (danger). One accent per surface.
- **Type:** Geist Sans (UI) + Geist Mono (metadata, counts, URLs), self-hosted variable subsets. 14px app base, 16px reading, 1.25 scale, tight heading tracking.
- **Shape:** 10px radius, 1px hairline borders, elevation only for overlays. Dense but breathable: 8px spacing grid.
- **Motion:** 120–200ms, ease-out; spring only for modals/sheets; `prefers-reduced-motion` disables all non-essential motion. View Transitions for route changes.
- **Content-first cards:** source glyph + title + 2-line excerpt + tags. AI output is always labeled with provenance, never blended into the user's own words.
- **Empty states teach:** sample import button, 3 example queries, shortcut hints. No dead ends, no lorem ipsum.

### 13.4 Component and quality rules

- Radix primitives for dialog/popover/tabs/tooltip/menu (accessibility is not optional); styling is ours.
- Tailwind v4 `@theme` tokens only; no ad-hoc hex values in components. One `packages/ui` primitive per need — do not build a design system for its own sake.
- Component gallery at `/design` (lazy route) instead of Storybook/Ladle. It is one page and always runs.
- **Accessibility gate:** WCAG 2.2 AA, visible `:focus-visible`, 4.5:1 text contrast, 200% zoom, screen-reader labels on icon buttons, no color-only status, skip link.
- **Performance budgets (p75 mobile):** initial JS ≤ 200KB gzip, LCP ≤ 1.8s, INP ≤ 200ms, CLS ≤ 0.05. Atlas canvas lazy-loaded on idle. No icon library barrel imports; import per icon.
- **Anti-taste-test:** if a screen could be a generic SaaS screenshot with the logo swapped, redesign it.

### 13.5 Mobile/PWA

Installable, offline capture queue (IndexedDB + Background Sync fallback), Web Share Target ("Share to OmniBrain"), capture sheet with URL/title/note, fast share extension path. No native app in v1.

---

## 14. Billing, quotas, abuse

- Stripe Checkout (subscription), Customer Portal, webhooks for `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`. Verify signatures with the async WebCrypto helper; store raw event id for idempotency.
- Entitlements are a pure function in `packages/core`: `(plan, usage) → { allowed, limit, remaining }`. Client uses it for UI, server uses the same code for enforcement. One source of truth.
- Usage counters live in the workspace DO, flushed hourly to `usage_daily`. Soft warn at 80%, hard block at 100% (search always allowed; enrichment and new connections blocked). Export always allowed.
- Trial: 14 days Pro, no card. Downgrade never deletes data; over-limit workspaces become read-only instead of losing items.
- Abuse controls: per-workspace enrichment budget, duplicate-content check before embedding, max 5 concurrent imports, per-IP signup limits, disposable-email domain blocklist, Stripe Radar.
- Taxes/receipts via Stripe Tax. No custom invoicing in v1.

---

## 15. Observability, SLOs, and ops

| Signal                        | Target        |
| ----------------------------- | ------------- |
| Search results p95            | ≤ 400ms       |
| Recall answer first token p95 | ≤ 2.5s        |
| Capture → searchable p95      | ≤ 60s         |
| Connector sync success (24h)  | ≥ 98%         |
| API 5xx rate                  | < 0.5%        |
| MCP tool p95                  | ≤ 800ms       |
| Worker error budget           | 99.9% monthly |

- Structured JSON logs with `requestId`, `workspaceId`, `route`, `durationMs`; no PII, no tokens. Tail Worker → Axiom.
- Sentry for frontend + Worker exceptions; source maps uploaded in CI.
- Analytics Engine for product events (`capture`, `search`, `install`, `answer_clicked`, `mcp_call`) — no third-party pixel, no cookie banner for first-party analytics.
- Dashboards: ingest lag, DLQ depth, embedding failures, per-connector auth failures, cost per workspace, search zero-result rate.
- Alerts: DLQ > 100, sync failure > 5%, 5xx > 1% for 5 min, Stripe webhook failures, vector/DB error spikes.
- Runbooks in `docs/runbooks/`: connector outage, token leak, bad deploy rollback, DLQ drain, quota misfire, vector drift.
- Rollback: redeploy the previous green commit via Alchemy; migrations are additive-only, never destructive in the same release (two-step: expand, then contract).

---

## 16. Testing strategy

| Layer              | Tool                                           | What it must prove                                                                             |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unit               | `bun test`                                     | canonicalize, chunking, RRF, entitlements, redaction, URL safety, date math                    |
| Worker integration | `bunx vitest run` + `vitest-pool-workers`      | D1 queries, queue idempotency, DO locks/quotas, OAuth callback, MCP tools, cross-tenant canary |
| Provider contract  | recorded fixtures + fetch mock                 | Cursor pagination, 429 backoff, token refresh, revoked-token handling, malformed payloads      |
| E2E                | Playwright                                     | signup → import 50 bookmarks → search → install mock connector → disconnect → MCP call         |
| Accessibility      | `@axe-core/playwright` + manual keyboard pass  | zero serious violations on core flows                                                          |
| Performance        | Lighthouse CI on 3 routes                      | budgets in §13.4                                                                               |
| Load (nightly)     | k6                                             | search p95 under 10× expected peak, import 10k items < 10 min                                  |
| Security           | `bun audit`, gitleaks, ZAP baseline on staging | no high-severity deps/secrets; no obvious injection                                            |

Non-negotiables: a failing cross-tenant test blocks merge. Every bug fix ships with a regression test. Import/enrichment tests use a fake AI binding so CI is deterministic and free.

---

## 17. CI/CD

```yaml
# .github/workflows/ci.yml (shape)
on: [pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.4.4 }
      - run: bun install --frozen-lockfile
      - run: bun format --check # bun fmt
      - run: bun typecheck # tsc --noEmit, all projects
      - run: bun lint # oxlint
      - run: bun test
      - run: bun run build
```

- `deploy.yml`: on tag `v*`, require green CI on the same SHA → `bun alchemy deploy --stage prod` → smoke tests (`/health`, one search, one MCP tool) → notify. Fail closed. No preview worker stage.
- Secrets: `CLOUDFLARE_API_TOKEN` (scoped), `AUTH_SECRET`, `TOKEN_KEY`, Stripe, Resend, provider apps. No secrets in repo, no secrets baked into the SPA.
- Branch protection: 1 review, required checks, linear history, no direct pushes to `main`.

---

## 18. Cost model and guardrails

Do not hardcode vendor prices (they change). Model cost per active workspace per month as:

```
embeddings   = itemsNewOrChanged × avgChunks × embedUnitCost
summaries    = itemsNewOrChanged × summaryTokenCost
answers      = recallAnswers × avgTokens × modelUnitCost
search       = queries × (vectorQueryCost + d1RowsReadCost)
storage      = D1 rows + R2 GB + Vectorize vectors
fixed        = Workers paid plan + Queue + DO + Stripe fees
```

Guardrails: per-workspace monthly AI budget (DO counter), skip enrichment when content hash unchanged, embed in batches, cap page text at 256KB, cache query embeddings, cap Recall answers per plan, and a hard global spend alarm in Phase 4. Phase 0 must produce measured per-item numbers before pricing is finalized.

---

## 19. Roadmap with exit criteria

Sized for 2 full-stack engineers. Weeks are estimates, not promises.

| Phase                          | Weeks | Deliverables                                                                                                                                                      | Exit criteria (must be demonstrable)                                                                                                                                                  |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Foundation**              | 1     | Bun workspace, Alchemy stack, D1 + migrations, Vite shell, OTP auth, CI, design tokens                                                                            | Clean clone → dev URL in < 15 min; deploy from CI; signup/login; `/health` green; one vector insert/query; queue round-trip                                                           |
| **1. Core knowledge base**     | 3     | Workspaces/roles, items CRUD, capture, R2 storage, hybrid search, enrichment pipeline, Atlas + List + Inspector, Recall omnibox (results only), trash/GDPR export | 1,000 seeded items searchable; p95 search ≤ 400ms locally; cross-tenant canary test passes; keyboard-only capture + search; delete removes D1+vectors+R2                              |
| **2. Import & onboarding**     | 2     | Browser HTML/JSON import (client parse), batch API, progress UI, dedupe, sample workspace, onboarding checklist, PWA + share target                               | Import 10k bookmarks in < 10 min; re-import creates 0 duplicates; onboarding reaches first search in < 3 min; Lighthouse budgets met                                                  |
| **3. App Store & connectors**  | 3     | Connector SDK, install/revoke lifecycle, health states, Notion + X (if access) + Raindrop + Keep Takeout import, sync leases, reconnect flow, extension MVP       | Install → OAuth → 100 items synced → disconnect with data choice; expired token surfaces a working reconnect CTA; sync idempotent across overlapping runs                             |
| **4. MCP, billing, hardening** | 2     | MCP server + OAuth DCR, API keys, Stripe plans/portal/webhooks, quota enforcement, answer synthesis with citations, observability + alerts, runbooks              | Claude Desktop/Cursor can search and fetch; upgrade → Pro limits apply without redeploy; 100% of alerts have runbooks; spend alarm fires in staging; security review checklist signed |
| **5. Beta → launch**           | 2     | Accessibility audit, load test, docs, marketing site, migration of prototype UI, 20-user closed beta, fix top 10 issues                                           | WCAG AA on core flows; p95 SLOs met under 10× peak; zero P0/P1 open; support inbox + status page live                                                                                 |

**Global definition of done** (every feature): types + Zod schema, happy path + empty + error states, mobile layout, keyboard access, analytics event, test, docs entry, feature flag, no console errors, no new dependency without a written reason.

---

## 20. Risk register

| Risk                                  | Likelihood | Impact | Mitigation / trigger                                                                             |
| ------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------ |
| X API access denied or too expensive  | High       | Medium | Ship archive import; treat X as optional; gate marketing on signed API tier                      |
| Google Keep has no consumer API       | Certain    | Medium | Takeout import only; UI labels "import", never "sync"; Workspace connector later                 |
| SSRF / malicious URL content          | Medium     | High   | §6 ingress controls; block private ranges; sanitize; prompt-injection delimiters; security tests |
| Token leakage                         | Low        | High   | Envelope encryption, redaction, no token logging, audit, rotation drill in Phase 4               |
| D1 write throughput / hot rows        | Medium     | High   | DO counters, batched writes, no per-request counters; load test in Phase 4                       |
| Vectorize cost/latency at scale       | Medium     | Medium | Chunk caps, hash skip, namespace per workspace, cache; measure in Phase 0                        |
| Alchemy API drift                     | Medium     | Medium | Phase 0 spike, pinned version, one IaC file, upgrade PRs isolated                                |
| At-least-once duplicates              | High       | Medium | Idempotent consumers + unique indexes + content hash                                             |
| Scope creep (graph, chat, plugins)    | High       | High   | Non-goals in §1; anything new needs a phase exit criterion                                       |
| Extension store review delays         | Medium     | Low    | Ship file import first; extension is additive                                                    |
| Prompt injection via imported content | Medium     | Medium | Model output schema-validated, never executed; content delimited; no tool calls from summaries   |
| Billing/entitlement drift             | Low        | Medium | Shared pure entitlement function + server enforcement tests                                      |

---

## 21. Launch checklist

- [ ] Alchemy deploy reproducible from a clean clone in dev and prod
- [ ] Cross-tenant isolation suite green (items, search, vectors, R2, MCP, exports)
- [ ] GDPR export + delete verified end-to-end, including vectors and R2
- [ ] OAuth state/PKCE tests; token refresh + revoke tests per connector
- [ ] SSRF suite (metadata IP, redirect chains, oversized bodies) green
- [ ] Rate limits and quota blocks verified with `Retry-After`
- [ ] WCAG AA audit + keyboard-only walkthrough
- [ ] Performance budgets met on mobile p75
- [ ] Backups: D1 export job + restore drill; R2 lifecycle verified
- [ ] Dashboards, alerts, runbooks, on-call rotation
- [ ] Stripe live-mode smoke test (upgrade, downgrade, failed payment)
- [ ] MCP tested from Claude Desktop and Cursor with real OAuth
- [ ] Status page, support inbox, privacy/terms, subprocessor list
- [ ] Kill switches tested without a deploy

---

## 22. Open decisions (resolve before Phase 3)

1. Auth: email OTP sessions are in place; evaluate SSO for enterprise customers before adding a provider.
2. Launch connectors: is X API access purchased? If not, launch with browser + Notion + Raindrop, Keep import.
3. Pricing validation: run 10 interviews before Stripe goes live; keep limits in one config file.
4. Extension timing: MV3 now or after beta? Default: after beta, file import covers the job.
5. Answer synthesis model: run a 50-query quality bake-off in Phase 1, pin the winner per environment.
6. Atlas view default vs List default: ship both, default Atlas, measure recall success in beta.
7. Team sharing: roles only in v1; per-collection ACLs deferred until a team customer asks.

---

## 23. Prototype mapping

`omnibrain_dashboard.tsx` is a visual prototype, not a codebase to extend. Keep its four surfaces (Knowledge, App Store, Import, MCP) and its interaction model; replace its styling with the `packages/ui` system, split it into routes, and move all mock state to the API. Do not copy its inline mock arrays or its indigo/zinc palette. The App Store install modal, import progress panel, and MCP console become components with real states (loading, empty, error, degraded) rather than simulated timers.
