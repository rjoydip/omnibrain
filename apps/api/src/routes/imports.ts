import {
  checkEntitlement,
  ImportBatchSchema,
  ImportCreateSchema,
  type PlanId,
  quotaExceeded,
} from "@omnibrain/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { repoOf } from "../env";
import { requireRole } from "../http";
import { createItemFromRaw } from "../services/items";
import { body } from "../validate";
import { planUsage } from "./items";

export const importRoutes = new Hono<AppEnv>();

importRoutes.get("/", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  return c.json({ imports: await repo.listImports() });
});

importRoutes.post("/", body(ImportCreateSchema), async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const { kind, total } = c.req.valid("json");
  const repo = repoOf(c.env, c.get("workspaceId"));
  const row = await repo.createImport(kind, total);
  return c.json({ import: row }, 201);
});

const BatchSchema = ImportBatchSchema.extend({});

importRoutes.post("/:id/batches", body(BatchSchema), async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const importId = c.req.param("id");
  const workspaceId = c.get("workspaceId");
  const repo = repoOf(c.env, workspaceId);
  const existing = await repo.getImport(importId);
  if (!existing) {
    return c.json({ error: { code: "not_found", message: "Import not found" } }, 404);
  }
  if (existing.status === "done" || existing.status === "failed") {
    return c.json({ error: { code: "conflict", message: "Import already finished" } }, 409);
  }

  const { items } = c.req.valid("json");
  const usage = await planUsage(repo);
  const ent = checkEntitlement(c.get("workspace").plan as PlanId, usage, "item", items.length);
  if (ent.remaining <= 0) throw quotaExceeded(ent.reason ?? "Item limit reached");
  const accepted = items.slice(0, ent.remaining);

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

  const updated = await repo.bumpImport(importId, accepted.length);
  await repo.audit(c.get("session").user_id, "import.batch", importId, {
    created,
    duplicates,
    invalid,
  });
  return c.json({
    import: updated,
    created,
    duplicates,
    invalid,
    blocked: items.length - accepted.length,
  });
});

importRoutes.get("/:id", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const row = await repo.getImport(c.req.param("id"));
  if (!row) return c.json({ error: { code: "not_found", message: "Import not found" } }, 404);
  return c.json({ import: row });
});

const FinishSchema = z.object({
  status: z.enum(["done", "failed"]),
  error: z.string().max(500).optional(),
});

importRoutes.post("/:id/finish", body(FinishSchema), async (c) => {
  requireRole(c, ["owner", "admin", "member"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const { status, error } = c.req.valid("json");
  await repo.finishImport(c.req.param("id"), status, error);
  return c.json({ ok: true });
});
