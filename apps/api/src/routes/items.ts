import {
  checkEntitlement,
  ImportItemSchema,
  ItemCreateSchema,
  ItemPatchSchema,
  ItemQuerySchema,
  type PlanId,
  quotaExceeded,
  type Usage,
} from "@omnibrain/core";
import type { ScopedRepo } from "@omnibrain/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { repoOf } from "../env";
import { background, type Ctx, requireRole } from "../http";
import { enrichItem } from "../services/enrich";
import { buildItemInput, createItemFromRaw } from "../services/items";
import { body, query } from "../validate";

const BatchSchema = z.object({
  items: z.array(ImportItemSchema).min(1).max(500),
  import_id: z.string().min(1).max(80).optional(),
});

export function usageToCore(usage: {
  items: number;
  enrichments_month: number;
  mcp_calls_day: number;
  connections: number;
  seats: number;
  api_keys: number;
}): Usage {
  return {
    items: usage.items,
    enrichmentsMonth: usage.enrichments_month,
    mcpCallsDay: usage.mcp_calls_day,
    connections: usage.connections,
    seats: usage.seats,
    apiKeys: usage.api_keys,
  };
}

export async function planUsage(repo: ScopedRepo) {
  const usage = await repo.usage();
  return usageToCore(usage);
}

export function scheduleEnrich(c: Ctx, workspaceId: string, itemId: string) {
  if (c.env.ENRICH_QUEUE) {
    background(c, c.env.ENRICH_QUEUE.send({ workspaceId, itemId }));
    return;
  }
  background(
    c,
    enrichItem(c.env, workspaceId, itemId).catch(() => undefined),
  );
}

export const itemRoutes = new Hono<AppEnv>();

itemRoutes.get("/", query(ItemQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const repo = repoOf(c.env, c.get("workspaceId"));
  const list = await repo.listItems({
    limit: q.limit,
    source: q.source,
    kind: q.kind,
    cursor: q.cursor,
  });
  const total = await repo.countItems();
  return c.json({ ...list, total });
});

itemRoutes.post("/", body(ItemCreateSchema), async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const input = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const repo = repoOf(c.env, workspaceId);
  const usage = await planUsage(repo);
  const ent = checkEntitlement(c.get("workspace").plan as PlanId, usage, "item");
  if (!ent.allowed) throw quotaExceeded(ent.reason ?? "Item limit reached");

  const built = await buildItemInput(input);
  const { item, created } = await repo.createItem(built);
  if (created) {
    await repo.audit(c.get("session").user_id, "item.create", item.id, {
      source: item.source,
    });
    if (input.enrich && item.url) scheduleEnrich(c, workspaceId, item.id);
  }
  return c.json({ item, created, usage: ent }, 201);
});

itemRoutes.post("/batch", body(BatchSchema), async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const { items, import_id } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const repo = repoOf(c.env, workspaceId);
  const usage = await planUsage(repo);
  const ent = checkEntitlement(c.get("workspace").plan as PlanId, usage, "item", items.length);
  const allowedCount = Math.max(0, ent.remaining);
  const accepted = items.slice(0, allowedCount);
  const blocked = items.length - accepted.length;

  let created = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const raw of accepted) {
    if (!raw.url && !raw.title && !raw.note) {
      invalid++;
      continue;
    }
    const res = await createItemFromRaw(repo, raw);
    if (res.created) created++;
    else duplicates++;
  }
  if (import_id) await repo.bumpImport(import_id, accepted.length);
  if (created > 0) {
    await repo.audit(c.get("session").user_id, "item.batch", import_id ?? null, {
      created,
      duplicates,
      invalid,
      blocked,
    });
  }
  return c.json({
    created,
    duplicates,
    invalid,
    blocked,
    accepted: accepted.length,
    quota: ent,
  });
});

itemRoutes.get("/:id", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const item = await repo.getItem(c.req.param("id"));
  if (!item) return c.json({ error: { code: "not_found", message: "Item not found" } }, 404);
  return c.json({ item });
});

itemRoutes.patch("/:id", body(ItemPatchSchema), async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const patch = c.req.valid("json");
  const repo = repoOf(c.env, c.get("workspaceId"));
  const item = await repo.updateItem(c.req.param("id"), {
    title: patch.title,
    summary: patch.summary,
    excerpt: patch.note,
    tags: patch.tags,
  });
  if (!item) return c.json({ error: { code: "not_found", message: "Item not found" } }, 404);
  await repo.audit(c.get("session").user_id, "item.update", item.id);
  return c.json({ item });
});

itemRoutes.delete("/:id", async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const ok = await repo.softDeleteItem(c.req.param("id"));
  if (!ok) return c.json({ error: { code: "not_found", message: "Item not found" } }, 404);
  await repo.audit(c.get("session").user_id, "item.delete", c.req.param("id"));
  return c.json({ ok: true });
});

itemRoutes.post("/:id/retry", async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const item = await repo.getItem(c.req.param("id"));
  if (!item) return c.json({ error: { code: "not_found", message: "Item not found" } }, 404);
  await repo.updateItem(item.id, { embeddingState: "pending" });
  scheduleEnrich(c, c.get("workspaceId"), item.id);
  return c.json({ ok: true, queued: true });
});

itemRoutes.get("/:id/content", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const item = await repo.getItem(c.req.param("id"));
  if (!item) return c.json({ error: { code: "not_found", message: "Item not found" } }, 404);
  if (item.content_r2_key && c.env.BLOBS) {
    const object = await c.env.BLOBS.get(item.content_r2_key);
    if (object) {
      c.header("cache-control", "private, max-age=60");
      return c.text(await object.text());
    }
  }
  return c.text(item.excerpt ?? item.summary ?? item.title);
});
