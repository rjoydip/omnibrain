# Connectors

A connector is a **first-party adapter plus a manifest**. Installing an app creates a
`connections` row; it does not execute third-party code. That keeps the security surface to OAuth
scopes and server-side fetch, and avoids a Workers-for-Platforms runtime.

## Catalog

| App               | Auth            | Sync        | Status | Notes                                             |
| ----------------- | --------------- | ----------- | ------ | ------------------------------------------------- |
| Browser bookmarks | none            | file import | GA     | Chrome/Edge/Firefox/Safari HTML, parsed on-device |
| Notion            | OAuth 2         | cursor poll | Beta   | Public integration; ~3 req/s                      |
| GitHub            | OAuth 2 / token | page poll   | Beta   | Gists; PAT works without an OAuth app             |

Readwise Reader, Obsidian and Pocket are intentionally absent until their importers exist. Pocket's
service was discontinued in July 2025.

## Connection lifecycle

```sh
available ──install──► authorizing ──callback──► connected
                                      │             │
                                      │             ├─ pause ──► paused ──resume──► connected
                                      │             ├─ sync failure ──► degraded
                                      │             └─ disconnect ──► revoked (row deleted)
                                      └─ state expired/denied ──► available
```

States are stored on `connections.status`. `last_error` is shown in the App Store card, and a
`degraded` connection keeps its items. Disconnect asks whether to delete imported items; default is
keep.

## OAuth setup

The API is the OAuth client. The provider console needs one redirect URI per environment:

```sh
https://<api-host>/api/v1/oauth/<app>/callback
http://localhost:8787/api/v1/oauth/<app>/callback   # local dev
```

`<app>` is the connector id from `packages/connectors/src/registry.ts`, **not** the provider name:

| Provider | App id   | Environment variables                      | Redirect URI suffix |
| -------- | -------- | ------------------------------------------ | ------------------- |
| Notion   | `notion` | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | `/oauth/notion/…`   |
| GitHub   | `github` | `GH_CLIENT_ID`, `GH_CLIENT_SECRET`         | `/oauth/github/…`   |

The callback route is built from `app.id` in `apps/api/src/routes/apps.ts`, so the id and the
provider name must stay in sync when a connector is added.

### Where credentials live

Credentials are resolved per request by `resolveProvider()` in `apps/api/src/services/connectors.ts`.
A DB row wins; environment variables are the fallback.

1. **Environment** (normal path, one-click sign-in). Add the vars to `.env` at the repo root — Bun
   loads it for `bun run dev`. `.env.example` lists every name, commented out. Production values are
   wired through `alchemy.run.ts`.
2. **Database** (API-only fallback). `PUT /api/v1/apps/<app>/credentials` with
   `{ "client_id": "…", "client_secret": "…" }` stores the secret encrypted with `TOKEN_KEY`
   (falling back to `AUTH_SECRET`); `DELETE` on the same path clears it. The App Store shows the
   source as `credential_source: "db" | "env"`.

Restart the dev server after changing `.env` — the vars are read at boot. Secrets are never logged
and never returned by an API; the secret is only decrypted inside the token exchange and
`syncConnection`.

### Notion

1. Open <https://www.notion.so/my-integrations> and create a **new integration**.
2. Choose type **Public** (OAuth), name it, and pick the workspace it belongs to.
3. Under **OAuth Domain & URIs**, add both redirect URIs above.
4. Capabilities: enable **Read content** — that is the `read_content` scope this connector requests.
5. Copy the **OAuth client ID** and **OAuth client secret** from the integration's configuration.
6. Set `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` in `.env` and restart.
7. After connecting, each page or database must be **shared with the integration** in Notion; the
   integration only sees what is explicitly shared.

Exchange uses JSON + Basic auth (not form-encoded), so Notion is handled specially in
`packages/connectors`. The adapter enumerates pages through `POST /v1/search` sorted by last edited
time, then reads each page body from `GET /v1/blocks/{id}/children` and stores it as markdown (up to
two block pages, three requests in flight, one retry on `429`). Search pages are 25 results each so a
single run stays within Worker subrequests. There is no reliable page-content webhook, so sync is a
cursor poll: the 15-minute cron picks up connections whose editable `sync_interval_minutes` has
elapsed (15-minute floor, one page per run).

### GitHub

1. Create an OAuth app at <https://github.com/settings/developers> (optional).
2. Add the redirect URI above.
3. Set `GH_CLIENT_ID` / `GH_CLIENT_SECRET` in the server environment, then restart.

Sign-in is one click once those vars are present: the App Store redirects straight to the
provider. GitHub also accepts a pasted personal access token, so the OAuth app is optional.
`POST /apps/connections` with `{ app_id, token }` verifies the token through
`GET /user`, stores it encrypted, and starts the backfill. The adapter pages
`GET /gists?per_page=100&page=N`; private gists need the `gist` scope.

If a provider is not configured, `POST /apps/connections` returns `connector_not_configured` with
"`<App> OAuth credentials are missing. Add them in the App Store.`" It never fakes an install.

### Verifying a setup

1. `bun run dev` and open the App Store. A configured provider shows a one-click **Install**; a
   missing one fails with `connector_not_configured`.
2. Install → the provider consent screen → back to `/?view=apps&installed=<app>&fetched=…&created=…`.
   The callback runs the first sync (one page, to stay within Worker subrequest limits), so the
   App Store opens with items already imported.
3. Sync again for the rest of the backlog; a non-2xx response flips the connection to `degraded` and
   stores a truncated `last_error` on the card.
4. Common failures: `redirect_uri_mismatch` (the dev SPA proxies with the original Host, so the URI
   is `http://localhost:5173/...` unless the API is called directly — register both), unshared Notion
   pages (connects but imports nothing), or a stale process still holding old env values (restart).

## File imports

### Browser bookmarks

`packages/connectors/src/browser.ts` parses the Netscape format used by Chrome, Edge, Firefox and
Safari. It handles nested `<DL>` folders (folders become tags), decodes entities, reads `ADD_DATE`
(seconds → ms), drops non-HTTP URLs, and dedupes by URL. Parsing runs in the browser, so browsing
history never leaves the machine beyond the items the user imports.

## Adding a connector

1. **Manifest** in `packages/connectors/src/registry.ts`: id, name, category, description, auth,
   scopes, capabilities, schedule, glyph/tone. Add `tokenAuth: true` when a pasted access token is
   an alternative to OAuth. Keep the description honest about limits.
2. **Adapter** (`packages/connectors/src/<app>.ts`): export a `list()` that returns
   `{ items: ConnectorItem[], nextCursor }`. Use the injected `fetchImpl` so tests never hit the
   network.
3. **Wire sync** in `syncApp()` (registry switch). File-only connectors should throw; the UI routes
   them to Import.
4. **OAuth** in `apps/api/src/services/connectors.ts` if the provider uses OAuth: authorization URL,
   token URL, scopes, client env names, and any special token exchange (Notion is JSON + Basic).
5. **Tests**: a fixture-based adapter test for mapping/pagination, plus a manifest test.
6. **Docs**: update this file and the App Store copy. If it cannot sync, say "import only".

Adapter shape:

```ts
export async function listExample(input: {
  token: string;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.example.com/items?cursor=…", {
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (!res.ok) throw new Error(`example ${res.status}`);
  const body = (await res.json()) as { items: Array<{ id: string; title: string }> };
  return {
    items: body.items.map((i) => ({
      externalId: i.id,
      kind: "bookmark",
      title: i.title,
      tags: ["example"],
    })),
    nextCursor: null,
  };
}
```

## Sync semantics

- Tokens are decrypted only inside `syncConnection`, never returned by an API.
- Upserts are idempotent: `(workspace_id, connection_id, external_id)` plus canonical URL dedupe.
- A page where nothing is new stops the loop.
- `maxPages` bounds a single run; the cursor persists for the next run.
- Any non-2xx marks `degraded`, stores a truncated error, and leaves existing items intact.
- Pausing stops scheduled/manual sync but keeps the cursor.
- Disconnecting deletes the connection row; imported items are kept unless `delete_items=1`, in which
  case their vectors are deleted too.

## What not to build

- Arbitrary plugin code. New sources are code contributions, not marketplace uploads.
- Silent "installed" states. If credentials are missing, the UI says so.
