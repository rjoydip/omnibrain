import type { ItemEdgeKind, RelatedItemRow } from "@omnibrain/db";
import { forWorkspace } from "@omnibrain/db";
import { canonicalizeUrl } from "@omnibrain/search";
import { dbOf, type Env } from "../env";

const MAX_EDGES = 8;

const PRIORITY: Record<ItemEdgeKind, number> = { link: 3, semantic: 2, tag: 1 };

function linkUrls(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const url = canonicalizeUrl(match[1] ?? "");
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Recompute the undirected graph edges for one item from explicit links,
 * shared tags, and semantic neighbours (when Vectorize is configured).
 * Cheap and bounded: at most MAX_EDGES outgoing relations.
 */
export async function refreshItemEdges(
  env: Env,
  workspaceId: string,
  itemId: string,
): Promise<void> {
  const repo = forWorkspace(dbOf(env), workspaceId);
  const item = await repo.getItem(itemId);
  if (!item) return;

  const edges = new Map<string, { kind: ItemEdgeKind; weight: number }>();
  const add = (toItemId: string, kind: ItemEdgeKind, weight: number) => {
    if (!toItemId || toItemId === itemId || !Number.isFinite(weight) || weight <= 0) return;
    const current = edges.get(toItemId);
    if (
      !current ||
      weight > current.weight ||
      (weight === current.weight && PRIORITY[kind] > PRIORITY[current.kind])
    ) {
      edges.set(toItemId, { kind, weight: Math.min(weight, 1) });
    }
  };

  if (item.kind === "note" && item.excerpt) {
    try {
      for (const target of await repo.itemsByCanonicalUrls(linkUrls(item.excerpt))) {
        add(target.id, "link", 1);
      }
    } catch (error) {
      console.error("graph: link edges failed", String(error));
    }
  }

  try {
    const [ownTags, neighbours] = await Promise.all([
      repo.tagCount(itemId),
      repo.tagNeighbors(itemId, 12),
    ]);
    for (const neighbour of neighbours) {
      const union = ownTags + neighbour.other_count - neighbour.overlap;
      add(neighbour.id, "tag", union > 0 ? neighbour.overlap / union : 0);
    }
  } catch (error) {
    console.error("graph: tag edges failed", String(error));
  }

  if (env.VECTORS) {
    try {
      const chunks = await repo.chunksForItem(itemId);
      const vectorId = chunks[0]?.vector_id;
      if (vectorId) {
        const [vector] = await env.VECTORS.getByIds([vectorId]);
        if (vector?.values?.length) {
          const res = await env.VECTORS.query(Array.from(vector.values), {
            topK: 20,
            namespace: workspaceId,
            returnMetadata: "all",
            filter: { workspaceId: { $eq: workspaceId } } as never,
          });
          for (const match of res.matches ?? []) {
            const metadata = match.metadata as Record<string, unknown> | null;
            const other = String(metadata?.itemId ?? "");
            if (other && other !== itemId) add(other, "semantic", Number(match.score ?? 0));
          }
        }
      }
    } catch (error) {
      console.error("graph: semantic edges failed", String(error));
    }
  }

  const top = [...edges.entries()]
    .map(([toItemId, edge]) => ({ toItemId, ...edge }))
    .toSorted((a, b) => b.weight - a.weight)
    .slice(0, MAX_EDGES);
  await repo.replaceItemEdges(itemId, top);
}

/** Related items, lazily backfilling edges for items captured before the graph shipped. */
export async function relatedForItem(
  env: Env,
  workspaceId: string,
  itemId: string,
  limit = 6,
): Promise<RelatedItemRow[] | null> {
  const repo = forWorkspace(dbOf(env), workspaceId);
  const item = await repo.getItem(itemId);
  if (!item) return null;

  let related = await repo.relatedItems(itemId, limit);
  if (related.length === 0 && item.graph_refreshed_at == null) {
    await refreshItemEdges(env, workspaceId, itemId);
    related = await repo.relatedItems(itemId, limit);
  }
  return related;
}
