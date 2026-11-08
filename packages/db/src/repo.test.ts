import { describe, expect, test } from "bun:test";
import {
  bootstrapUser,
  createSession,
  createWorkspace,
  findApiKey,
  forWorkspace,
  getSession,
  usageFor,
} from "./repo";
import { memoryClient } from "./sqlite";

async function setup() {
  const db = memoryClient();
  const a = await bootstrapUser(db, "a@example.com");
  const b = await bootstrapUser(db, "b@example.com");
  return { db, wsA: a.workspace.id, wsB: b.workspace.id, userA: a.user, userB: b.user };
}

const baseItem = {
  kind: "bookmark" as const,
  source: "web",
  title: "Cloudflare Vectorize docs",
  excerpt: "Global vector database for semantic search.",
  contentHash: "h1",
  tags: ["cloudflare", "vector"],
  capturedAt: 1_700_000_000_000,
};

describe("workspace bootstrap", () => {
  test("creates one personal workspace and is idempotent", async () => {
    const db = memoryClient();
    const first = await bootstrapUser(db, "user@example.com");
    const second = await bootstrapUser(db, "USER@example.com");
    expect(second.user.id).toBe(first.user.id);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(first.workspace.plan).toBe("free");
  });
});

describe("items", () => {
  test("creates, lists and dedupes by canonical url", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const a = await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/a" });
    const b = await repo.createItem({
      ...baseItem,
      title: "Duplicate",
      canonicalUrl: "https://example.com/a",
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect((await repo.listItems()).items).toHaveLength(1);
  });

  test("scopes every read and write to the workspace", async () => {
    const { db, wsA, wsB } = await setup();
    const repoA = forWorkspace(db, wsA);
    const repoB = forWorkspace(db, wsB);
    const item = await repoA.createItem({
      ...baseItem,
      title: "tenant A secret",
      canonicalUrl: "https://a.example/secret",
    });

    expect((await repoB.listItems()).items).toHaveLength(0);
    expect(await repoB.getItem(item.item.id)).toBeNull();
    expect(await repoB.countItems()).toBe(0);
    const hits = await repoB.searchLexical('"secret"*');
    expect(hits).toHaveLength(0);
    expect((await repoA.listItems()).items[0]?.title).toContain("tenant A");
  });

  test("soft delete hides from list, get and FTS", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const { item } = await repo.createItem({
      ...baseItem,
      canonicalUrl: "https://example.com/del",
    });
    expect(await repo.softDeleteItem(item.id)).toBe(true);
    expect(await repo.getItem(item.id)).toBeNull();
    expect((await repo.listItems()).items).toHaveLength(0);
    expect(await repo.searchLexical('"vectorize"*')).toHaveLength(0);
    expect(await repo.countItems()).toBe(0);
  });

  test("archive hides from the active list and restore returns it", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const { item } = await repo.createItem({
      ...baseItem,
      canonicalUrl: "https://example.com/archive",
    });

    expect(await repo.setItemArchived(item.id, true)).toBe(true);
    expect((await repo.listItems({ status: "active" })).items).toHaveLength(0);
    expect(await repo.countItems("active")).toBe(0);
    expect((await repo.listItems({ status: "archived" })).items).toHaveLength(1);
    expect(await repo.countItems("archived")).toBe(1);

    await repo.setItemArchived(item.id, false);
    expect((await repo.listItems({ status: "active" })).items).toHaveLength(1);

    await repo.softDeleteItem(item.id);
    expect((await repo.listItems({ status: "trash" })).items).toHaveLength(1);
    expect(await repo.restoreItem(item.id)).toBe(true);
    expect((await repo.listItems({ status: "active" })).items).toHaveLength(1);
    expect((await repo.searchLexical('"vectorize"*')).length).toBeGreaterThan(0);

    await repo.softDeleteItem(item.id);
    expect(await repo.purgeItem(item.id)).toEqual([]);
    expect(await repo.countItems("trash")).toBe(0);
    expect(await repo.purgeItem(item.id)).toBeNull();
  });

  test("stores undirected graph edges and resolves related items", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const a = await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/graph-a" });
    const b = await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/graph-b" });

    await repo.replaceItemEdges(a.item.id, [{ toItemId: b.item.id, kind: "tag", weight: 0.6 }]);

    expect((await repo.relatedItems(a.item.id)).map((r) => r.id)).toEqual([b.item.id]);
    expect((await repo.relatedItems(b.item.id)).map((r) => r.id)).toEqual([a.item.id]);
    expect((await repo.relatedItems(a.item.id))[0]?.relation).toBe("tag");
  });

  test("patch updates tags and reindexes search", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const { item } = await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/p" });
    await repo.updateItem(item.id, { tags: ["bun", "typescript"], title: "Bun workspaces" });
    const hits = await repo.searchLexical('"typescript"*');
    expect(hits[0]?.item.id).toBe(item.id);
    expect(hits[0]?.item.tags_text).toBe("bun typescript");
  });

  test("pagination uses captured_at cursor", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    for (let i = 0; i < 3; i++) {
      await repo.createItem({
        ...baseItem,
        title: `Item ${i}`,
        canonicalUrl: `https://example.com/${i}`,
        capturedAt: 1000 + i,
      });
    }
    const first = await repo.listItems({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe("1001");
    const second = await repo.listItems({ limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.title).toBe("Item 0");
  });
});

describe("trash purge", () => {
  test("removes only items older than the cutoff", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const old = await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/old" });
    const fresh = await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/fresh" });
    await repo.softDeleteItem(old.item.id);
    await repo.softDeleteItem(fresh.item.id);
    await db.run("update items set deleted_at = 1 where id = ?", [old.item.id]);
    const purged = await repo.purgeTrash(1000);
    expect(purged).toEqual([]);
    expect(await repo.listItems({ includeDeleted: true })).toBeTruthy();
    expect(
      (await db.first<{ n: number }>("select count(*) as n from items where id = ?", [old.item.id]))
        ?.n,
    ).toBe(0);
    expect(
      (
        await db.first<{ n: number }>("select count(*) as n from items where id = ?", [
          fresh.item.id,
        ])
      )?.n,
    ).toBe(1);
  });
});

describe("auth primitives", () => {
  test("session round trip", async () => {
    const { db, userA } = await setup();
    await createSession(db, userA.id, "hash-1", Date.now() + 60_000);
    const session = await getSession(db, "hash-1");
    expect(session?.user_id).toBe(userA.id);
    expect(session?.email).toBe("a@example.com");
  });
});

describe("api keys", () => {
  test("lookup by hash and revoke via workspace scope", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    const key = await repo.createApiKey("Claude", "hash-abc", "ob_abc12345");
    expect((await findApiKey(db, "hash-abc"))?.id).toBe(key.id);
    expect((await repo.listApiKeys())[0]?.prefix).toBe("ob_abc12345");
    await repo.revokeApiKey(key.id);
    expect(await findApiKey(db, "hash-abc")).toBeNull();
  });
});

describe("export", () => {
  test("strips stored credentials", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    await repo.upsertConnection({
      appId: "notion",
      externalAccountId: "acct",
      secretCiphertext: "v1:secret:secret",
    });
    const exported = await repo.exportWorkspace();
    const connection = exported.connections[0] as Record<string, unknown>;
    expect(connection).toBeTruthy();
    expect("secret_ciphertext" in connection).toBe(false);
    expect(connection.app_id).toBe("notion");
    const stored = await db.first<{ secret_ciphertext: string }>(
      "select secret_ciphertext from connections where workspace_id = ?",
      [wsA],
    );
    expect(stored?.secret_ciphertext).toContain("v1:");
  });
});

describe("usage", () => {
  test("counts items, connections and seats", async () => {
    const { db, wsA } = await setup();
    const repo = forWorkspace(db, wsA);
    await repo.createItem({ ...baseItem, canonicalUrl: "https://example.com/u" });
    await repo.upsertConnection({ appId: "notion", externalAccountId: "acct" });
    await repo.incrementUsage("mcp_calls", 3);
    await repo.incrementUsage("enrichments", 2);
    const usage = await usageFor(db, wsA);
    expect(usage.items).toBe(1);
    expect(usage.connections).toBe(1);
    expect(usage.seats).toBe(1);
    expect(usage.mcp_calls_day).toBe(3);
    expect(usage.enrichments_month).toBe(2);
  });
});

describe("multi-workspace", () => {
  test("a user can own several workspaces and see both", async () => {
    const { db, userA } = await setup();
    const work = await createWorkspace(db, userA.id, "Work");
    const repo = forWorkspace(db, work.id);
    await repo.createItem({ ...baseItem, canonicalUrl: "https://work.example/1" });
    const { listWorkspaces } = await import("./repo");
    expect((await listWorkspaces(db, userA.id)).length).toBe(2);
  });
});
