import { sha256Hex } from "@omnibrain/core";
import type { ItemInput, ScopedRepo } from "@omnibrain/db";
import { canonicalizeUrl } from "@omnibrain/search";

export interface RawItem {
  url?: string;
  title?: string;
  note?: string;
  tags?: string[];
  source?: string;
  kind?: "bookmark" | "note" | "highlight" | "file";
  captured_at?: number;
  connection_id?: string;
  external_id?: string;
}

export async function buildItemInput(raw: RawItem): Promise<ItemInput> {
  const canonicalUrl = raw.url ? canonicalizeUrl(raw.url) : null;
  const fallbackTitle = raw.url
    ? (() => {
        try {
          return new URL(raw.url).hostname;
        } catch {
          return raw.url;
        }
      })()
    : raw.note?.trim().split("\n")[0]?.slice(0, 120);
  const title = raw.title?.trim() || fallbackTitle || "Untitled";
  const contentHash = await sha256Hex(
    canonicalUrl ?? `${title}:${raw.note ?? ""}:${raw.url ?? ""}`,
  );
  return {
    kind: raw.kind ?? "bookmark",
    source: raw.source ?? "web",
    connectionId: raw.connection_id ?? null,
    externalId: raw.external_id ?? null,
    url: raw.url ?? null,
    canonicalUrl,
    title,
    excerpt: raw.note?.slice(0, 2000) ?? null,
    tags: raw.tags ?? [],
    capturedAt: raw.captured_at,
    contentHash,
  };
}

export async function createItemFromRaw(
  repo: ScopedRepo,
  raw: RawItem,
): Promise<{ item: Awaited<ReturnType<ScopedRepo["createItem"]>>["item"]; created: boolean }> {
  return repo.createItem(await buildItemInput(raw));
}
