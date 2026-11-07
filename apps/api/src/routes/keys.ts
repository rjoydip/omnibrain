import {
  ApiKeyCreateSchema,
  checkEntitlement,
  type PlanId,
  quotaExceeded,
  randomToken,
  sha256Hex,
} from "@omnibrain/core";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { repoOf } from "../env";
import { requireRole } from "../http";
import { body } from "../validate";
import { planUsage } from "./items";

export const keyRoutes = new Hono<AppEnv>();

keyRoutes.get("/", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  return c.json({ keys: await repo.listApiKeys() });
});

keyRoutes.post("/", body(ApiKeyCreateSchema), async (c) => {
  requireRole(c, ["owner", "admin"]);
  const { name } = c.req.valid("json");
  const repo = repoOf(c.env, c.get("workspaceId"));
  const usage = await planUsage(repo);
  const ent = checkEntitlement(c.get("workspace").plan as PlanId, usage, "apiKey");
  if (!ent.allowed) throw quotaExceeded(ent.reason ?? "API key limit reached");
  const raw = `ob_${randomToken(24)}`;
  const hash = await sha256Hex(raw);
  const key = await repo.createApiKey(name, hash, raw.slice(0, 12));
  await repo.audit(c.get("session").user_id, "apikey.create", key.id, { name });
  const { key_hash, ...safe } = key;
  return c.json({ key: raw, apiKey: safe }, 201);
});

keyRoutes.get("/:id/events", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const events = await repo.listMcpEvents(c.req.param("id"), 50);
  return c.json({ events });
});

keyRoutes.delete("/:id", async (c) => {
  requireRole(c, ["owner", "admin"]);
  const repo = repoOf(c.env, c.get("workspaceId"));
  const ok = await repo.revokeApiKey(c.req.param("id"));
  if (!ok) return c.json({ error: { code: "not_found", message: "Key not found" } }, 404);
  await repo.audit(c.get("session").user_id, "apikey.revoke", c.req.param("id"));
  return c.json({ ok: true });
});
