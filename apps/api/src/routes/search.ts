import { AppError, SearchSchema } from "@omnibrain/core";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rateLimit } from "../http";
import { searchWorkspace } from "../services/search";
import { body } from "../validate";

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.post("/", body(SearchSchema), async (c) => {
  const session = c.get("session");
  if (!rateLimit(`search:${session.user_id}`, 120, 60_000)) {
    throw new AppError("rate_limited", "Search is rate limited; try again shortly.", 429);
  }
  const input = c.req.valid("json");
  const res = await searchWorkspace(c.env, c.get("workspaceId"), input);
  return c.json(res);
});
