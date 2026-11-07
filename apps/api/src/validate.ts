import { zValidator } from "@hono/zod-validator";
import { badRequest } from "@omnibrain/core";
import type { ZodType } from "zod";

export function body<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) throw badRequest("Invalid request body", result.error.issues);
  });
}

export function query<T extends ZodType>(schema: T) {
  return zValidator("query", schema, (result) => {
    if (!result.success) throw badRequest("Invalid query", result.error.issues);
  });
}
