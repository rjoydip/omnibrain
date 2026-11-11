const TRACKING = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref_src",
  "ref_url",
  "yclid",
  "_hsenc",
  "_hsmi",
]);

const TRACKING_PREFIXES = ["utm_"];

function isTracking(key: string) {
  const k = key.toLowerCase();
  return TRACKING.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Stable identity for dedupe across imports. Returns null for non-http(s) URLs so
 * app-specific links (notion://) are deduped by external id instead.
 */
export function canonicalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const port =
    url.port &&
    !(
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    )
      ? `:${url.port}`
      : "";
  const path = url.pathname.replace(/\/+$/, "") || "/";

  const params = [...url.searchParams.entries()]
    .filter(([k]) => !isTracking(k))
    .toSorted(([a], [b]) => a.localeCompare(b));

  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";
  const hash = url.hash.startsWith("#!") ? url.hash : "";

  return `${url.protocol}//${host}${port}${path}${query}${hash}`;
}

export type Intent = "keyword" | "question" | "url" | "command";

const QUESTION_START =
  /^(who|what|when|where|why|how|is|are|was|were|can|could|should|does|do|did|will|would)\b/i;

export function detectIntent(query: string): Intent {
  const q = query.trim();
  if (q.startsWith("/")) return "command";
  if (/^https?:\/\//i.test(q)) return "url";
  if (!/\s/.test(q) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && !/^\d+\.\d+$/.test(q)) return "url";
  if (q.endsWith("?") || QUESTION_START.test(q)) return "question";
  return "keyword";
}

/** Turn free text into a safe FTS5 MATCH expression (prefix OR). */
export function buildFtsQuery(query: string): string {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length > 1)
    .slice(0, 12);
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return "";
  return unique.map((t) => `"${t}"*`).join(" OR ");
}

export interface Ranked {
  id: string;
  score: number;
}

/** Reciprocal Rank Fusion over ranked id lists (best first). */
export function rrfFuse(lists: string[][], k = 60): Ranked[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .toSorted((a, b) => b.score - a.score);
}

export interface Candidate {
  id: string;
  source: string;
  capturedAt: number;
  score: number;
}

export interface DiversifyOptions {
  now?: number;
  halfLifeDays?: number;
  recencyWeight?: number;
  maxPerSource?: number;
  limit?: number;
}

/**
 * Recency boost + source diversity. Skipped candidates are appended if there is
 * room, so diversity never silently loses results.
 */
export function boostAndDiversify(cands: Candidate[], opts: DiversifyOptions = {}): Candidate[] {
  const {
    now = Date.now(),
    halfLifeDays = 180,
    recencyWeight = 0.15,
    maxPerSource = 3,
    limit = 20,
  } = opts;

  const boosted = cands
    .map((c) => {
      const ageDays = Math.max(0, (now - c.capturedAt) / 86_400_000);
      const boost = 1 + recencyWeight * Math.exp((-ageDays * Math.LN2) / halfLifeDays);
      return { ...c, score: c.score * boost };
    })
    .toSorted((a, b) => b.score - a.score || b.capturedAt - a.capturedAt);

  const out: Candidate[] = [];
  const held: Candidate[] = [];
  const perSource = new Map<string, number>();

  for (const c of boosted) {
    if (out.length >= limit) break;
    const count = perSource.get(c.source) ?? 0;
    if (count >= maxPerSource) {
      held.push(c);
      continue;
    }
    perSource.set(c.source, count + 1);
    out.push(c);
  }
  for (const c of held) {
    if (out.length >= limit) break;
    out.push(c);
  }
  return out;
}
