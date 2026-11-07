import type { ConnectorItem, ListResult } from "./types";

// Notion public integration (OAuth 2). Poll-based: the search endpoint is the
// only portable way to enumerate pages for a workspace-wide integration.
const NOTION_VERSION = "2022-06-28";

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

function pageTitle(page: NotionPage): string {
  for (const value of Object.values(page.properties ?? {})) {
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const text = prop.title
        .map((t) => t.plain_text ?? "")
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return "Untitled Notion page";
}

export async function listNotionPages(input: {
  token: string;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      page_size: 100,
      start_cursor: input.cursor ?? undefined,
      sort: { direction: "descending", timestamp: "last_edited_time" },
      filter: { property: "object", value: "page" },
    }),
  });
  if (!res.ok) throw new Error(`notion ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    results?: NotionPage[];
    next_cursor?: string | null;
    has_more?: boolean;
  };

  const items: ConnectorItem[] = (body.results ?? []).map((page) => ({
    externalId: page.id,
    kind: "bookmark",
    url: page.url,
    title: pageTitle(page).slice(0, 500),
    capturedAt: page.last_edited_time ? Date.parse(page.last_edited_time) : undefined,
    tags: ["notion"],
  }));

  return { items, nextCursor: body.has_more ? (body.next_cursor ?? null) : null };
}
