---
name: omnibrain
description: Work on the OmniBrain codebase (Bun/TypeScript monorepo: Hono API on Cloudflare Workers/D1, React 19 + Vite SPA, multi-tenant auth, hybrid search, connectors and MCP). Use when implementing features, fixing bugs, reviewing code, or changing the UI in this repository.
license: MIT
metadata:
  author: omnibrain
  version: "0.2.0"
---

# OmniBrain

Use this skill whenever you change code in this repository. It encodes the project's invariants and
the checks that must pass; `AGENTS.md` at the repo root is the authoritative short guide.

## Before editing

1. Read `AGENTS.md`, then the relevant doc in `docs/` (`architecture.md`, `api.md`, `connectors.md`,
   `development.md`, `security.md`, `design.md`, `decisions.md`).
2. Find the owning package. API route → `apps/api/src/routes/*`; repo/SQL → `packages/db`; shared types
   or entitlements → `packages/core`; UI → `apps/web/src` + `packages/ui`.
3. Trace all callers before changing a shared function. Fix the root cause once, not each caller.

## Invariants

- All workspace data access goes through `forWorkspace(db, workspaceId)` or `repoOf(env, workspaceId)`.
- SQL is parameterized; schema changes get a new numbered migration in `packages/db/migrations`.
- Quotas are enforced server-side with `checkEntitlement` and `planUsage`; UI limits are display only.
- Never log, commit, or return OAuth tokens, API-key secrets, or session tokens.
- Connector credentials may be stored encrypted in the DB (App Store → credentials); env vars are a
  fallback only.
- MCP tools stay namespaced `omnibrain_*`, bearer-key authenticated, metered and audited.
- Production email uses the Cloudflare Email Service `EMAIL` binding; OTPs expire in 10 minutes and
  have a durable 60-second resend cooldown per address.
- Mutations go through `apps/web/src/lib/api.ts`, which attaches the CSRF header; writes are
  rate-limited per workspace+user. Never call `fetch` for a mutation directly.
- SPA `view`/`status`/`source`/`layout`/Atlas filter live in URL search params; theme, accent and
  panel width live in localStorage. No global state library.

## UI conventions

- Compose with `packages/ui` primitives (shadcn-style) and existing view patterns.
- Theme via `data-theme` / `data-accent`; use `--accent` tokens. Flat, compact, no white borders.
- Use the `Tooltip` component, never native `title` attributes.
- Source icons: `SourceGlyph`/`BrandLogo` in `currentColor`; never first-letter glyphs.
- Page containers are `max-w-3xl`. Keep JSON/code highlighting theme-derived (`JsonBlock`, `NoteText`).
- The inspector only renders for a selected item; closing clears selection. In Trash it has Restore
  next to Re-enrich.
- Show a `SectionLoading` skeleton before section content; never flash an empty state during the
  first fetch. Status switches clear the previous bucket.
- Memoize list rows and keep their callbacks stable; lazy-load heavy views. Initial bundle ≤ 200 KB gzip.
- Mutations are optimistic; on failure resync with `refresh()`. `refresh()` is abortable, so skip
  `AbortError` rather than toasting it.
- Motion: native View Transitions for view switches, `inspector-spring`, `scaleY` selection bar. Gate
  on `prefers-reduced-motion`.

## Working loop

```bash
bun run dev        # leave running: API :8787, web :5173
# make the change
bun format && bun typecheck && bun lint && bun test && bun run build
```

- Bundle budget: initial JS ≤ 200 KB gzip. `Import`, `Apps`, `MCP`, `NoteCapture`, `Markdown` and
  `ItemGraph` are lazy-loaded on purpose; don't add heavy dependencies to the entry chunk.
- Dev login: `demo@omnibrain.local`; OTP is in the API terminal / `dev_code`.
- Clean up any test rows you create (items, API keys, connections, imports) in `.data/dev.db`.
- Do not kill running dev servers unless a port conflict requires it; do not wipe user data.

## Gotchas

- `accountRoutes` is mounted at `/`, so plan routes are `/api/v1/plan`, not `/api/v1/account/plan`.
- On Windows, record case-only renames with a two-step `git mv a __tmp && git mv __tmp b`.
- Import and sync dedupe by canonical URL; duplicate handling must stay idempotent.
- Keep `apps/web/src/lib/api.ts` response types aligned with the API.
- Mutations from scripts/curl need `x-csrf-token`; the SPA reads it from the `omnibrain_csrf` cookie.
- CSP is build-time only for the SPA (`<meta>` injected by Vite); HSTS/CSP/COOP headers cover API
  responses. Production sourcemaps are off.
- Theme/accent storage keys are versioned (`.v2`); accent ids are `cobalt|amber|mint|rose|violet|cyan`.

## Done

Report what changed, what you verified in the browser or tests, and the final `bun run check` result.
Skip speculative abstractions, new dependencies, and unrequested scope.
