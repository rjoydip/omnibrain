import { SESSION_COOKIE, resolveSession } from "@omnibrain/auth";
import { AppError } from "@omnibrain/core";
import { sharedItem } from "@omnibrain/db";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type AppEnv, dbOf } from "../env";

/**
 * Unauthenticated: a share token is the only credential. Only the fields the
 * reader renders are exposed — never ids, tags or connection details.
 */
export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/items/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length > 128) throw new AppError("not_found", "Share link not found", 404);
  const session = await resolveSession(dbOf(c.env), getCookie(c, SESSION_COOKIE));
  const item = await sharedItem(dbOf(c.env), token, session?.user_id);
  if (!item) throw new AppError("not_found", "Share link not found", 404);
  return c.json({
    item: {
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      excerpt: item.excerpt,
      summary: item.summary,
      captured_at: item.captured_at,
    },
  });
});
