<p align="center">
  <img src="./assets/logo.svg" alt="OmniBrain logo" width="96" height="96" />
</p>

# OmniBrain

Multi-tenant knowledge recall: bookmarks, Notion pages, X posts and Keep imports in one honest, cited search. Bun + TypeScript + Cloudflare + Alchemy.

The full product and architecture plan is in [PLAN.md](./PLAN.md). This repo is the working implementation of the first vertical slice.

## Quick start

```bash
bun install
bun run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787 (health at `/health`)
- Demo account: `demo@omnibrain.local` (seeded workspace, 22 items)

Sign in with the demo email. In development the six-digit code is returned as `dev_code`, shown in
the UI, and printed in the API terminal. No email provider is required locally. Production always
sends the code through Resend and never returns it in the response.

```bash
bun test              # core, db, auth, connectors, AI, API
bun typecheck         # tsc --noEmit, every project
bun lint              # oxlint
bun format            # Bun formatter (native: bun fmt)
bun format --check    # formatting gate
bun run build         # production SPA
bun run check         # format check + typecheck + lint + tests + build
```

## Stack

| Layer           | Choice                                          |
| --------------- | ----------------------------------------------- |
| Runtime/tooling | Bun workspaces, `bun test`, `bun fmt`, `oxlint` |
| API             | Hono on Cloudflare Workers (`apps/api`)         |
| Web             | React 19 + Vite 8 + Tailwind v4 (`apps/web`)    |
| Data            | D1-compatible SQL + FTS5, R2, Vectorize         |
| AI              | Workers AI `bge-m3` embeddings + instruct model |
| Infra           | Alchemy (`alchemy.run.ts`), no `wrangler.toml`  |
| Auth            | Email OTP + hashed opaque session tokens        |

Production compute is workerd. Bun is the toolchain, not the deployed runtime.

## What works now

- Email OTP signup/login, workspaces, roles, HttpOnly sessions, CSRF origin checks, rate limits.
- Items CRUD, trash + 30-day purge, per-tenant scoping enforced by `forWorkspace()`.
- Browser bookmark HTML parser and Google Keep Takeout parser (both run client-side in the import UI).
- Batch import with canonical-URL dedupe and idempotent re-import.
- Hybrid search: FTS5 lexical + Vectorize semantic fused with RRF, recency boost, source diversity, optional cited answer.
- Enrichment pipeline: SSRF-guarded fetch, regex readability, summary/tags, chunking, embeddings, R2 snapshot.
- Connector catalog with real lifecycle: install (OAuth/PKCE), health states, pause, sync, disconnect with keep/delete choice.
- Remote MCP endpoint (Streamable HTTP, JSON-RPC, API keys) with `omnibrain_search`, `omnibrain_fetch`, `omnibrain_recent`, `omnibrain_save_note`.
- MCP keys with inline reveal/copy, an icon-driven logs dialog (filter by key, search, timestamps) and per-key client events.
- Notch Toast notifications and Kirari syntax highlighting for JSON config/results.
- Flat memory map with 52 weeks of small boxes, drag-box source/date filtering, and a resizable inspector.
- Usage/entitlement accounting, API keys, GDPR export, account deletion with vector cleanup.
- Memory-map density chart, list stream, inspector, Recall omnibox, App Store, Import, MCP console, Settings. Ink/Paper/Contrast themes, keyboard-first, responsive down to 390px.

## What is explicitly deferred

Honest list, matching PLAN §19:

- Stripe checkout/webhooks (entitlement model exists; no payment provider wired).
- Notion/X/Raindrop live sync is implemented but needs OAuth app credentials; without them the App Store says so and keeps the button disabled.
- Refresh-token rotation, per-connector cron schedules, and queue-backed enrichment (inline + optional `ENRICH_QUEUE` hook exist).
- Durable Object counters (rate limits are per-isolate, adequate for dev/small scale).
- Browser extension, Obsidian/Readwise import, team invites, public sharing.
- OAuth 2.1 for MCP (API keys today).
- Vitest workerd pool / Playwright CI (Bun tests cover pure logic and Hono routes end-to-end).

## Deploy (Alchemy)

```bash
cp .env.example .env            # fill AUTH_SECRET and APP_ORIGIN
bun alchemy profile edit --add Cloudflare
AUTH_SECRET=... APP_ORIGIN=https://app.example.com bun alchemy deploy --stage prod
```

`alchemy.run.ts` provisions D1 (with migrations), R2, the Vectorize index (1024 dims, cosine), the API Worker, and the Vite site. The web bundle receives `VITE_API_URL` at build time. Cross-site cookies use `SameSite=None` over HTTPS; set `APP_ORIGIN` to the web origin.

Connector OAuth apps need these redirect URIs:

- Notion/X/Raindrop: `https://<api-host>/api/v1/oauth/<app>/callback`

## Layout

```
apps/api/src/
  app.ts            Hono wiring, CORS, security headers, errors
  routes/           auth, items, search, apps/oauth, imports, keys, account
  services/         enrich, search, connectors, items, mail
  mcp.ts            Streamable HTTP JSON-RPC tools
  worker.ts         fetch + queue + scheduled (trash purge, sessions)
  dev.ts            Bun dev server, SQLite, seed
packages/
  core/             schemas, errors, ids/hashing, entitlements
  db/               SQL migration, D1/SQLite client, tenant-scoped repository
  auth/             OTP + sessions
  ai/               chunking, prompts, embeddings, answer synthesis
  search/           canonicalize, FTS query, RRF, recency/diversity
  connectors/       manifests, bookmark/Keep parsers, OAuth helpers, adapters
  ui/               tokens + primitives
alchemy.run.ts      the infrastructure graph
```

## Security notes

- Every tenant read/write goes through `forWorkspace(db, workspaceId)`; the canary test in `packages/db/src/repo.test.ts` proves isolation.
- Connector tokens are AES-GCM encrypted (`v1:<iv>:<ct>`) and never returned by the API or included in exports.
- URL ingestion blocks private/metadata hosts and validates every redirect; content is treated as untrusted data, never instructions.
- MCP keys are stored hashed, shown once, scoped to one workspace, and metered.
- Dev mode echoes OTP codes for local login. It is disabled unless `DEV_MODE=1` (the Bun dev server sets it; the Worker does not).

See [docs/readme.md](./docs/readme.md) for the documentation index, including architecture, API, connectors, security, operations and design. Deliberate deviations from PLAN.md are in [docs/decisions.md](./docs/decisions.md).
