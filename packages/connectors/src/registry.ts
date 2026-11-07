import type { ConnectorManifest, ListResult } from "./types";

export const APP_CATALOG: ConnectorManifest[] = [
  {
    id: "browser",
    name: "Browser bookmarks",
    category: "Import",
    description:
      "Chrome, Edge, Firefox and Safari exports. Parsed on your device; only the links you import reach the server.",
    status: "ga",
    auth: "file-import",
    scopes: [],
    capabilities: ["import"],
    glyph: "⌘",
    tone: "amber",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Knowledge hub",
    description: "Pages your integration can access, kept fresh by a 15-minute cursor sync.",
    status: "beta",
    auth: "oauth2",
    scopes: ["read_content"],
    capabilities: ["import", "incremental", "revoke"],
    schedule: "*/15 * * * *",
    glyph: "N",
    tone: "cobalt",
  },
  {
    id: "x",
    name: "X bookmarks",
    category: "Social",
    description:
      "Your saved posts. Requires an X API paid tier; the data archive import works without it.",
    status: "beta",
    auth: "oauth2",
    scopes: ["bookmark.read", "tweet.read", "users.read"],
    capabilities: ["import", "incremental", "revoke"],
    schedule: "*/30 * * * *",
    glyph: "X",
    tone: "coral",
  },
  {
    id: "raindrop",
    name: "Raindrop.io",
    category: "Bookmarks",
    description: "Collections, tags and excerpts synced incrementally.",
    status: "beta",
    auth: "oauth2",
    scopes: ["raindrops:read"],
    capabilities: ["import", "incremental"],
    schedule: "*/30 * * * *",
    glyph: "R",
    tone: "mint",
  },
  {
    id: "keep",
    name: "Google Keep",
    category: "Notes",
    description:
      "Import a Takeout archive. Google has no consumer Keep API, so this is a one-way import, not a live sync.",
    status: "import-only",
    auth: "file-import",
    scopes: [],
    capabilities: ["import"],
    glyph: "K",
    tone: "amber",
  },
];

export function getApp(id: string): ConnectorManifest | undefined {
  return APP_CATALOG.find((a) => a.id === id);
}

export async function syncApp(input: {
  appId: string;
  token: string;
  userId?: string | null;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  switch (input.appId) {
    case "notion": {
      const { listNotionPages } = await import("./notion");
      return listNotionPages({
        token: input.token,
        cursor: input.cursor,
        fetchImpl: input.fetchImpl,
      });
    }
    case "x": {
      if (!input.userId) throw new Error("x user id missing");
      const { listXBookmarks } = await import("./x");
      return listXBookmarks({
        token: input.token,
        userId: input.userId,
        paginationToken: input.cursor,
        fetchImpl: input.fetchImpl,
      });
    }
    case "raindrop": {
      const { listRaindrops } = await import("./raindrop");
      const page = input.cursor ? Number(input.cursor) : 0;
      return listRaindrops({
        token: input.token,
        page: Number.isFinite(page) ? page : 0,
        fetchImpl: input.fetchImpl,
      });
    }
    default:
      throw new Error(`${input.appId} has no live sync; use the import flow`);
  }
}
