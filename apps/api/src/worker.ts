import { deleteExpiredSessions, forWorkspace, listWorkspaceIds, purgeCache } from "@omnibrain/db";
import { createApp } from "./app";
import { dbOf, type Env } from "./env";
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
    ctx.waitUntil(cleanup(env));
  },
};
