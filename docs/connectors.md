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
| Google Keep       | OAuth 2         | cursor poll | Beta   | Keep API requires a Google Workspace account      |

Readwise Reader, Obsidian and Pocket are intentionally absent until their importers exist. Pocket's
service was discontinued in July 2025.

## Connection lifecycle

```
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

The API is the OAuth client. Redirect URI for all providers:

```
https://<api-host>/api/v1/oauth/<app>/callback
```

Local: `http://localhost:8787/api/v1/oauth/<app>/callback`.

### Notion

1. Create a public integration at <https://www.notion.so/my-integrations>.
2. Add the redirect URI above.
3. Set `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` in the server environment, then restart.
4. Requested scope: `read_content` (the integration also needs pages shared with it in Notion).

Exchange uses JSON + Basic auth; the adapter enumerates pages through `POST /v1/search` sorted by
last edited time. There is no reliable page-content webhook, so sync is a 15-minute cursor poll.

### Google Keep

1. Create an OAuth client (Web application) in Google Cloud Console.
2. Enable the Google Keep API for the project and add the redirect URI above.
3. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the server environment, then restart.

Requested scope is `https://www.googleapis.com/auth/keep.readonly`. The adapter pages
`GET /v1/notes?pageSize=100&pageToken=…`; the Keep API is only available to Google Workspace
accounts, so personal Gmail accounts cannot connect.

### GitHub

1. Create an OAuth app at <https://github.com/settings/developers> (optional).
2. Add the redirect URI above.
3. Set `GH_CLIENT_ID` / `GH_CLIENT_SECRET` in the server environment, then restart.

Sign-in is one click once those vars are present: the App Store redirects straight to the
provider. GitHub also accepts a pasted personal access token, so the OAuth app is optional.
`POST /apps/connections` with `{ app_id, token }` verifies the token through
`GET /user`, stores it encrypted, and starts the backfill. The adapter pages
`GET /gists?per_page=100&page=N`; private gists need the `gist` scope.

If a provider is not configured, `POST /apps/connections` returns `connector_not_configured` and the
UI explains which environment variable is missing. It never fakes an install.

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
