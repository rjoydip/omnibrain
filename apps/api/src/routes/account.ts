import { checkEntitlement, entitlementSummary, type PlanId } from "@omnibrain/core";
import { deleteAccount, forWorkspace, listWorkspaces } from "@omnibrain/db";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, dbOf, repoOf } from "../env";
import { clearCookie, requireRole } from "../http";
import { body } from "../validate";
import { planUsage } from "./items";

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/account", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const usage = await repo.usage();
  const queue = await repo.enrichmentQueue();
  const plan = c.get("workspace").plan as PlanId;
  return c.json({
    user: c.get("session"),
    workspace: c.get("workspace"),
    role: c.get("role"),
    usage,
    queue,
    entitlements: entitlementSummary(plan, {
      items: usage.items,
      enrichmentsMonth: usage.enrichments_month,
      mcpCallsDay: usage.mcp_calls_day,
      connections: usage.connections,
      seats: usage.seats,
      apiKeys: usage.api_keys,
    }),
  });
});

accountRoutes.get("/people", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  const people = q ? await repoOf(c.env, c.get("workspaceId")).searchPeople(q) : [];
  return c.json({ people });
});

accountRoutes.get("/workspaces", async (c) => {
  const db = dbOf(c.env);
  return c.json({ workspaces: await listWorkspaces(db, c.get("session").user_id) });
});

accountRoutes.get("/export", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const data = await repo.exportWorkspace();
  await repo.audit(c.get("session").user_id, "account.export");
  c.header("content-type", "application/json");
  c.header(
    "content-disposition",
    `attachment; filename="omnibrain-${c.get("workspaceId")}-${Date.now()}.json"`,
  );
  return c.body(JSON.stringify(data, null, 2));
});

accountRoutes.delete("/account", async (c) => {
  requireRole(c, ["owner"]);
  const db = dbOf(c.env);
  const repo = repoOf(c.env, c.get("workspaceId"));
  await repo.audit(c.get("session").user_id, "account.delete");

  // Collect vectors for every workspace this user owns, not just the active one.
  const owned = await listWorkspaces(db, c.get("session").user_id);
  for (const workspace of owned) {
    const vectors = await forWorkspace(db, workspace.id).vectorIds();
    if (c.env.VECTORS && vectors.length) {
      for (let i = 0; i < vectors.length; i += 100) {
        await c.env.VECTORS.deleteByIds(vectors.slice(i, i + 100));
      }
    }
  }

  await deleteAccount(db, c.get("session").user_id);
  clearCookie(c);
  return c.json({ ok: true });
});

accountRoutes.get("/plan", async (c) => {
  const repo = repoOf(c.env, c.get("workspaceId"));
  const usage = await planUsage(repo);
  const plan = c.get("workspace").plan as PlanId;
  return c.json({
    plan,
    usage,
    items: checkEntitlement(plan, usage, "item", 0),
    enrichments: checkEntitlement(plan, usage, "enrichment", 0),
    connections: checkEntitlement(plan, usage, "connection", 0),
    apiKeys: checkEntitlement(plan, usage, "apiKey", 0),
  });
});

const ChangePlanSchema = z.object({ plan: z.enum(["free", "pro", "team"]) });

accountRoutes.patch("/plan", body(ChangePlanSchema), async (c) => {
  requireRole(c, ["owner"]);
  const { plan } = c.req.valid("json");
  const repo = repoOf(c.env, c.get("workspaceId"));
  await repo.setPlan(plan);
  await repo.audit(c.get("session").user_id, "workspace.plan", c.get("workspaceId"), { plan });
  return c.json({ ok: true, plan });
});
