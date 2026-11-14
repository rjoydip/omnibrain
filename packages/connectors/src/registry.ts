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
    description:
      "Pages your integration can access, synced incrementally. Connect with OAuth or paste an internal integration token.",
    status: "beta",
    auth: "oauth2",
    tokenAuth: true,
    scopes: ["read_content"],
    capabilities: ["import", "incremental", "revoke"],
    schedule: "*/15 * * * *",
    glyph: "N",
    tone: "cobalt",
  },
  {
    id: "github",
    name: "GitHub",
    category: "Developer",
    description:
      "Import your gists, synced incrementally. Connect with OAuth or paste a personal access token.",
    status: "beta",
    auth: "oauth2",
    tokenAuth: true,
    scopes: ["gist"],
    capabilities: ["import", "incremental", "revoke"],
    schedule: "*/30 * * * *",
    glyph: "GH",
    tone: "muted",
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
    case "github": {
      const { listGithubGists } = await import("./github");
      return listGithubGists({
        token: input.token,
        cursor: input.cursor,
        fetchImpl: input.fetchImpl,
      });
    }
    default:
      throw new Error(`${input.appId} has no live sync; use the import flow`);
  }
}
