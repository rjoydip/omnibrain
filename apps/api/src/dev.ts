import { mkdirSync } from "node:fs";
import { bootstrapUser } from "@omnibrain/db";
import { createSqliteClient, migrate } from "@omnibrain/db/sqlite";
import { createApp } from "./app";
import type { Env } from "./env";

mkdirSync(".data", { recursive: true });
const db = createSqliteClient(".data/dev.db");
migrate(db);

const { user, workspace } = await bootstrapUser(db, "demo@omnibrain.local");

const env: Env = {
  DB: db,
  AUTH_SECRET: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
  DEV_MODE: "1",
  NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
  NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET,
  GH_CLIENT_ID: process.env.GH_CLIENT_ID,
  GH_CLIENT_SECRET: process.env.GH_CLIENT_SECRET,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
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
