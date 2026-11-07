import { type AiBinding, chunkText, embedTexts, summarize } from "@omnibrain/ai";
import { forWorkspace, type ItemRow } from "@omnibrain/db";
import { dbOf, type Env } from "../env";

const MAX_BYTES = 5 * 1024 * 1024;

/** Best-effort SSRF guard. DNS rebinding is neutralised by Cloudflare's egress; see PLAN §6. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
  }

  if (
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host.startsWith("::ffff:127.") ||
    host.startsWith("::ffff:10.")
  ) {
    return true;
  }
  return false;
}

export function assertFetchable(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http(s) URLs can be fetched");
  }
  if (url.username || url.password) throw new Error("credentials in URL are not allowed");
  if (isBlockedHost(url.hostname)) throw new Error("private host blocked");
  return url;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#x") || e.startsWith("#X")) {
      const n = Number.parseInt(e.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (e.startsWith("#")) {
      const n = Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/**
 * Regex readability, not a browser engine: good enough for summaries.
 * ponytail: swap to Readability once extraction quality is the complaint.
 */
export function extractReadable(html: string): {
  title: string;
  description: string;
  text: string;
} {
  const title = decode(
    html
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ?? "",
  );
  const description = decode(
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ??
      "",
  );
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, 100_000);
  return { title, description, text };
}

export async function fetchReadable(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ title: string; description: string; text: string; finalUrl: string } | null> {
  let current = assertFetchable(input);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchImpl(current, {
      redirect: "manual",
      headers: {
        "user-agent": "OmniBrainBot/1.0 (+https://omnibrain.ai/bot)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      current = assertFetchable(new URL(location, current).toString());
      continue;
    }
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;
    const html = (await res.text()).slice(0, MAX_BYTES);
    const extracted = extractReadable(html);
    return { ...extracted, finalUrl: current.toString() };
  }
  return null;
}

export interface EnrichResult {
  ok: boolean;
  reason?: string;
}

/** Fetch, summarize, chunk, embed and persist one item. Idempotent on content hash. */
export async function enrichItem(
  env: Env,
  workspaceId: string,
  itemId: string,
): Promise<EnrichResult> {
  const db = dbOf(env);
  const repo = forWorkspace(db, workspaceId);
  const item = await repo.getItem(itemId);
  if (!item) return { ok: false, reason: "missing" };
  if (!item.url) {
    await repo.updateItem(itemId, { embeddingState: "skipped" });
    return { ok: true };
  }

  try {
    const page = await fetchReadable(item.url);
    if (!page) {
      await repo.updateItem(itemId, { embeddingState: "failed" });
      return { ok: false, reason: "fetch" };
    }
    const text = page.text.length > 200 ? page.text : (item.excerpt ?? item.title);

    const ai = env.AI as unknown as AiBinding | undefined;
    const summary = ai
      ? await summarize(ai, text)
      : { summary: text.slice(0, 240).replace(/\s+/g, " "), tags: [] as string[] };

    let contentR2Key: string | undefined;
    if (env.BLOBS) {
      contentR2Key = `ws/${workspaceId}/items/${itemId}.md`;
      await env.BLOBS.put(contentR2Key, text, { httpMetadata: { contentType: "text/markdown" } });
    }

    let embeddingState: ItemRow["embedding_state"] = "skipped";
    if (ai && env.VECTORS) {
      const chunks = chunkText(text);
      const vectors = await embedTexts(ai, chunks);
      const ids = chunks.map((_, i) => `${itemId}:${i}`);
      const old = await repo.replaceChunks(
        itemId,
        ids.map((vectorId, i) => ({
          vectorId,
          tokenCount: Math.ceil((chunks[i]?.length ?? 0) / 4),
        })),
      );
      if (old.length) await env.VECTORS.deleteByIds(old);
      await env.VECTORS.upsert(
        vectors.map((values, i) => ({
          id: ids[i] ?? `${itemId}:${i}`,
          values,
          namespace: workspaceId,
          metadata: {
            workspaceId,
            itemId,
            chunk: i,
            source: item.source,
            capturedAt: item.captured_at,
          },
        })),
      );
      embeddingState = "ready";
    }

    await repo.updateItem(itemId, {
      summary: summary.summary,
      excerpt: text.slice(0, 2000),
      tags: summary.tags.length ? summary.tags : undefined,
      contentR2Key,
      embeddingState,
    });
    return { ok: true };
  } catch (error) {
    await repo.updateItem(itemId, { embeddingState: "failed" }).catch(() => {});
    console.error("enrich failed", { itemId, error: String(error) });
    throw error;
  }
}

export function enrichInBackground(env: Env, workspaceId: string, itemId: string) {
  return enrichItem(env, workspaceId, itemId).catch(() => undefined);
}
