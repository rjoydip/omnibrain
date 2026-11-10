# AGENTS.md

Guidance for coding agents working in this repository. This file is the short operational version; the
long-form design lives in [`docs/`](./docs/readme.md) and [`PLAN.md`](./PLAN.md).

## What this is

OmniBrain is a multi-tenant "recall layer" for bookmarks, notes and highlights. One Bun + TypeScript
monorepo: a Hono API on Cloudflare Workers (D1-compatible SQL, Vectorize, R2, Workers AI) and a React 19
SPA. Local development uses `bun:sqlite` behind the same `SqlClient` interface as D1.

## Commands

Run from the repo root:

```bash
bun install
bun run dev        # API on :8787 + web on :5173 (leave it running)
bun test           # unit + Hono route tests
bun run typecheck  # every project
bun run lint       # oxlint
bun run format     # bun fmt (also formats markdown)
bun run build      # production SPA
bun run check      # format check + typecheck + lint + tests + build
```

Definition of done for any change: `bun format && bun typecheck && bun lint && bun test && bun run build`
all pass. The initial JS bundle must stay **≤ 200 KB gzip**; `Import`, `Apps`, `MCP`, `NoteCapture`,
`Markdown` and `ItemGraph` are lazy-loaded on purpose.

## Repo map

| Path                  | What lives there                                                            |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/api`            | Hono routes, MCP server, connector/oauth services, dev SQLite entrypoint    |
| `apps/web`            | React SPA: views, components, API client, styles/tokens                     |
| `packages/ui`         | shadcn-style primitives (`Button`, `Badge`, `Card`, menus, modals, tooltip) |
| `packages/db`         | SQL repo, migrations (`packages/db/migrations`), sqlite/D1 adapters         |
| `packages/core`       | schemas, entitlements/plans, ids, errors                                    |
| `packages/auth`       | OTP + opaque session tokens                                                 |
| `packages/search`     | hybrid ranking, URL canonicalization, intent detection                      |
| `packages/connectors` | provider registry and file importers (bookmarks, Keep)                      |
| `packages/ai`         | Workers AI embeddings/summaries                                             |
| `docs/`               | lowercase markdown docs — keep filenames lowercase and links working        |

## Architecture invariants

- **Tenant scoping is not optional.** All data access goes through `forWorkspace(db, workspaceId)` /
  `repoOf(env, workspaceId)`. Never hand-write a query without `workspace_id` filtering.
- **Parameterized SQL only.** No string interpolation of user input. Add a numbered migration in
  `packages/db/migrations`; dev startup applies migrations idempotently.
- **Entitlements are server-side.** Use `checkEntitlement` + `planUsage` for quota actions (items,
  enrichments, MCP calls, connections, API keys). The UI only reflects limits.
- **Auth:** email OTP and opaque hashed session tokens (no third-party auth). Dev returns `dev_code`;
  production sends via Cloudflare Email Service (`EMAIL` binding), with a durable 60-second resend
  cooldown per address. API keys are hashed at rest and shown once.
- **Browser writes are guarded.** Mutating `/api/v1` requests need the `x-csrf-token` header that
  `lib/api.ts` reads from the `omnibrain_csrf` cookie; CORS allows it. Writes are rate-limited per
  workspace+user. Do not add a mutation that bypasses `api.ts`.
- **SPA state:** `view`, `status`, `source`, `layout` and the Atlas filter live in URL search params
  (back/forward + deep links). Theme, accent and panel width stay in localStorage. No global store.
- **Server data is the source of truth.** Mutations update the list optimistically, then confirm;
  failed writes resync with `refresh()`. In-flight `refresh()` calls are abortable.
- **Connectors:** OAuth client ID/secret come from the server environment (`*_CLIENT_ID` / `*_CLIENT_SECRET`)
  so the App Store can do one-click sign-in; DB-stored credentials remain an API-only fallback. Never log
  tokens or secrets.
- **MCP:** tools are namespaced `omnibrain_search|fetch|recent|save_note`; bearer API key auth;
  every call is rate-limited, metered and audited.

## UI conventions

- Use `packages/ui` primitives (shadcn-style) instead of ad-hoc markup. Accent is `--accent` /
  `data-accent`; themes are `ink` (default), `paper`, `contrast` via `data-theme`.
- Flat surfaces: no white/visible borders, compact spacing. Page containers are `max-w-3xl`.
- Never use native `title` attributes for hints — use the `Tooltip` component.
- Source icons come from `SourceGlyph`/`BrandLogo` in `currentColor`; never render a source's first
  letter.
- Inspector is hidden until an item is selected; closing it clears the selection. In Trash it exposes
  Restore beside Re-enrich.
- JSON/code blocks use `JsonBlock` (Kirari) or `NoteText`; token colors derive from the accent.
- Keep `apps/web/src/lib/api.ts` types in sync with API response shapes.
- Every data section renders a loading skeleton (`SectionLoading`) before content; never flash an
  empty state while the first request is in flight.
- Memoize list rows (`memo(KnowledgeItem)`) and keep their callbacks stable. Heavy views stay lazy.
- Motion: native View Transitions for view switches, `inspector-spring` for the panel, `scaleY` for
  the list selection bar. All of it must respect `prefers-reduced-motion`.

## Local dev notes

- Demo login: `demo@omnibrain.local`; the OTP is printed in the API terminal and returned as `dev_code`.
- Dev DB is `.data/dev.db`; it starts empty and only holds what you add. Don't wipe user data.
- Dev servers may already be running; don't kill them unless a port conflict requires it.
- Test data created during verification must be cleaned up (items, keys, connections, imports).

## Gotchas

- API routers are mounted under `/api/v1`: `accountRoutes` is mounted at `/`, so its routes are
  `/plan`, `/account`, not `/account/plan`.
- On Windows, Git is case-insensitive: rename files with a two-step `git mv a __tmp && git mv __tmp b`
  to record case-only changes.
- Import/sync duplicate detection is client-assisted but the server still dedupes by canonical URL.
- Raw MCP key secrets only exist client-side; the MCP console keeps them in `sessionStorage` for the tab.
- `x-csrf-token` is required on mutations from non-browser callers; `api.ts` adds it from the
  `omnibrain_csrf` cookie. Browser tabs are also accepted via `Sec-Fetch-Site: same-origin|same-site`.
- The SPA's CSP is injected as a `<meta>` tag at build time (`vite.config.ts`); HSTS/CSP/COOP headers
  cover API responses only. Production sourcemaps are disabled.

## Docs

- [`docs/readme.md`](./docs/readme.md) — index
- [`docs/architecture.md`](./docs/architecture.md) — tenancy, data flow, search, MCP
- [`docs/api.md`](./docs/api.md) — endpoints and errors
- [`docs/connectors.md`](./docs/connectors.md) — provider setup and imports
- [`docs/development.md`](./docs/development.md) — setup and testing
- [`docs/operations.md`](./docs/operations.md) — env vars, deploy, incidents
- [`docs/security.md`](./docs/security.md) — threat model
- [`docs/design.md`](./docs/design.md) — visual system
- [`docs/decisions.md`](./docs/decisions.md) — ADRs
