# Operations

## Environment variables

| Variable                    | Required      | Purpose                                                     |
| --------------------------- | ------------- | ----------------------------------------------------------- |
| `AUTH_SECRET`               | yes           | OTP pepper + session/signing fallback; 32+ random chars     |
| `TOKEN_KEY`                 | recommended   | AES-GCM key for connector tokens; defaults to `AUTH_SECRET` |
| `APP_ORIGIN`                | yes (prod)    | Web origin for CORS, cookies, OAuth redirects               |
| `NOTION_CLIENT_ID/SECRET`   | optional      | OAuth app; prefer App Store → credentials                   |
| `X_CLIENT_ID/SECRET`        | optional      | OAuth app; prefer App Store → credentials                   |
| `RAINDROP_CLIENT_ID/SECRET` | optional      | OAuth app; prefer App Store → credentials                   |
| `EMAIL_FROM`                | recommended   | Verified sender for Cloudflare Email Service                |
| `EMAIL` (binding)           | yes in prod   | `send_email` binding provisioned by `alchemy.run.ts`        |
| `DEV_MODE`                  | never in prod | Returns the OTP to the dev UI; dev server sets it           |

Generate secrets with `openssl rand -base64 32` or `bun -e 'console.log(crypto.randomUUID())'`
(repeat/cat for length).

## First deploy

1. Authenticate Alchemy once:

   ```bash
   bun alchemy profile edit --add Cloudflare
   ```

2. Copy `.env.example` to `.env` and fill production values. `AUTH_SECRET` is mandatory;
   `alchemy.run.ts` refuses to plan without it. Verify the `EMAIL_FROM` sender domain/address in
   Cloudflare Email Service (Email Sending requires the Workers Paid plan).
3. Deploy:

   ```bash
   APP_ORIGIN=https://app.example.com bun alchemy deploy --stage prod
   ```

   Alchemy provisions D1 (applies `packages/db/migrations`), R2, the Vectorize index (1024 dims,
   cosine), the API Worker and the Vite site.

4. Verify:
   - `GET https://<api>/health` returns `{ ok: true }`.
   - Sign in via OTP; `/api/v1/account` returns the demo workspace.
   - Confirm the OTP email arrives through Cloudflare Email Service and `EMAIL_FROM` is a verified
     sender. A missing `EMAIL` binding returns `503 email_not_configured`.
   - Capture a URL; confirm `embedding_state` moves from `pending` to `ready` (or `skipped` without
     AI/Vectorize bindings).
   - Confirm the native `VECTORS` binding inserts and queries one test vector. If Alchemy binds the
     index resource differently than expected, inspect the Worker bindings and switch to
     `Cloudflare.Vectorize.SearchIndex` — this is the one deployment detail to validate on the first
     real deploy.
   - Run one MCP `initialize` + `tools/call search` with a created key.

5. Register redirect URIs with each provider:
   `https://<api>/api/v1/oauth/<notion|x|raindrop>/callback`.

## No preview Worker

There is no PR preview deployment. CI runs format, typecheck, lint, tests and the web build. Prod
deploys on a `v*` tag through `.github/workflows/deploy.yml`. Preview-specific stages, URLs and
workflows were removed deliberately.

## Migrations

- Migrations live in `packages/db/migrations`, numbered and applied by Alchemy on deploy.
- Only add files; never edit an applied migration.
- Deploy order for destructive changes: expand (add nullable columns/tables) → backfill → code
  switch → contract in a later release.
- D1 has no transactions over HTTP; Alchemy applies each migration as one batched query.

## Rollback

Alchemy is declarative. To roll back:

1. Redeploy the previous git tag: `git checkout v1.2.0 && bun alchemy deploy --stage prod`.
2. Do not revert a migration in the same release. Data written by the newer code must remain
   readable.
3. If a bad migration removed data, restore from the D1 export (below) into a new database and
   repoint the binding.

## Backups and restore

- Schedule `wrangler d1 export` (or the D1 HTTP export API) daily to an R2 bucket in another account.
- R2 snapshots are reproducible from source URLs but not guaranteed; include the bucket in backup
  policy if retention matters.
- Vectorize is derived data. Rebuild by re-embedding items from R2/D1 (`embedding_state = 'pending'`
  - retry job) rather than backing up vectors.
- Test restore quarterly: import into a scratch D1, run `bun test` against a copy, verify item count
  and one search per source.

## Cleanup

`worker.ts` exposes a `scheduled` handler that:

- deletes expired sessions and cache rows;
- purges trashed items older than 30 days and their vector ids.

A cron trigger is **not bound** in `alchemy.run.ts` yet. Until it is, either bind a Cron Trigger in
Alchemy or run the cleanup manually from a one-off Worker invocation. Do not let trash grow
unbounded.

## Monitoring

Not wired yet, but the intended stack:

- Workers Logs → Axiom for structured request logs (request id, workspace, status, duration).
- Sentry for Worker/web exceptions.
- Analytics Engine for `capture`, `search`, `install`, `answer_clicked`, `mcp_call`.
- Alerts: 5xx > 1% for 5 min, DLQ depth > 100, connector sync failure > 5%, Stripe webhook failures,
  D1 size > 70% of limit, Vectorize query p95 > 500 ms, zero-result search rate > 30%.

## Runbooks

### Connector shows "Needs reconnect"

1. Inspect `connections.status` and `last_error` for that workspace.
2. Confirm the provider app credentials and redirect URI.
3. Ask the user to reconnect; the old token is replaced, items are kept.
4. If the provider revoked the app, disconnect and reinstall.

### Queue backlog / DLQ

1. Check consumer errors; most are fetch failures or provider 429s.
2. Fix root cause, then re-drive messages (Cloudflare dashboard or a one-off script).
3. Items remain searchable lexically with `embedding_state = 'failed'`; "Re-enrich" retries one item.

### Suspected token leak

1. Rotate `TOKEN_KEY` (and `AUTH_SECRET` if implicated); redeploy.
2. Revoke all connections and API keys for the affected workspace.
3. Users reconnect. Audit `connection.install`, `apikey.*`, and login events.
4. Review logs for the ciphertext/secret pattern; there should be none.

### Search quality regression

1. Check `meta.mode` — a drop to `lexical` means AI/Vectorize bindings are missing.
2. Check `items_fts` row count vs `items`; re-run the FTS triggers only if corrupted.
3. Sample 20 queries; log zero-result and clicked results. Tune RRF/recency only with data.

### D1 near size limit

1. Purge trash and old `query_cache`.
2. Move long excerpts to R2 only (already the default beyond 2 KB).
3. Add a retention policy for imports/audit logs; export before deleting.

## Cost guardrails

- Enrichment is skipped for unchanged content hashes.
- Answers are capped by plan; embeddings batch in 20s.
- Text is capped at 256 KB in R2 and 100 KB for extraction.
- Watch per-workspace enrichment counts (`usage_daily`) before enabling paid tiers.
