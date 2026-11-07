# Development

## Prerequisites

- Bun **1.4.4** or newer. Bun provides the package manager, test runner, formatter (`bun fmt`) and
  script runner (`bun typecheck`, `bun lint`).
- No Docker, Node, database server or Cloudflare account is needed for local work.

## Start

```bash
bun install
bun run dev
```

| Service | URL                          | Notes                                    |
| ------- | ---------------------------- | ---------------------------------------- |
| Web     | http://localhost:5173        | Vite, proxies `/api` and `/mcp` to :8787 |
| API     | http://localhost:8787        | `Bun.serve`, SQLite, seed data           |
| Health  | http://localhost:8787/health | No auth                                  |

Demo login: `demo@omnibrain.local`. The OTP is printed in the API terminal and returned as
`dev_code`; the UI shows a "dev mode" chip that fills it in.

`bun run dev` starts both processes from the repo root, so the API watcher sees `packages/*`
changes (no "not in the project directory" warnings). To run them separately:

```bash
bun run dev:api   # bun --watch scripts/dev-api.ts
bun run dev:web   # Vite
```

## Commands

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `bun test`           | All unit + API tests (`*.test.ts`)                      |
| `bun typecheck`      | Runs `scripts/typecheck.ts`, `tsc --noEmit` per project |
| `bun lint`           | Oxlint over the repo                                    |
| `bun format`         | Bun formatter (writes; native `bun fmt`)                |
| `bun format --check` | Formatting gate (CI)                                    |
| `bun run build`      | Production SPA build to `apps/web/dist`                 |
| `bun run check`      | format check + typecheck + lint + tests + build         |
| `bun run deploy`     | `bun alchemy deploy` (needs credentials)                |

Formatting is configured in `bunfig.toml` (`printWidth = 100`). Do not add Prettier, Biome or ESLint
configs; Bun's formatter and Oxlint are the only tools.

## Layout

```
apps/api/src/app.ts        Hono wiring, middleware, CORS, errors
apps/api/src/routes/       auth, items, search, apps, imports, keys, account
apps/api/src/services/     enrich, search, connectors, items, mail
apps/api/src/mcp.ts        JSON-RPC tools
apps/api/src/worker.ts     fetch + queue + scheduled
apps/api/src/dev.ts        Bun server, SQLite, seed
packages/core/             schemas, errors, ids, entitlements
packages/db/               migration SQL, D1/SQLite client, scoped repository
packages/auth/             OTP + sessions
packages/ai/               chunking, prompts, embeddings, answers
packages/search/           canonical URL, FTS query, RRF, diversity
packages/connectors/       catalog, parsers, OAuth helpers, adapters
packages/ui/               tokens.css + Button/Badge/Card/Modal
apps/web/src/              App shell, views, Recall, Atlas, API client
scripts/                   dev runner, typecheck runner, Playwright checks
```

## Local data

- SQLite file: `.data/dev.db` (gitignored).
- Seed runs only when the demo workspace has zero items.
- Reset everything:

```bash
# stop `bun run dev` first
rm -f .data/dev.db .data/dev.db-shm .data/dev.db-wal
bun run dev
```

The local adapter executes the same migration SQL as D1, including FTS5 triggers. That is deliberate:
`bun test` exercises production queries without Miniflare.

## Environment

Copy `.env.example` to `.env` and fill only what you need:

- `AUTH_SECRET` — required in production; a dev fallback exists in `dev.ts`.
- `APP_ORIGIN` — web origin; dev default `http://localhost:5173`.
- `RESEND_KEY` / `RESEND_FROM` — production email delivery. In development the code is returned
  directly and no email is sent; in production a missing key makes sign-in fail loudly.
- `NOTION_*`, `X_*`, `RAINDROP_*` — optional OAuth client fallbacks. Preferred path is
  App Store → credentials, which stores them AES-GCM encrypted in the database.
- `TOKEN_KEY` — encryption key for connector tokens and stored credentials (falls back to
  `AUTH_SECRET`).

`DEV_MODE` is set by the dev server only. Never set it in the Worker.

## Testing

| Layer          | Where                          | What it proves                                                        |
| -------------- | ------------------------------ | --------------------------------------------------------------------- |
| Unit           | `packages/*/src/*.test.ts`     | canonicalize, RRF, chunking, entitlements, parsers, OTP/session       |
| Repository     | `packages/db/src/repo.test.ts` | real SQLite SQL, FTS triggers, pagination, **cross-tenant isolation** |
| API            | `apps/api/src/api.test.ts`     | signup, capture, search, imports, MCP, CSRF, catalog errors           |
| Security       | `apps/api/src/enrich.test.ts`  | SSRF ranges, HTML extraction                                          |
| UI smoke       | `scripts/shots.ts`             | desktop/mobile/auth screenshots, zero console errors                  |
| Import journey | `scripts/e2e-import.ts`        | real file upload → batch import → "searchable now"                    |

The UI scripts use `playwright-core` with the local Microsoft Edge channel; they are developer
utilities, not CI gates.

## Adding a feature

1. Schema: add a migration in `packages/db/migrations` (additive; never rewrite applied SQL).
2. Data: add a method to `forWorkspace()`; keep the workspace filter inside the repository.
3. Validation: Zod schema in `packages/core/src/schemas.ts`.
4. Route: add to the relevant `apps/api/src/routes/*.ts`; call `requireRole` for writes.
5. Test: API test with `app.request` and a real in-memory DB. Add a cross-tenant assertion if it
   reads tenant data.
6. UI: fetch through `apps/web/src/lib/api.ts`; add loading, empty and error states.
7. Docs: update `docs/api.md` and this file if commands changed.

## Formatting, linting, typechecking

- **Format:** `bun format` (native `bun fmt`). It formats TS/TSX/CSS/HTML/JSON/Markdown. Run it
  before committing; CI runs `bun format --check`.
- **Lint:** `oxlint` with `correctness` as errors, `suspicious`/`perf` as warnings. The config lives
  in `.oxlintrc.json`. Generated output and the legacy prototype are ignored.
- **Typecheck:** `bun typecheck` loops over every `apps/*` / `packages/*` tsconfig with
  `tsc --noEmit`. Adding a package means adding a `tsconfig.json`.

## Common issues

| Symptom                                                          | Fix                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE` on 5173/8787                                        | A stale dev server owns the port. Stop it, or run `PORT=8788 bun run dev:api`; the dev runner kills child process trees on exit. |
| OTP rate-limited                                                 | Dev allows 50/email; wait, or reset `.data/dev.db`                                                                               |
| "File … is not in the project directory and will not be watched" | Bun watch noise from workspace imports; harmless                                                                                 |
| Search says `lexical`                                            | No `AI`/`VECTORS` bindings locally; expected                                                                                     |
| Import rows show "enrich failed"                                 | URL fetch failed (offline/blocked); retry from the inspector                                                                     |
| OAuth button says "Add credentials"                              | Set the provider env vars and restart                                                                                            |
| Alchemy deploy errors before planning                            | Run `bun alchemy profile edit --add Cloudflare`                                                                                  |
