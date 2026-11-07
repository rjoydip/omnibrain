import { type AiBinding, answerQuestion, embedTexts } from "@omnibrain/ai";
import type { SearchSchema } from "@omnibrain/core";
import type { ItemRow } from "@omnibrain/db";
import { forWorkspace } from "@omnibrain/db";
import { boostAndDiversify, buildFtsQuery, rrfFuse } from "@omnibrain/search";
import type { z } from "zod";
import { dbOf, type Env } from "../env";

export type SearchInput = z.infer<typeof SearchSchema>;

export interface SearchHit extends ItemRow {
  score: number;
  matched: "lexical" | "semantic" | "both" | "recent";
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
  answer: string | null;
  meta: {
    lexical: number;
    semantic: number;
    tookMs: number;
    mode: "hybrid" | "lexical" | "recent";
  };
}

export async function searchWorkspace(
  env: Env,
  workspaceId: string,
  input: SearchInput,
): Promise<SearchResponse> {
  const started = Date.now();
  const repo = forWorkspace(dbOf(env), workspaceId);
  const ai = env.AI as unknown as AiBinding | undefined;
  const query = input.query.trim();

  if (!query) {
    const recent = await repo.listItems({
      limit: input.limit,
      source: input.source,
      kind: input.kind,
    });
    return {
      query,
      answer: null,
      results: recent.items.map((item) => ({ ...item, score: 0, matched: "recent" as const })),
      meta: {
        lexical: 0,
        semantic: 0,
        tookMs: Date.now() - started,
        mode: "recent",
      },
    };
  }

  const lexHits = await repo.searchLexical(buildFtsQuery(query), {
    limit: 60,
    source: input.source,
    kind: input.kind,
    since: input.since,
  });
  const lexicalIds = lexHits.map((h) => h.item.id);

  let semanticIds: string[] = [];
  const semanticAvailable = Boolean(ai && env.VECTORS);
  if (semanticAvailable && ai && env.VECTORS) {
    try {
      const [vector] = await embedTexts(ai, [query]);
      if (vector) {
        const filter: Record<string, unknown> = { workspaceId: { $eq: workspaceId } };
        const extra: Record<string, unknown>[] = [];
        if (input.source) extra.push({ source: { $eq: input.source } });
        if (input.kind) extra.push({ kind: { $eq: input.kind } });
        const res = await env.VECTORS.query(vector, {
          topK: 60,
          namespace: workspaceId,
          returnMetadata: "all",
          filter: (extra.length ? { $and: [filter, ...extra] } : filter) as never,
        });
        const seen = new Set<string>();
        for (const match of res.matches ?? []) {
          const itemId = String((match.metadata as Record<string, unknown> | null)?.itemId ?? "");
          if (itemId && !seen.has(itemId)) {
            seen.add(itemId);
            semanticIds.push(itemId);
          }
        }
      }
    } catch (error) {
      console.error("vector query failed", String(error));
      semanticIds = [];
    }
  }

  const fused = rrfFuse([lexicalIds, semanticIds]);
  if (fused.length === 0) {
    return {
      query,
      answer: null,
      results: [],
      meta: {
        lexical: lexicalIds.length,
        semantic: semanticIds.length,
        tookMs: Date.now() - started,
        mode: semanticAvailable ? "hybrid" : "lexical",
      },
    };
  }

  const wanted = fused.map((f) => f.id);
  const rows = await repo.itemsByIds(wanted);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates = fused
    .map((f) => {
      const row = byId.get(f.id);
      return row
        ? { id: row.id, source: row.source, capturedAt: row.captured_at, score: f.score }
        : null;
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const ranked = boostAndDiversify(candidates, { limit: input.limit });
  const lexicalSet = new Set(lexicalIds);
  const semanticSet = new Set(semanticIds);

  const results: SearchHit[] = ranked.flatMap((c) => {
    const row = rowById.get(c.id);
    if (!row) return [];
    const matched =
      lexicalSet.has(c.id) && semanticSet.has(c.id)
        ? "both"
        : semanticSet.has(c.id)
          ? "semantic"
          : "lexical";
    return [{ ...row, score: c.score, matched }];
  });

  let answer: string | null = null;
  if (input.answer && ai) {
    answer = await answerQuestion(
      ai,
      query,
      results.slice(0, 5).map((r) => ({
        id: r.id,
        title: r.title,
        text: r.summary ?? r.excerpt ?? r.title,
      })),
    );
  }

  return {
    query,
    answer,
    results,
    meta: {
      lexical: lexicalIds.length,
      semantic: semanticIds.length,
      tookMs: Date.now() - started,
      mode: semanticAvailable ? "hybrid" : "lexical",
    },
  };
}
