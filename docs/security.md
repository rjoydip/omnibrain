# Security

## Trust boundaries

| Boundary             | Untrusted input                                  |
| -------------------- | ------------------------------------------------ |
| Browser → API        | Cookies, JSON, workspace header, OAuth callbacks |
| API → provider       | OAuth tokens, provider JSON, rate-limit headers  |
| API → arbitrary URL  | Fetched HTML and redirects (SSRF)                |
| Provider/import → AI | Extracted text (prompt injection)                |
| MCP client → API     | Bearer key, JSON-RPC arguments                   |

Every boundary has an explicit check. Anything crossing one is validated with Zod, a role check, a
tenant check, or all three.

## Authentication and sessions

- OTP codes are six digits, expire in 10 minutes, are stored as `sha256(AUTH_SECRET:email:code)`, and
  lock after five wrong attempts. Requests are rate-limited per IP and email.
- Session tokens are 256-bit random values. Only `sha256(token)` is stored in D1; the cookie holds
  the raw value with `HttpOnly`, `SameSite=Lax` (dev) / `SameSite=None; Secure` (cross-site HTTPS),
  and a 30-day expiry.
- Logout deletes the session row. Expired sessions are cleaned on the scheduled handler.
- Roles: owner/admin manage billing, connections, keys and members; members write items; viewers are
  read-only. Every mutating route calls `requireRole`.
- Workspace access is checked on every protected request; `x-workspace-id` must match a membership.

## Tenant isolation

- `forWorkspace(workspaceId)` is the only app-facing data API. Queries include `workspace_id`.
- Vectorize queries pass both the namespace and a metadata filter.
- R2 keys are prefixed with `ws/<workspaceId>/`.
- MCP keys are bound to one workspace.
- The canary test in `packages/db/src/repo.test.ts` is a required check: item text is invisible to a
  second workspace through list, get, count and FTS.

## Connector token storage

Tokens are JSON encrypted with AES-GCM-256:

```
v1:<base64 iv>:<base64 ciphertext>
```

The key is `sha256(TOKEN_KEY ?? AUTH_SECRET)`. The ciphertext is never returned by the API, never
included in exports, and never logged. `connections.secret_ciphertext` is only decrypted inside
`syncConnection` or the OAuth callback. Rotation: change `TOKEN_KEY`, then re-encrypt on the next
sync or reconnect; old tokens remain decryptable while the previous key is available.

## SSRF

`assertFetchable()` rejects non-HTTP(S) schemes, credentials in the URL, and private/link-local/
metadata hosts (IPv4 private ranges, CGNAT, loopback, `169.254.169.254`, IPv6 loopback/ULA/
link-local, `.local`, `.internal`). Redirects are followed manually, re-validated at each hop (max
3), with a 10 s timeout, 5 MB cap, content-type allowlist, and a global/per-host concurrency limit.

Residual risk: hostname DNS rebinding cannot be fully checked from a Worker without a resolver.
Cloudflare's egress blocks private destinations; the app also validates every redirect. If this
becomes a hard requirement, move fetching behind a dedicated resolver or a fetch proxy.

Extracted HTML is stripped and never rendered raw. The UI displays plain text only.

## Prompt injection

Fetched/imported text is untrusted **data**, never instructions:

- Prompts wrap it in `<content>` / `<sources>` delimiters and explicitly say not to follow
  instructions inside.
- Summary output is parsed as JSON and validated; model output is never executed.
- The model cannot call tools. Tool calls only happen from MCP clients with their own key and quota.
- Answers must cite source items; the UI shows provenance and separates AI text from the user's.

## MCP security

- Bearer keys are `ob_` + 24 random bytes, stored as SHA-256, shown once.
- Keys are workspace-scoped, revocable, and metered per plan/day.
- Tools never expose vectors, R2 keys, tokens, or other workspaces.
- Responses are capped (64 KB) and search limits are capped at 20.
- There is no bulk-delete or admin tool.

## Abuse controls

- Per-IP/per-user fixed windows for OTP, verify, search and MCP.
- Plan entitlements checked with the same pure function on client and server.
- Enrichment skips unchanged content hashes and caps extracted text/pages.
- Account deletion and disconnect both delete vectors in batches.

Limits are per-isolate today; Durable Object counters are the planned durable path (see
DECISIONS §8).

## Data lifecycle

- Soft delete keeps items for 30 days, then the scheduled purge deletes rows, chunks and vectors.
- Export (`GET /account/export`) contains items, tags, connections (without secrets) and workspace
  metadata.
- Account deletion removes owned workspaces, items, connections, sessions, usage, audit rows and
  vectors. Other members' memberships are removed.
- No customer data is sent to a third party except the configured email provider and Cloudflare
  services. AI inference runs on Workers AI.

## Logging

- Logs include request id, route, status, duration and workspace id.
- Dev mode prints OTPs to the local terminal and returns them only to the dev UI; production never
  returns a code and only sends it by email. Do not run the dev server in production.
- Audit log records auth, role changes, connection install/revoke, key changes, exports, deletes and
  billing changes.

## Reporting

Email `security@omnibrain.ai` with steps to reproduce. Do not open a public issue for a
vulnerability. We aim to acknowledge within 48 hours.

## PR checklist

- [ ] New query goes through `forWorkspace()` and has a cross-tenant test.
- [ ] New mutation calls `requireRole` and writes an audit entry.
- [ ] New external fetch uses `assertFetchable` and timeouts.
- [ ] New secret is encrypted, redacted from responses/logs, and absent from exports.
- [ ] New MCP tool is workspace-scoped, capped and metered.
- [ ] No token, cookie, OTP, or private hostname in tests or docs.
