import { canSyncInterval, type PlanId } from "@omnibrain/core";
import {
  deleteExpiredSessions,
  forWorkspace,
  getWorkspace,
  listDueConnections,
  listWorkspaceIds,
  purgeCache,
} from "@omnibrain/db";
import { createApp } from "./app";
import { dbOf, type Env } from "./env";
import { syncConnection } from "./services/connectors";
import { enrichItem } from "./services/enrich";

const app = createApp();

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function cleanup(env: Env) {
  const db = dbOf(env);
  await deleteExpiredSessions(db);
  await purgeCache(db);
  // MCP event logs are per-key diagnostics; keep 90 days.
  await db.run("delete from mcp_events where created_at < ?", [
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ]);
  for (const workspaceId of await listWorkspaceIds(db)) {
    const repo = forWorkspace(db, workspaceId);
    const vectors = await repo.purgeTrash(Date.now() - THIRTY_DAYS);
    if (env.VECTORS && vectors.length) {
      for (let i = 0; i < vectors.length; i += 100) {
        await env.VECTORS.deleteByIds(vectors.slice(i, i + 100));
      }
    }
  }
}

/** One page per connection per tick keeps cron CPU and subrequests bounded. */
async function syncDueConnections(env: Env) {
  const db = dbOf(env);
  const due = await listDueConnections(db, Date.now(), 5);
  const allowed: typeof due = [];
  for (const connection of due) {
    const workspace = await getWorkspace(db, connection.workspace_id);
    if (workspace && canSyncInterval(workspace.plan as PlanId, connection.sync_interval_minutes)) {
      allowed.push(connection);
    }
  }
  const results = await Promise.allSettled(
    allowed.map((connection) => syncConnection(env, connection.workspace_id, connection, 1)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("scheduled sync failed", String(result.reason).slice(0, 300));
    }
  }
}

export default {
  fetch: app.fetch,

  async queue(
    batch: MessageBatch<{ workspaceId: string; itemId: string }>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await enrichItem(env, message.body.workspaceId, message.body.itemId);
        message.ack();
      } catch (error) {
        console.error("queue enrich failed", String(error));
        message.retry();
      }
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([cleanup(env), syncDueConnections(env)]));
  },
};
