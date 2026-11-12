import type { ConnectorItem, ListResult } from "./types";
import { mapLimited } from "./util";

// Notion public integration (OAuth 2). Poll-based: the search endpoint is the
// only portable way to enumerate pages for a workspace-wide integration.
const NOTION_VERSION = "2022-06-28";
// Each result costs one blocks request, and the OAuth callback syncs once
// before redirecting — keep the page small so a run stays within subrequests.
const PAGE_SIZE = 25;
const MAX_BLOCK_PAGES = 2;
const MAX_TEXT = 10_000;
const CONTENT_CONCURRENCY = 3;

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

interface RichText {
  plain_text?: string;
}

type NotionBlock = { type: string; has_children?: boolean; [key: string]: unknown };

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "notion-version": NOTION_VERSION,
    "content-type": "application/json",
  };
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

function richText(block: NotionBlock): string {
  const payload = block[block.type] as { rich_text?: RichText[] } | undefined;
  return (payload?.rich_text ?? [])
    .map((span) => span.plain_text ?? "")
    .join("")
    .trim();
}

/** One block as markdown. Nested children (toggles, columns) are skipped. */
function blockText(block: NotionBlock): string {
  const text = richText(block);
  if (!text) return "";
  switch (block.type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
    case "numbered_list_item":
      return `- ${text}`;
    case "to_do": {
      const done = (block.to_do as { checked?: boolean } | undefined)?.checked;
      return `- [${done ? "x" : " "}] ${text}`;
    }
    case "quote":
      return `> ${text}`;
    case "code": {
      const lang = (block.code as { language?: string } | undefined)?.language ?? "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    default:
      return text;
  }
}

/** Page body as markdown. Best-effort: a failed block read leaves the page link. */
async function pageText(fetchImpl: typeof fetch, token: string, pageId: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_BLOCK_PAGES; i++) {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    let res = await fetchImpl(url, { headers: headers(token) });
    // Notion allows ~3 req/s; one retry keeps a burst from silently dropping text.
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      res = await fetchImpl(url, { headers: headers(token) });
    }
    if (!res.ok) break;
    const body = (await res.json()) as {
      results?: NotionBlock[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    for (const block of body.results ?? []) {
      const line = blockText(block);
      if (line) lines.push(line);
    }
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return lines.join("\n\n").slice(0, MAX_TEXT);
}

export async function listNotionPages(input: {
  token: string;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.notion.com/v1/search", {
    method: "POST",
    headers: headers(input.token),
    body: JSON.stringify({
      page_size: PAGE_SIZE,
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

  const pages = body.results ?? [];
  const texts = await mapLimited(pages, CONTENT_CONCURRENCY, (page) =>
    pageText(fetchImpl, input.token, page.id),
  );

  const items: ConnectorItem[] = pages.map((page, index) => {
    const text = texts[index] ?? "";
    return {
      externalId: page.id,
      kind: "note",
      url: page.url,
      title: pageTitle(page).slice(0, 500),
      note: text || undefined,
      lang: text ? "markdown" : undefined,
      capturedAt: page.last_edited_time ? Date.parse(page.last_edited_time) : undefined,
      tags: [],
    };
  });

  return { items, nextCursor: body.has_more ? (body.next_cursor ?? null) : null };
}
