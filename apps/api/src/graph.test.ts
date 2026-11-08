import { describe, expect, test } from "bun:test";
import { bootstrapUser, forWorkspace } from "@omnibrain/db";
import { memoryClient } from "@omnibrain/db/sqlite";
import type { Env } from "./env";
import { refreshItemEdges, relatedForItem } from "./services/graph";

async function setup() {
  const db = memoryClient();
  const boot = await bootstrapUser(db, "graph@example.com");
  const repo = forWorkspace(db, boot.workspace.id);
  const env: Env = { DB: db, AUTH_SECRET: "test-secret", DEV_MODE: "1" };
  return { db, ws: boot.workspace.id, repo, env };
}

const base = {
  kind: "bookmark" as const,
  source: "web",
  title: "Item",
  contentHash: "h",
};

describe("knowledge graph", () => {
  test("derives link and shared-tag edges without AI", async () => {
    const { ws, repo, env } = await setup();
    const linked = await repo.createItem({
      ...base,
      title: "Linked target",
      canonicalUrl: "https://example.com/linked",
      tags: ["shared"],
    });
    const tagged = await repo.createItem({
      ...base,
      title: "Tag neighbour",
      canonicalUrl: "https://example.com/tagged",
      tags: ["shared", "other"],
    });
    const note = await repo.createItem({
      ...base,
      kind: "note",
      title: "Note",
      excerpt: "See [Linked](https://example.com/linked) for context.",
      tags: ["shared"],
    });

    await refreshItemEdges(env, ws, note.item.id);
    const related = await relatedForItem(env, ws, note.item.id, 8);
    expect(related?.map((r) => r.id).toSorted()).toEqual(
      [linked.item.id, tagged.item.id].toSorted(),
    );
    expect(related?.find((r) => r.id === linked.item.id)?.relation).toBe("link");
    expect(related?.find((r) => r.id === tagged.item.id)?.relation).toBe("tag");
  });
});
