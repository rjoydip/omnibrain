# Decisions and deviations

Short ADRs for choices made while implementing PLAN.md. Each one names the ceiling so future work is deliberate.

## ADR-1: Session auth in-house, not Better Auth

**Decision:** Email OTP + opaque 256-bit session tokens stored hashed in D1, HttpOnly cookies, HMAC/pepper-hashed OTP codes, 5-attempt lockout. Contained in `packages/auth` (≈150 lines) and covered by tests.

**Why:** Better Auth's D1/Kysely integration and org plugin add a large dependency and schema surface for a first slice. The risky parts (random tokens, hashing, expiry, cookie flags) are standard and auditable here.

**Ceiling:** no SSO, 2FA, device management, or org invitations. Swap to Better Auth when the first enterprise/team customer needs SSO; the `SessionUser` + `requireSession` boundary contains the change.

## ADR-2: Raw SQL repository over Drizzle

**Decision:** `packages/db` uses parameterized SQL through a tiny `SqlClient`. D1 and Bun's `bun:sqlite` both implement it. Migrations are plain SQL applied by Alchemy.

**Why:** the identical SQL (including FTS5 triggers) runs in production and in fast local tests. Drizzle would add a codegen step and a second dialect mental model without changing the query plan.

**Ceiling:** no compile-time query types. Row types are explicit interfaces; queries are few and covered by tests. Adopt Drizzle if the schema grows past ~25 tables or joins become dynamic.

## ADR-3: MCP is mounted in the API Worker

**Decision:** `POST /mcp` lives in `apps/api` instead of a separate `apps/mcp` Worker.

**Why:** it shares the same D1, Vectorize, and repository, and one less deployment/URL reduces failure modes. Tenant scoping is enforced by the same code path.

**Ceiling:** MCP traffic shares the API isolate and CPU budget. Split it out when MCP traffic exceeds ~20% of requests or needs independent scaling.

## ADR-4: Four connectors, with honest labels

**Decision:** catalog is Browser (file import), Notion, GitHub and Google Keep. X and Raindrop are parked until their adapters are re-enabled. Removed Readwise/Obsidian cards until their importers exist.

**Why:** dead cards are worse than fewer cards. Keep uses Google OAuth and says the Keep API needs a Workspace account; it never claims personal Gmail works.

**Ceiling:** no Readwise highlights, Obsidian markdown zip, X, Raindrop, or Pocket (discontinued) yet. Add each with its adapter and a test, not a placeholder card.

## ADR-5: Regex readability, not a DOM engine

**Decision:** `extractReadable()` strips scripts/styles and takes `<title>`, meta description, and body text.

**Why:** works in Workers with zero dependencies and is enough for summaries and citations. Tested for script/style removal and size caps.

**Ceiling:** no boilerplate removal, no article-only extraction. Swap to Readability/linkedom when extraction quality (not speed) is the complaint.

## ADR-6: Connectors are first-party in-process; no third-party code

**Decision:** "installing" an app creates a connection and runs a first-party adapter. No arbitrary plugin runtime.

**Why:** sandboxing user JS on Workers means Workers for Platforms, a large security and ops surface. OAuth scopes + server-side adapters deliver the product value now.

**Ceiling:** third-party connectors need a code contribution, not self-serve publishing. Revisit with a manifest-only (no code) extension model before allowing arbitrary code.

## ADR-7: Inline enrichment with an optional queue hook

**Decision:** item creation schedules `enrichItem` through `ENRICH_QUEUE` when bound, otherwise fire-and-forget in the same isolate.

**Why:** keeps `bun run dev` usable with no Cloudflare account. The queue consumer in `worker.ts` is implemented and idempotent on content hash.

**Ceiling:** inline enrichment can lose work if the isolate dies, and large imports are slower. Bind the queue in Alchemy and rely on the consumer before opening self-serve signup.

## ADR-8: Per-isolate rate limiting, DO counters later

**Decision:** fixed-window `Map` limits in `apps/api/src/http.ts`; plan quotas are enforced from D1 usage counts.

**Why:** correct enough for dev and early users; a Durable Object per workspace is the planned durable path (PLAN §6/§14).

**Ceiling:** limits are approximate across isolates/regions. Add the workspace DO before paid tiers with hard cost exposure.

## ADR-9: API keys for MCP, not OAuth 2.1

**Decision:** `ob_…` bearer keys, hashed at rest, scoped to a workspace, metered per plan.

**Why:** the MCP server works with clients that accept custom headers today, and it keeps the first slice testable end-to-end.

**Ceiling:** clients that require OAuth discovery/DCR (some Claude flows) need `@cloudflare/workers-oauth-provider`. Planned before public beta.

## ADR-10: Billing is modeled, not wired

**Decision:** plans, entitlements, usage counters, and limits are implemented and tested. Stripe is not.

**Why:** pricing should be validated before payment plumbing. The hard part (consistent client/server enforcement) is done.

**Ceiling:** no paid signups yet. Add `POST /billing/checkout`, portal, and signed webhooks; keep the entitlement function as the only source of truth.

## ADR-11: Bun-native formatting, Oxlint for linting

**Decision:** `bun fmt` (configured in `bunfig.toml`) formats TS/TSX/CSS/HTML/JSON/Markdown. `oxlint`
lints with correctness errors and suspicious/perf warnings. Biome and Prettier are not installed.

**Why:** one fewer toolchain, no plugin matrix, and the formatter ships with the runtime that already
runs the repo. Oxlint is fast and understands React/TS/a11y without ESLint plugin wiring.

**Ceiling:** Oxlint is syntactic, not type-aware. `bun typecheck` remains the type gate. Add
type-aware linting only if a class of bug repeatedly escapes both.

## ADR-12: No preview Worker stage

**Decision:** CI runs format, typecheck, lint, tests and the web build on PRs. Only tagged commits
deploy (`--stage prod`). The PR preview workflow and the Vite `preview` script were removed.

**Why:** a preview Worker duplicates the resource graph, needs synthetic data, and doubles the
surface that can drift. The Bun dev server plus tests cover review needs.

**Ceiling:** no clickable URL per PR. If product review requires one, add a single ephemeral stage
with its own D1/R2 and no provider credentials, and destroy it on PR close.

## ADR-13: URL state, no client store

**Decision:** `view`, `status`, `source`, `layout` and the Atlas filter are URL search params; theme,
accent and inspector width stay in localStorage. Server data remains the source of truth. Mutations
update the list optimistically, and `refresh()` is abortable.

**Why:** there is no cross-tree writer, undo or offline need that justifies Redux/Zustand. URL state
gives deep links and back/forward for free, and optimistic list edits remove the per-mutation refetch
without adding a cache dependency.

**Ceiling:** a reload refetches the first page. Adopt TanStack Query (or similar) only when caching,
retries or offline mutations become real requirements.

## ADR-14: Cloudflare Email Service for OTP

**Decision:** send OTPs with the Workers `send_email` binding (`EMAIL`) provisioned by
`alchemy.run.ts`. Keep a durable 60-second resend cooldown per address, derived from the stored OTP
row, alongside per-IP/per-email windows and the 10-minute expiry.

**Why:** no third-party API key to rotate, delivery stays inside Cloudflare, and the stored row makes
the cooldown hold across isolates instead of resetting per isolate.

**Ceiling:** arbitrary-recipient sending needs the Workers Paid plan and a verified sender. Move to a
queue if OTP volume ever competes with request CPU.
