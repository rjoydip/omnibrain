import { mkdirSync } from "node:fs";
import { bootstrapUser, forWorkspace } from "@omnibrain/db";
import { createSqliteClient, migrate } from "@omnibrain/db/sqlite";
import { createApp } from "./app";
import type { Env } from "./env";

mkdirSync(".data", { recursive: true });
const db = createSqliteClient(".data/dev.db");
migrate(db);

const { user, workspace } = await bootstrapUser(db, "demo@omnibrain.local");
const repo = forWorkspace(db, workspace.id);

const DAY = 86_400_000;
const now = Date.now();
const seed = [
  {
    title: "Cloudflare Vectorize: architecture notes",
    url: "https://developers.cloudflare.com/vectorize/",
    source: "web",
    excerpt:
      "Vectorize is a globally distributed vector database. Namespaces isolate tenants; metadata filters narrow by source and date. Query latency is single-digit milliseconds at the edge.",
    summary:
      "Architecture notes on Vectorize: namespaces for tenant isolation, metadata filtering, and edge query latency.",
    tags: ["cloudflare", "vector", "architecture"],
    days: 2,
  },
  {
    title: "Bun workspaces in practice",
    url: "https://bun.sh/docs/install/workspaces",
    source: "web",
    excerpt:
      "Workspaces let one lockfile and one install command cover apps and packages. Use workspace:* for local dependencies and a single bun.lock committed to the repo.",
    summary:
      "How Bun workspaces keep a monorepo to one lockfile, with workspace protocol links for local packages.",
    tags: ["bun", "monorepo", "typescript"],
    days: 4,
  },
  {
    title: "Q4 product roadmap",
    url: "notion://page/q4-roadmap",
    source: "notion",
    excerpt:
      "MCP launch, connector health states, Atlas view polish, and pricing validation. Keep is import-only until a consumer API exists.",
    summary:
      "Q4 priorities: MCP launch, connector health, Atlas polish, and honest Keep import messaging.",
    tags: ["notion", "product", "roadmap"],
    days: 6,
  },
  {
    title: "Thread: edge-first knowledge bases",
    url: "https://x.com/i/web/status/1700000000000000001",
    source: "x",
    excerpt:
      "The interesting part of edge knowledge tools is not storage, it is recall latency and citation quality. Search must return the quote, not just the link.",
    summary: "A thread arguing recall quality and citations matter more than storage architecture.",
    tags: ["x", "edge", "recall"],
    days: 9,
  },
  {
    title: "Groceries and hardware",
    url: "keep://note/keep-77112",
    source: "keep",
    excerpt: "[ ] USB-C cables\n[ ] keycaps\n[ ] matcha\n[x] cold brew",
    summary: "A Keep shopping list imported from Takeout.",
    tags: ["personal", "keep"],
    days: 11,
  },
  {
    title: "D1 read replication and hot writes",
    url: "https://developers.cloudflare.com/d1/",
    source: "web",
    excerpt:
      "D1 replicas serve reads close to users; writes go to the primary. Keep hot counters out of D1 and batch writes. Use a Durable Object for per-tenant quotas.",
    summary:
      "D1 scaling notes: read replicas, single-writer reality, and why counters belong in DOs.",
    tags: ["cloudflare", "d1", "scaling"],
    days: 14,
  },
  {
    title: "Alchemy: infrastructure as effects",
    url: "https://alchemy.run/cloudflare/",
    source: "web",
    excerpt:
      "An Alchemy app on Cloudflare is one Worker runtime plus resources declared in TypeScript. Deploy with bun alchemy deploy; Alchemy diffs what changed.",
    summary: "Alchemy's TypeScript-native IaC model for Cloudflare Workers and bindings.",
    tags: ["alchemy", "cloudflare", "infrastructure"],
    days: 17,
  },
  {
    title: "Hybrid search with reciprocal rank fusion",
    url: "https://example.com/rrf-notes",
    source: "web",
    excerpt:
      "RRF combines ranked lists without score calibration: score = sum 1/(k + rank). k=60 is a robust default. Add recency only as a small multiplicative boost.",
    summary: "Why RRF is the right fusion for BM25 plus vector results, and how to tune k.",
    tags: ["search", "rrf", "bm25"],
    days: 21,
  },
  {
    title: "Raindrop: design references",
    url: "https://raindrop.io/collection/design",
    source: "raindrop",
    excerpt:
      "Editorial layouts, quiet color systems, dense data tables, and a dislike of gradient soup. Collect the ones that survive a screenshot test.",
    summary: "A Raindrop collection of interface references with an editorial, quiet aesthetic.",
    tags: ["design", "inspiration"],
    days: 25,
  },
  {
    title: "Notion: onboarding copy draft",
    url: "notion://page/onboarding-copy",
    source: "notion",
    excerpt:
      "First value in three minutes: pick one source, watch the import, search a half-remembered phrase. Avoid feature tours. Show the Atlas once, then get out of the way.",
    summary: "Onboarding copy focused on a single first-value path and no feature tours.",
    tags: ["notion", "onboarding", "copy"],
    days: 30,
  },
  {
    title: "MCP spec: Streamable HTTP",
    url: "https://modelcontextprotocol.io/specification",
    source: "web",
    excerpt:
      "Streamable HTTP replaces the old SSE transport. Clients POST JSON-RPC; servers may return JSON or an SSE stream. OAuth 2.1 is the remote auth path.",
    summary: "MCP transport notes: Streamable HTTP, JSON-RPC shape, and OAuth 2.1.",
    tags: ["mcp", "protocol", "ai"],
    days: 36,
  },
  {
    title: "WCAG 2.2: focus appearance",
    url: "https://www.w3.org/WAI/WCAG22/",
    source: "web",
    excerpt:
      "Focus indicators must be visible and not obscured. Keyboard-only flows need a skip link and a logical order. Color alone cannot carry status.",
    summary: "Accessibility checklist for focus, keyboard order, and non-color status cues.",
    tags: ["accessibility", "wcag", "design"],
    days: 42,
  },
  {
    title: "Thread: SQLite is enough",
    url: "https://x.com/i/web/status/1700000000000000002",
    source: "x",
    excerpt:
      "Most SaaS products do not need Postgres on day one. They need clear tenancy, indexes that match the query, and a plan for write hotspots.",
    summary: "An argument for SQLite/D1 at SaaS scale, with caveats about write contention.",
    tags: ["sqlite", "saas", "database"],
    days: 51,
  },
  {
    title: "Keep Takeout format notes",
    url: "keep://note/takeout-format",
    source: "keep",
    excerpt:
      "Takeout Keep exports contain JSON with title, textContent, listContent, labels, createdTimestampUsec, isTrashed. Skip trashed notes. There is no consumer API.",
    summary: "Field notes on parsing Google Keep Takeout JSON honestly, without a fake sync.",
    tags: ["keep", "import", "notes"],
    days: 58,
  },
  {
    title: "Designing the Atlas view",
    url: "https://example.com/atlas-view",
    source: "web",
    excerpt:
      "A density map of captures by week and source answers 'when did I save that?' faster than a list. Canvas beats SVG at this scale. Click a cell to filter.",
    summary: "Notes on a canvas density map for temporal recall, and why it beats a graph view.",
    tags: ["design", "atlas", "canvas"],
    days: 66,
  },
  {
    title: "Prompt injection is a data problem",
    url: "https://example.com/prompt-injection",
    source: "web",
    excerpt:
      "Treat imported content as untrusted. Delimit it, never execute model output, validate JSON, and keep tool calls outside the summarization path.",
    summary:
      "A practical prompt-injection defense: delimit untrusted text, validate output, no tool calls.",
    tags: ["security", "ai", "prompt-injection"],
    days: 75,
  },
  {
    title: "Notion API rate limits",
    url: "notion://page/notion-rate-limits",
    source: "notion",
    excerpt:
      "Average of three requests per second per integration. Backfill in pages of 100 and honor 429 Retry-After. Cursor sync beats full scans.",
    summary: "Notion integration constraints and a cursor-based sync plan.",
    tags: ["notion", "api", "sync"],
    days: 84,
  },
  {
    title: "Stripe webhooks on Workers",
    url: "https://docs.stripe.com/webhooks",
    source: "web",
    excerpt:
      "Verify signatures with the async WebCrypto helper. Store event ids for idempotency. Subscription changes should update entitlements, never delete data.",
    summary:
      "Stripe webhook handling notes for Workers, including idempotency and downgrade behavior.",
    tags: ["stripe", "billing", "workers"],
    days: 96,
  },
  {
    title: "Bun test is enough for pure logic",
    url: "https://bun.sh/docs/cli/test",
    source: "web",
    excerpt:
      "bun test runs TypeScript with no config. Use it for canonicalization, ranking, parsing and entitlements. Reach for workerd tooling only when bindings are involved.",
    summary:
      "A pragmatic testing split: bun test for pure code, worker runtime tests for bindings.",
    tags: ["bun", "testing", "typescript"],
    days: 110,
  },
  {
    title: "Thread: citations or it did not happen",
    url: "https://x.com/i/web/status/1700000000000000003",
    source: "x",
    excerpt:
      "An AI answer without a citation is a rumor. The product win is not generation, it is provenance: model, source, timestamp, and the exact quote.",
    summary: "A thread on provenance and citations as the actual product value of AI recall.",
    tags: ["ai", "provenance", "recall"],
    days: 128,
  },
  {
    title: "Raindrop: reading list",
    url: "https://raindrop.io/collection/reading",
    source: "raindrop",
    excerpt:
      "Long reads on local-first software, CRDTs, and the economics of small SaaS. Most saved items are never reopened; recall is the missing feature.",
    summary: "A reading list about local-first software and the recall gap in bookmarking tools.",
    tags: ["reading", "local-first"],
    days: 150,
  },
  {
    title: "Cloudflare Workers AI models",
    url: "https://developers.cloudflare.com/workers-ai/models/",
    source: "web",
    excerpt:
      "bge-m3 produces 1024-dim multilingual embeddings. Pin model ids per environment and validate dimensions before writing to Vectorize.",
    summary: "Workers AI model notes: bge-m3 embeddings and the need to pin versions.",
    tags: ["cloudflare", "ai", "embeddings"],
    days: 172,
  },
];

if ((await repo.countItems()) === 0) {
  let i = 0;
  for (const item of seed) {
    await repo.createItem({
      kind: item.source === "keep" || item.source === "notion" ? "note" : "bookmark",
      source: item.source,
      url: item.url.startsWith("http") ? item.url : null,
      canonicalUrl: item.url.startsWith("http") ? item.url : null,
      title: item.title,
      excerpt: item.excerpt,
      summary: item.summary,
      tags: item.tags,
      capturedAt: now - item.days * DAY,
      contentHash: `seed-${i++}`,
      embeddingState: "skipped",
    });
  }
  console.log(`[omnibrain] seeded ${seed.length} items into ${workspace.name}`);
}

const env: Env = {
  DB: db,
  AUTH_SECRET: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
  DEV_MODE: "1",
  RESEND_KEY: process.env.RESEND_KEY,
  NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
  NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET,
  X_CLIENT_ID: process.env.X_CLIENT_ID,
  X_CLIENT_SECRET: process.env.X_CLIENT_SECRET,
  RAINDROP_CLIENT_ID: process.env.RAINDROP_CLIENT_ID,
  RAINDROP_CLIENT_SECRET: process.env.RAINDROP_CLIENT_SECRET,
};

const app = createApp();
const port = Number(process.env.PORT ?? 8787);

function isAddressInUse(error: unknown): boolean {
  return (
    (error as { code?: string })?.code === "EADDRINUSE" ||
    /address already in use/i.test(String(error))
  );
}

// A `bun --watch` restart can race the old socket for a few hundred ms. Retry briefly
// before treating the port as genuinely occupied by another server.
async function serve(attempts = 10): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      Bun.serve({
        port,
        fetch: (request) => app.fetch(request, env),
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error) || attempt === attempts - 1) break;
      await Bun.sleep(200);
    }
  }

  if (isAddressInUse(lastError)) {
    console.error(
      `\nPort ${port} is already in use. Another dev server is probably running.\n` +
        `Stop it, or start this one with: PORT=8788 bun run dev:api\n`,
    );
    process.exit(1);
  }
  throw lastError;
}

await serve();

console.log(`OmniBrain API on http://localhost:${port}`);
console.log(`Demo account: ${user.email} · workspace: ${workspace.name}`);
console.log("Request a code in the UI; it is printed in this terminal (and returned as dev_code).");
