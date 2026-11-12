/**
 * Item type and platform names are not topics. Models tend to answer "bookmark"
 * or "notion" when asked for tags; adapters often seed the source as a tag.
 *
 * Kept import-free so the browser bundle does not pull `schemas` (zod) in.
 * Mirror `KINDS` / `SOURCES` from ./schemas.ts when those change.
 */
const NOT_TOPICS = new Set<string>([
  // kinds
  "bookmark",
  "note",
  "highlight",
  "file",
  // sources
  "web",
  "browser",
  "notion",
  "x",
  "raindrop",
  "github",
  "readwise",
  "obsidian",
  "mcp",
  // plurals and near-synonyms of the above
  "bookmarks",
  "notes",
  "highlights",
  "files",
  "gist",
  "gists",
  "link",
  "links",
  "url",
  "urls",
]);

/** Lowercase, dedupe and drop type/source words from generated tags. */
export function cleanGeneratedTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.toLowerCase().trim();
    if (!tag || tag.length > 40 || NOT_TOPICS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === 6) break;
  }
  return out;
}
