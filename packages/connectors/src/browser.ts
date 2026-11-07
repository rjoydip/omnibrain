import type { ConnectorItem } from "./types";

export interface ParsedBookmark extends ConnectorItem {
  folder: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function attrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of input.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    out[(m[1] ?? "").toLowerCase()] = decodeEntities(m[2] ?? "");
  }
  return out;
}

function cleanTitle(input: string): string {
  return decodeEntities(input.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Netscape bookmark export parser (Chrome, Edge, Firefox, Safari). Folder names
 * become tags. No DOM dependency so it runs in the worker and the browser.
 */
export function parseBookmarksHtml(html: string): ParsedBookmark[] {
  const out: ParsedBookmark[] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  let pendingFolder: string | null = null;

  const token = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi;

  for (const m of html.matchAll(token)) {
    const whole = m[0].toLowerCase();
    if (whole.startsWith("<h3")) {
      pendingFolder = cleanTitle(m[1] ?? "");
      continue;
    }
    if (whole.startsWith("<dl")) {
      stack.push(pendingFolder ?? "");
      pendingFolder = null;
      continue;
    }
    if (whole.startsWith("</dl")) {
      stack.pop();
      continue;
    }

    const a = attrs(m[2] ?? "");
    const href = a.href?.trim();
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    let title = cleanTitle(m[3] ?? "");
    if (!title) {
      try {
        title = new URL(href).hostname;
      } catch {
        title = href;
      }
    }

    const addDate = Number(a.add_date);
    const folder = stack.filter(Boolean).slice(-2).join(" / ");

    out.push({
      externalId: href,
      kind: "bookmark",
      url: href,
      title: title.slice(0, 500),
      tags: stack.filter(Boolean).slice(-3),
      folder,
      capturedAt: Number.isFinite(addDate) && addDate > 0 ? addDate * 1000 : undefined,
    });
  }
  return out;
}
