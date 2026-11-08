# HTTP and MCP API

Base URL: `/api/v1` (MCP at `/mcp`). All payloads are JSON. Auth is the `ob_session` HttpOnly
cookie set by `POST /auth/verify`. Workspace-scoped routes accept `x-workspace-id`; without it the
user's first workspace is used, and a workspace the user is not a member of returns 403.

## Errors

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Free plan limit reached (500)",
    "requestId": "0f2c…",
    "details": {}
  }
}
```

| Code                       | Status | Meaning                                                       |
| -------------------------- | ------ | ------------------------------------------------------------- |
| `bad_request`              | 400    | Validation failed or unsafe request                           |
| `unauthorized`             | 401    | No/invalid session or OTP                                     |
| `forbidden`                | 403    | Role or workspace membership denied, or cross-origin mutation |
| `not_found`                | 404    | Missing item/connection/import                                |
| `conflict`                 | 409    | Import already finished                                       |
| `rate_limited`             | 429    | Per-IP/user/window limit                                      |
| `quota_exceeded`           | 402    | Plan entitlement exhausted                                    |
| `connector_not_configured` | 400    | OAuth client credentials missing                              |
| `internal`                 | 500    | Unexpected failure; details are logged, not returned          |

Every response includes `x-request-id` (also in errors).

## Auth

### `POST /auth/request-otp`

```json
{ "email": "demo@omnibrain.local" }
```

Development (`DEV_MODE=1`, the Bun dev server) returns the six-digit code directly and does not
send email:

```json
{
  "sent": true,
  "delivered": false,
  "email_configured": false,
  "expires_at": 1762363200000,
  "dev_code": "123456"
}
```

Production always emails the code through Resend and never returns `dev_code`. If `RESEND_KEY` is
missing the request fails with `503 email_not_configured`; a provider failure returns
`502 email_failed`.

Codes expire in 10 minutes and lock after 5 wrong attempts. Rate limit: 5 requests per email per 10
minutes (50 in dev).

### `POST /auth/verify`

```json
{ "email": "demo@omnibrain.local", "code": "123456" }
```

Sets the session cookie. Returns `{ user, workspace, expires_at }`. Sessions last 30 days; the raw
token is never stored.

### `GET /auth/me`

Returns `{ user, workspace, workspaces }` for the current cookie. 401 without a valid session.

### `POST /auth/logout`

Deletes the session row and clears the cookie.

## Items

| Method | Path                   | Notes                                                                |
| ------ | ---------------------- | -------------------------------------------------------------------- |
| GET    | `/items`               | `?limit=1..100&cursor=&source=&kind=&status=active\|archived\|trash` |
| POST   | `/items`               | Create/capture; body below                                           |
| POST   | `/items/batch`         | Up to 500 import items; optional `import_id`                         |
| GET    | `/items/:id`           | One item                                                             |
| PATCH  | `/items/:id`           | `title`, `summary`, `note`, `tags`                                   |
| DELETE | `/items/:id`           | Soft delete; purged after 30 days                                    |
| DELETE | `/items/:id/permanent` | Permanently delete a trashed item and its vectors                    |
| POST   | `/items/:id/archive`   | Hide from the active stream                                          |
| POST   | `/items/:id/unarchive` | Return to the active stream                                          |
| POST   | `/items/:id/restore`   | Restore from trash                                                   |
| GET    | `/items/:id/related`   | Graph neighbours: `?limit=1..12` (link, tag, semantic)               |
| POST   | `/items/:id/retry`     | Re-run enrichment                                                    |
| GET    | `/items/:id/content`   | R2 text, else excerpt, as `text/plain`                               |

Create:

```json
{
  "url": "https://developers.cloudflare.com/vectorize/",
  "title": "Vectorize notes",
  "note": "Namespaces isolate tenants.",
  "tags": ["cloudflare", "vector"],
  "kind": "bookmark",
  "source": "web",
  "enrich": true
}
```

`url` or `title`/`note` is required. `enrich` defaults to true. Duplicate canonical URLs return the
existing item with `created: false`. Members and above can write; viewers cannot.

Batch:

```json
{
  "items": [
    { "url": "https://a.example", "title": "A", "source": "browser" },
    { "title": "A note", "note": "Body", "kind": "note", "source": "keep" }
  ],
  "import_id": "imp_…"
}
```

Response: `{ created, duplicates, invalid, blocked, accepted, quota }`.

## Search

### `POST /search`

```json
{ "query": "what did I save about vector search?", "limit": 10, "answer": true }
```

Response:

```json
{
  "query": "…",
  "results": [
    {
      "id": "itm_…",
      "title": "Cloudflare Vectorize: architecture notes",
      "url": "https://…",
      "summary": "…",
      "excerpt": "…",
      "source": "web",
      "captured_at": 1762000000000,
      "score": 0.0325,
      "matched": "both"
    }
  ],
  "answer": "…[1]…",
  "meta": { "lexical": 4, "semantic": 4, "tookMs": 18, "mode": "hybrid" }
}
```

`matched` is `lexical`, `semantic`, `both`, or `recent`. Without AI + Vectorize bindings the mode is
`lexical`. `answer` is null unless requested and an instruct model is bound. Search is limited to
120 requests/minute per user.

## App Store and connections

| Method | Path                                   | Notes                                        |
| ------ | -------------------------------------- | -------------------------------------------- |
| GET    | `/apps`                                | Catalog + installation state + `configured`  |
| GET    | `/apps/connections`                    | Safe connection rows (never tokens)          |
| POST   | `/apps/connections`                    | `{ app_id }` → `{ authorize_url }` for OAuth |
| POST   | `/apps/connections/:id/sync`           | Sync now (max 3 pages); returns counts       |
| POST   | `/apps/connections/:id/pause`          | Stop syncing                                 |
| POST   | `/apps/connections/:id/resume`         | Resume syncing                               |
| DELETE | `/apps/connections/:id?delete_items=1` | Disconnect; optionally purge items + vectors |

Install requires owner/admin. File-import apps return `bad_request` with `use_import`; use the import
flow. OAuth apps without client credentials return `connector_not_configured`.

OAuth callback (public, state-bound): `GET /oauth/:app/callback`.

## Imports

| Method | Path                   | Notes                                                         |
| ------ | ---------------------- | ------------------------------------------------------------- |
| GET    | `/imports`             | Last 20 imports                                               |
| POST   | `/imports`             | `{ "kind": "browser_html" \| "keep_takeout", "total": 1200 }` |
| POST   | `/imports/:id/batches` | `{ "items": [...] }` up to 500                                |
| GET    | `/imports/:id`         | Progress                                                      |
| POST   | `/imports/:id/finish`  | `{ "status": "done" \| "failed", "error"?: "…" }`             |

Parsing happens in the browser; only extracted items are sent. Re-import is idempotent by canonical
URL.

## API keys

| Method | Path               | Notes                                                        |
| ------ | ------------------ | ------------------------------------------------------------ |
| GET    | `/keys`            | Prefix, name, last use; never the secret                     |
| POST   | `/keys`            | `{ "name": "Claude Desktop" }` → `{ key, apiKey }` once      |
| GET    | `/keys/:id/events` | Last 50 MCP client events for this key (connect/tool/errors) |
| DELETE | `/keys/:id`        | Revoke immediately                                           |

New workspaces start with **zero** keys. The UI starts with an empty name field and requires a name.
Every MCP request records an event row (`connect`, `tools_list`, `tool_call`, `error`) with client
name/version, tool, status and duration. No tool arguments or item content are logged.

## Account

| Method | Path          | Notes                                                           |
| ------ | ------------- | --------------------------------------------------------------- |
| GET    | `/account`    | User, workspace, role, usage, entitlements                      |
| GET    | `/workspaces` | Workspaces for the current user                                 |
| GET    | `/plan`       | Plan + quota buckets                                            |
| GET    | `/export`     | JSON attachment; connections exclude secrets                    |
| DELETE | `/account`    | Owner only; deletes owned workspaces, rows, vectors, audit rows |

## Health

`GET /health` → `{ ok: true, name: "omnibrain-api", version, time }`. No auth.

## MCP

`POST /mcp` with `Authorization: Bearer ob_…` and JSON-RPC 2.0. `GET /mcp` returns 405; the transport
is Streamable HTTP POST (JSON response, no SSE stream yet).

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "clientInfo": { "name": "Claude Desktop", "version": "1.2.0" } }
}
```

Tools use an `omnibrain_` namespace:

| Tool                  | Arguments                                    | Result                |
| --------------------- | -------------------------------------------- | --------------------- |
| `omnibrain_search`    | `query`, `limit` (1–20), `source?`, `since?` | Ranked items          |
| `omnibrain_fetch`     | `id`                                         | Full text (max 60 KB) |
| `omnibrain_recent`    | `limit` (1–20)                               | Latest captures       |
| `omnibrain_save_note` | `text`, `url?`, `tags?`                      | New item id           |
| `omnibrain_related`   | `id`, `limit?` (1–12)                        | Related items         |

Calls are metered per plan (`mcpCallsDay`) and every key use updates `last_used_at`. Responses are
capped at 64 KB; tool errors are returned as `isError: true`, not JSON-RPC failures. Each request is
logged as an event visible under the key in the MCP screen and via `GET /keys/:id/events`.

## Rate limits

| Surface     | Limit                                    |
| ----------- | ---------------------------------------- |
| OTP request | 5/email and 10/IP per 10 min (50 in dev) |
| OTP verify  | 20/IP per 10 min                         |
| Search      | 120/user/min                             |
| MCP         | plan daily quota                         |

Per-isolate windows today; Durable Objects are the planned durable implementation.
