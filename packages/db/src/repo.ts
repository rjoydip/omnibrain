import { newId, randomToken } from "@omnibrain/core";
import type { SqlClient } from "./sql";
import type {
  ApiKeyRow,
  ConnectionRow,
  ImportRow,
  ItemRow,
  MembershipRow,
  SessionUser,
  UserRow,
  WorkspaceRow,
} from "./types";

export interface ItemInput {
  kind: ItemRow["kind"];
  source: string;
  connectionId?: string | null;
  externalId?: string | null;
  url?: string | null;
  canonicalUrl?: string | null;
  title: string;
  excerpt?: string | null;
  contentR2Key?: string | null;
  filesJson?: string | null;
  summary?: string | null;
  lang?: string | null;
  author?: string | null;
  publishedAt?: number | null;
  capturedAt?: number;
  contentHash: string;
  tags?: string[];
  embeddingState?: ItemRow["embedding_state"];
}

export interface ItemListOptions {
  source?: string;
  kind?: string;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
  status?: ItemStatus;
  embeddingState?: "pending" | "ready" | "failed" | "skipped";
}

export type ItemStatus = "active" | "archived" | "trash";
export type ItemEdgeKind = "semantic" | "tag" | "link";

export interface ItemEdgeInput {
  toItemId: string;
  kind: ItemEdgeKind;
  weight: number;
}

export interface RelatedItemRow extends ItemRow {
  relation: ItemEdgeKind;
  weight: number;
}

export interface ItemList {
  items: ItemRow[];
  nextCursor: string | null;
}

export function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || workspaceId.trim().length < 3) {
    throw new Error("workspace scope is required");
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${base || "workspace"}-${randomToken(3).toLowerCase()}`;
}

async function setItemTags(db: SqlClient, ws: string, itemId: string, tags: string[]) {
  const names = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  await db.run("delete from item_tags where item_id = ?", [itemId]);
  for (const name of names) {
    const id = `tag_${ws}_${name}`.slice(0, 120);
    await db.run("insert or ignore into tags(id, workspace_id, name) values(?, ?, ?)", [
      id,
      ws,
      name,
    ]);
    const tag = await db.first<{ id: string }>(
      "select id from tags where workspace_id = ? and name = ?",
      [ws, name],
    );
    if (tag) {
      await db.run(
        "insert or ignore into item_tags(workspace_id, item_id, tag_id) values(?, ?, ?)",
        [ws, itemId, tag.id],
      );
    }
  }
  await db.run("update items set tags_text = ? where id = ? and workspace_id = ?", [
    names.join(" "),
    itemId,
    ws,
  ]);
}

export async function getItem(db: SqlClient, ws: string, id: string): Promise<ItemRow | null> {
  assertWorkspaceId(ws);
  return db.first<ItemRow>(
    "select * from items where id = ? and workspace_id = ? and deleted_at is null",
    [id, ws],
  );
}

export interface ItemShareRow {
  token: string;
  item_id: string;
  workspace_id: string;
  audience: "public" | "users";
  created_at: number;
  revoked_at: number | null;
}

export interface SharePerson {
  id: string;
  email: string;
  name: string | null;
}

/** Workspace members matching an email or name fragment. */
export async function searchPeople(
  db: SqlClient,
  ws: string,
  query: string,
  limit = 8,
): Promise<SharePerson[]> {
  assertWorkspaceId(ws);
  const like = `%${query.trim().toLowerCase()}%`;
  if (!query.trim()) return [];
  return db.all<SharePerson>(
    `select u.id, u.email, u.name from memberships m
     join users u on u.id = m.user_id
     where m.workspace_id = ?
       and (lower(u.email) like ? or lower(coalesce(u.name, '')) like ?)
     order by u.email limit ?`,
    [ws, like, like, limit],
  );
}

/** Keeps only ids that are members of the workspace. */
export async function filterWorkspaceMembers(
  db: SqlClient,
  ws: string,
  ids: string[],
): Promise<string[]> {
  assertWorkspaceId(ws);
  if (ids.length === 0) return [];
  const rows = await db.all<{ id: string }>(
    `select user_id as id from memberships
     where workspace_id = ? and user_id in (${ids.map(() => "?").join(",")})`,
    [ws, ...ids],
  );
  return rows.map((row) => row.id);
}

/** Active share token for an item; an empty `recipients` list means public. */
export async function shareItem(
  db: SqlClient,
  ws: string,
  itemId: string,
  recipients: string[] = [],
): Promise<string | null> {
  assertWorkspaceId(ws);
  const item = await getItem(db, ws, itemId);
  if (!item) return null;
  const audience = recipients.length > 0 ? "users" : "public";
  const existing = await db.first<ItemShareRow>(
    "select * from item_shares where item_id = ? and workspace_id = ? and revoked_at is null",
    [itemId, ws],
  );
  const token = existing?.token ?? randomToken(24);
  if (existing) {
    await db.run("update item_shares set audience = ? where token = ?", [audience, token]);
  } else {
    await db.run(
      "insert into item_shares (token, item_id, workspace_id, audience, created_at) values (?,?,?,?,?)",
      [token, itemId, ws, audience, Date.now()],
    );
  }
  await db.run("delete from item_share_recipients where token = ?", [token]);
  for (const userId of recipients) {
    await db.run("insert or ignore into item_share_recipients (token, user_id) values (?,?)", [
      token,
      userId,
    ]);
  }
  return token;
}

export interface ItemShare {
  token: string;
  audience: "public" | "users";
  recipients: SharePerson[];
}

export async function itemShare(
  db: SqlClient,
  ws: string,
  itemId: string,
): Promise<ItemShare | null> {
  assertWorkspaceId(ws);
  const share = await db.first<ItemShareRow>(
    "select * from item_shares where item_id = ? and workspace_id = ? and revoked_at is null",
    [itemId, ws],
  );
  if (!share) return null;
  const recipients =
    share.audience === "users"
      ? await db.all<SharePerson>(
          `select u.id, u.email, u.name from item_share_recipients r
           join users u on u.id = r.user_id where r.token = ? order by u.email`,
          [share.token],
        )
      : [];
  return { token: share.token, audience: share.audience, recipients };
}

export async function unshareItem(db: SqlClient, ws: string, itemId: string): Promise<boolean> {
  assertWorkspaceId(ws);
  const existing = await db.first<ItemShareRow>(
    "select * from item_shares where item_id = ? and workspace_id = ? and revoked_at is null",
    [itemId, ws],
  );
  if (!existing) return false;
  await db.run("update item_shares set revoked_at = ? where token = ?", [
    Date.now(),
    existing.token,
  ]);
  return true;
}

/** Share lookup. Public tokens need no user; `users` shares check membership. */
export async function sharedItem(
  db: SqlClient,
  token: string,
  userId?: string | null,
): Promise<ItemRow | null> {
  const share = await db.first<ItemShareRow>(
    "select * from item_shares where token = ? and revoked_at is null",
    [token],
  );
  if (!share) return null;
  if (share.audience === "users") {
    if (!userId) return null;
    const allowed = await db.first<{ ok: number }>(
      "select 1 as ok from item_share_recipients where token = ? and user_id = ?",
      [token, userId],
    );
    if (!allowed) return null;
  }
  return db.first<ItemRow>("select * from items where id = ? and deleted_at is null", [
    share.item_id,
  ]);
}

export async function createItem(
  db: SqlClient,
  ws: string,
  input: ItemInput,
): Promise<{ item: ItemRow; created: boolean }> {
  assertWorkspaceId(ws);
  const now = Date.now();

  if (input.canonicalUrl) {
    const existing = await db.first<ItemRow>(
      "select * from items where workspace_id = ? and canonical_url = ? and deleted_at is null",
      [ws, input.canonicalUrl],
    );
    if (existing) return { item: existing, created: false };
  }
  if (input.externalId && input.connectionId) {
    const existing = await db.first<ItemRow>(
      "select * from items where workspace_id = ? and connection_id = ? and external_id = ?",
      [ws, input.connectionId, input.externalId],
    );
    if (existing) return { item: existing, created: false };
  }

  const id = newId("itm");
  const tags = input.tags ?? [];
  try {
    await db.run(
      `insert into items (
        id, workspace_id, kind, source, connection_id, external_id, url, canonical_url,
        title, excerpt, content_r2_key, files_json, summary, lang, author, published_at, captured_at,
        content_hash, tags_text, embedding_state, created_at, updated_at
      ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        ws,
        input.kind,
        input.source,
        input.connectionId ?? null,
        input.externalId ?? null,
        input.url ?? null,
        input.canonicalUrl ?? null,
        input.title.slice(0, 500),
        input.excerpt ?? null,
        input.contentR2Key ?? null,
        input.filesJson ?? null,
        input.summary ?? null,
        input.lang ?? null,
        input.author ?? null,
        input.publishedAt ?? null,
        input.capturedAt ?? now,
        input.contentHash,
        tags.join(" "),
        input.embeddingState ?? "pending",
        now,
        now,
      ],
    );
  } catch (error) {
    // Lost a dedupe race: return the winner instead of surfacing a 500.
    const existing = input.canonicalUrl
      ? await db.first<ItemRow>(
          "select * from items where workspace_id = ? and canonical_url = ? and deleted_at is null",
          [ws, input.canonicalUrl],
        )
      : null;
    if (existing) return { item: existing, created: false };
    throw error;
  }

  await setItemTags(db, ws, id, tags);
  const item = await getItem(db, ws, id);
  if (!item) throw new Error("item vanished after insert");
  return { item, created: true };
}

export async function listItems(
  db: SqlClient,
  ws: string,
  opts: ItemListOptions = {},
): Promise<ItemList> {
  assertWorkspaceId(ws);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where = ["workspace_id = ?"];
  const params: unknown[] = [ws];

  if (opts.status === "active") {
    where.push("deleted_at is null and archived_at is null");
  } else if (opts.status === "archived") {
    where.push("deleted_at is null and archived_at is not null");
  } else if (opts.status === "trash") {
    where.push("deleted_at is not null");
  } else {
    where.push(opts.includeDeleted ? "1=1" : "deleted_at is null and archived_at is null");
  }

  if (opts.source) {
    where.push("source = ?");
    params.push(opts.source);
  }
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.embeddingState) {
    where.push("embedding_state = ?");
    params.push(opts.embeddingState);
  }
  if (opts.cursor) {
    const cursor = Number(opts.cursor);
    if (Number.isFinite(cursor) && cursor > 0) {
      where.push("captured_at < ?");
      params.push(cursor);
    }
  }
  params.push(limit + 1);

  const rows = await db.all<ItemRow>(
    `select * from items where ${where.join(" and ")} order by captured_at desc limit ?`,
    params,
  );
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit && items.at(-1) ? String(items.at(-1)?.captured_at) : null;
  return { items, nextCursor };
}

export interface ItemPatch {
  title?: string;
  summary?: string;
  excerpt?: string;
  lang?: string;
  filesJson?: string;
  tags?: string[];
  embeddingState?: ItemRow["embedding_state"];
  /** `null` clears a previous failure; omit to leave it untouched. */
  enrichError?: string | null;
  /** Epoch ms while a worker is inside this item; `null` when it finishes. */
  enrichStartedAt?: number | null;
  contentR2Key?: string;
}

export async function updateItem(
  db: SqlClient,
  ws: string,
  id: string,
  patch: ItemPatch,
): Promise<ItemRow | null> {
  assertWorkspaceId(ws);
  await db.run(
    `update items set
      title = coalesce(?, title),
      summary = coalesce(?, summary),
      excerpt = coalesce(?, excerpt),
      lang = coalesce(?, lang),
      files_json = coalesce(?, files_json),
      content_r2_key = coalesce(?, content_r2_key),
      embedding_state = coalesce(?, embedding_state),
      enrich_error = case when ? then ? else enrich_error end,
      enrich_started_at = case when ? then ? else enrich_started_at end,
      updated_at = ?
    where id = ? and workspace_id = ?`,
    [
      patch.title ?? null,
      patch.summary ?? null,
      patch.excerpt ?? null,
      patch.lang ?? null,
      patch.filesJson ?? null,
      patch.contentR2Key ?? null,
      patch.embeddingState ?? null,
      patch.enrichError !== undefined ? 1 : 0,
      patch.enrichError ?? null,
      patch.enrichStartedAt !== undefined ? 1 : 0,
      patch.enrichStartedAt ?? null,
      Date.now(),
      id,
      ws,
    ],
  );
  if (patch.tags) await setItemTags(db, ws, id, patch.tags);
  return getItem(db, ws, id);
}

export async function softDeleteItem(db: SqlClient, ws: string, id: string): Promise<boolean> {
  assertWorkspaceId(ws);
  const now = Date.now();
  const item = await getItem(db, ws, id);
  if (!item) return false;
  await db.run(
    "update items set deleted_at = ?, embedding_state = 'skipped' where id = ? and workspace_id = ?",
    [now, id, ws],
  );
  await db.run("delete from items_fts where rowid = (select rowid from items where id = ?)", [id]);
  return true;
}

export async function setItemArchived(
  db: SqlClient,
  ws: string,
  id: string,
  archived: boolean,
): Promise<boolean> {
  assertWorkspaceId(ws);
  const item = await getItem(db, ws, id);
  if (!item) return false;
  await db.run(
    "update items set archived_at = ?, updated_at = ? where id = ? and workspace_id = ?",
    [archived ? Date.now() : null, Date.now(), id, ws],
  );
  return true;
}

export async function restoreItem(db: SqlClient, ws: string, id: string): Promise<boolean> {
  assertWorkspaceId(ws);
  const item = await db.first<ItemRow>(
    "select * from items where id = ? and workspace_id = ? and deleted_at is not null",
    [id, ws],
  );
  if (!item) return false;
  await db.run(
    "update items set deleted_at = null, archived_at = null, updated_at = ? where id = ? and workspace_id = ?",
    [Date.now(), id, ws],
  );
  return true;
}

export async function countItems(
  db: SqlClient,
  ws: string,
  status: ItemStatus = "active",
): Promise<number> {
  assertWorkspaceId(ws);
  const filter =
    status === "archived"
      ? " and deleted_at is null and archived_at is not null"
      : status === "trash"
        ? " and deleted_at is not null"
        : status === "active"
          ? " and deleted_at is null and archived_at is null"
          : "";
  const row = await db.first<{ n: number }>(
    `select count(*) as n from items where workspace_id = ?${filter}`,
    [ws],
  );
  return row?.n ?? 0;
}

export interface LexicalHit {
  item: ItemRow;
  rank: number;
}

export async function searchLexical(
  db: SqlClient,
  ws: string,
  ftsQuery: string,
  opts: { limit?: number; source?: string; kind?: string; since?: number } = {},
): Promise<LexicalHit[]> {
  assertWorkspaceId(ws);
  if (!ftsQuery) return [];
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 100);
  const params: unknown[] = [ftsQuery, ws];
  let filters = "";
  if (opts.source) {
    filters += " and i.source = ?";
    params.push(opts.source);
  }
  if (opts.kind) {
    filters += " and i.kind = ?";
    params.push(opts.kind);
  }
  if (opts.since) {
    filters += " and i.captured_at >= ?";
    params.push(opts.since);
  }
  params.push(limit);

  const rows = await db.all<ItemRow & { rank: number }>(
    `select i.*, bm25(items_fts) as rank
     from items_fts
     join items i on i.rowid = items_fts.rowid
     where items_fts match ? and i.workspace_id = ? and i.deleted_at is null${filters}
     order by rank
     limit ?`,
    params,
  );
  return rows.map(({ rank, ...item }) => ({ item: item as ItemRow, rank }));
}

export async function itemsByIds(db: SqlClient, ws: string, ids: string[]): Promise<ItemRow[]> {
  assertWorkspaceId(ws);
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)].slice(0, 100);
  const placeholders = unique.map(() => "?").join(",");
  const rows = await db.all<ItemRow>(
    `select * from items where workspace_id = ? and deleted_at is null and id in (${placeholders})`,
    [ws, ...unique],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return unique.map((id) => byId.get(id)).filter((r): r is ItemRow => Boolean(r));
}

export async function purgeItem(db: SqlClient, ws: string, id: string): Promise<string[] | null> {
  assertWorkspaceId(ws);
  const item = await db.first<{ id: string }>(
    "select id from items where id = ? and workspace_id = ? and deleted_at is not null",
    [id, ws],
  );
  if (!item) return null;
  const vectors = await db.all<{ vector_id: string }>(
    "select vector_id from item_chunks where item_id = ?",
    [id],
  );
  await db.run("delete from items where id = ? and workspace_id = ?", [id, ws]);
  return vectors.map((v) => v.vector_id);
}

export async function purgeTrash(db: SqlClient, ws: string, olderThan: number): Promise<string[]> {
  assertWorkspaceId(ws);
  const ids = await db.all<{ id: string }>(
    "select id from items where workspace_id = ? and deleted_at is not null and deleted_at < ?",
    [ws, olderThan],
  );
  if (ids.length === 0) return [];
  const list = ids.map((r) => r.id);
  const placeholders = list.map(() => "?").join(",");
  const vectors = await db.all<{ vector_id: string }>(
    `select vector_id from item_chunks where item_id in (${placeholders})`,
    list,
  );
  await db.run(`delete from items where workspace_id = ? and id in (${placeholders})`, [
    ws,
    ...list,
  ]);
  return vectors.map((v) => v.vector_id);
}

// ---------------------------------------------------------------- knowledge graph

export async function replaceItemEdges(
  db: SqlClient,
  ws: string,
  itemId: string,
  edges: ItemEdgeInput[],
): Promise<void> {
  assertWorkspaceId(ws);
  await db.run(
    "delete from item_edges where workspace_id = ? and (from_item_id = ? or to_item_id = ?)",
    [ws, itemId, itemId],
  );
  const now = Date.now();
  for (const edge of edges.slice(0, 12)) {
    if (edge.toItemId === itemId) continue;
    const from = edge.toItemId < itemId ? edge.toItemId : itemId;
    const to = edge.toItemId < itemId ? itemId : edge.toItemId;
    await db.run(
      `insert or replace into item_edges(
        workspace_id, from_item_id, to_item_id, kind, weight, created_at
      ) values(?,?,?,?,?,?)`,
      [ws, from, to, edge.kind, edge.weight, now],
    );
  }
  await db.run("update items set graph_refreshed_at = ? where id = ? and workspace_id = ?", [
    now,
    itemId,
    ws,
  ]);
}

export async function relatedItems(
  db: SqlClient,
  ws: string,
  itemId: string,
  limit = 6,
): Promise<RelatedItemRow[]> {
  assertWorkspaceId(ws);
  const rows = await db.all<RelatedItemRow>(
    `select i.*, e.kind as relation, e.weight
     from item_edges e
     join items i on i.id = case
       when e.from_item_id = ? then e.to_item_id
       else e.from_item_id
     end
     where e.workspace_id = ?
       and (e.from_item_id = ? or e.to_item_id = ?)
       and i.workspace_id = ?
       and i.deleted_at is null
       and i.archived_at is null
     order by e.weight desc
     limit ?`,
    [itemId, ws, itemId, itemId, ws, Math.min(Math.max(limit * 3, 1), 60)],
  );
  const best = new Map<string, RelatedItemRow>();
  for (const row of rows) {
    const current = best.get(row.id);
    if (!current || row.weight > current.weight) best.set(row.id, row);
  }
  return [...best.values()].slice(0, limit);
}

export interface TagNeighbor {
  id: string;
  overlap: number;
  other_count: number;
}

export async function tagNeighbors(
  db: SqlClient,
  ws: string,
  itemId: string,
  limit = 12,
): Promise<TagNeighbor[]> {
  assertWorkspaceId(ws);
  return db.all<TagNeighbor>(
    `select b.item_id as id, count(*) as overlap,
       (select count(*) from item_tags x where x.item_id = b.item_id) as other_count
     from item_tags a
     join item_tags b on b.tag_id = a.tag_id and b.workspace_id = a.workspace_id
     join items i on i.id = b.item_id
     where a.workspace_id = ?
       and a.item_id = ?
       and b.item_id != ?
       and i.deleted_at is null
       and i.archived_at is null
     group by b.item_id
     order by overlap desc
     limit ?`,
    [ws, itemId, itemId, limit],
  );
}

export async function tagCount(db: SqlClient, ws: string, itemId: string): Promise<number> {
  assertWorkspaceId(ws);
  const row = await db.first<{ n: number }>(
    "select count(*) as n from item_tags where workspace_id = ? and item_id = ?",
    [ws, itemId],
  );
  return row?.n ?? 0;
}

export async function itemsByCanonicalUrls(
  db: SqlClient,
  ws: string,
  urls: string[],
): Promise<Array<{ id: string; canonical_url: string }>> {
  assertWorkspaceId(ws);
  const unique = [...new Set(urls)].slice(0, 50);
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  return db.all<{ id: string; canonical_url: string }>(
    `select id, canonical_url from items
     where workspace_id = ?
       and canonical_url in (${placeholders})
       and deleted_at is null
       and archived_at is null`,
    [ws, ...unique],
  );
}

// ---------------------------------------------------------------- auth + users

export async function upsertUser(db: SqlClient, email: string): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  const existing = await db.first<UserRow>("select * from users where email = ?", [normalized]);
  if (existing) return existing;
  const user: UserRow = {
    id: newId("usr"),
    email: normalized,
    name: normalized.split("@")[0] ?? null,
    created_at: Date.now(),
  };
  try {
    await db.run("insert into users(id, email, name, created_at) values(?,?,?,?)", [
      user.id,
      user.email,
      user.name,
      user.created_at,
    ]);
  } catch (error) {
    const raced = await db.first<UserRow>("select * from users where email = ?", [normalized]);
    if (raced) return raced;
    throw error;
  }
  return user;
}

export async function createOtp(
  db: SqlClient,
  email: string,
  codeHash: string,
  expiresAt: number,
): Promise<void> {
  await db.run(
    `insert into otp_codes(email, code_hash, expires_at, attempts, consumed_at)
     values(?,?,?,0,null)
     on conflict(email) do update set
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       consumed_at = null`,
    [email.toLowerCase(), codeHash, expiresAt],
  );
}

export async function getOtp(
  db: SqlClient,
  email: string,
): Promise<{ code_hash: string; expires_at: number; attempts: number } | null> {
  return db.first(
    "select code_hash, expires_at, attempts from otp_codes where email = ? and consumed_at is null",
    [email.toLowerCase()],
  );
}

export async function bumpOtpAttempts(db: SqlClient, email: string): Promise<number> {
  await db.run(
    "update otp_codes set attempts = attempts + 1 where email = ? and consumed_at is null",
    [email.toLowerCase()],
  );
  const row = await db.first<{ attempts: number }>(
    "select attempts from otp_codes where email = ?",
    [email.toLowerCase()],
  );
  return row?.attempts ?? 0;
}

export async function consumeOtp(db: SqlClient, email: string): Promise<void> {
  await db.run("delete from otp_codes where email = ?", [email.toLowerCase()]);
}

export async function createSession(
  db: SqlClient,
  userId: string,
  tokenHash: string,
  expiresAt: number,
): Promise<void> {
  await db.run(
    "insert into sessions(id, user_id, token_hash, expires_at, created_at) values(?,?,?,?,?)",
    [newId("ses"), userId, tokenHash, expiresAt, Date.now()],
  );
}

export async function getSession(db: SqlClient, tokenHash: string): Promise<SessionUser | null> {
  return db.first<SessionUser>(
    `select s.id as session_id, s.user_id, s.expires_at, u.email, u.name
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = ?`,
    [tokenHash],
  );
}

export async function deleteSession(db: SqlClient, tokenHash: string): Promise<void> {
  await db.run("delete from sessions where token_hash = ?", [tokenHash]);
}

export async function deleteExpiredSessions(db: SqlClient): Promise<void> {
  await db.run("delete from sessions where expires_at < ?", [Date.now()]);
}

// ------------------------------------------------------------ workspaces

export async function createWorkspace(
  db: SqlClient,
  userId: string,
  name: string,
): Promise<WorkspaceRow> {
  const now = Date.now();
  const ws: WorkspaceRow = {
    id: newId("ws"),
    name: name.slice(0, 80) || "Personal",
    slug: slugify(name || "personal"),
    plan: "free",
    stripe_customer_id: null,
    created_at: now,
    deleted_at: null,
  };
  await db.run("insert into workspaces(id, name, slug, plan, created_at) values(?,?,?,?,?)", [
    ws.id,
    ws.name,
    ws.slug,
    ws.plan,
    ws.created_at,
  ]);
  await db.run("insert into memberships(workspace_id, user_id, role, created_at) values(?,?,?,?)", [
    ws.id,
    userId,
    "owner",
    now,
  ]);
  return ws;
}

export async function bootstrapUser(
  db: SqlClient,
  email: string,
): Promise<{ user: UserRow; workspace: WorkspaceRow }> {
  const user = await upsertUser(db, email);
  const workspaces = await listWorkspaces(db, user.id);
  const workspace = workspaces[0] ?? (await createWorkspace(db, user.id, "Personal"));
  return { user, workspace };
}

export async function listWorkspaces(db: SqlClient, userId: string): Promise<WorkspaceRow[]> {
  return db.all<WorkspaceRow>(
    `select w.* from workspaces w
     join memberships m on m.workspace_id = w.id
     where m.user_id = ? and w.deleted_at is null
     order by w.created_at`,
    [userId],
  );
}

export async function getMembership(
  db: SqlClient,
  ws: string,
  userId: string,
): Promise<MembershipRow | null> {
  return db.first<MembershipRow>(
    "select * from memberships where workspace_id = ? and user_id = ?",
    [ws, userId],
  );
}

export async function getWorkspace(db: SqlClient, ws: string): Promise<WorkspaceRow | null> {
  return db.first<WorkspaceRow>("select * from workspaces where id = ? and deleted_at is null", [
    ws,
  ]);
}

// ------------------------------------------------------------ connections

export async function listConnections(db: SqlClient, ws: string): Promise<ConnectionRow[]> {
  assertWorkspaceId(ws);
  return db.all<ConnectionRow>(
    "select * from connections where workspace_id = ? and status != 'revoked' order by created_at",
    [ws],
  );
}

export async function getConnection(
  db: SqlClient,
  ws: string,
  id: string,
): Promise<ConnectionRow | null> {
  assertWorkspaceId(ws);
  return db.first<ConnectionRow>("select * from connections where id = ? and workspace_id = ?", [
    id,
    ws,
  ]);
}

export async function upsertConnection(
  db: SqlClient,
  ws: string,
  input: {
    appId: string;
    externalAccountId?: string | null;
    scopes?: string[];
    secretCiphertext?: string | null;
    status?: ConnectionRow["status"];
  },
): Promise<ConnectionRow> {
  assertWorkspaceId(ws);
  const existing = await db.first<ConnectionRow>(
    "select * from connections where workspace_id = ? and app_id = ? and coalesce(external_account_id,'') = ?",
    [ws, input.appId, input.externalAccountId ?? ""],
  );
  const scopes = JSON.stringify(input.scopes ?? []);
  if (existing) {
    await db.run(
      `update connections set status = ?, scopes = ?, secret_ciphertext = coalesce(?, secret_ciphertext)
       where id = ? and workspace_id = ?`,
      [input.status ?? "connected", scopes, input.secretCiphertext ?? null, existing.id, ws],
    );
    const updated = await getConnection(db, ws, existing.id);
    if (!updated) throw new Error("connection vanished");
    return updated;
  }
  const row: ConnectionRow = {
    id: newId("con"),
    workspace_id: ws,
    app_id: input.appId,
    external_account_id: input.externalAccountId ?? null,
    status: input.status ?? "connected",
    scopes,
    secret_ciphertext: input.secretCiphertext ?? null,
    cursor: null,
    last_synced_at: null,
    last_error: null,
    created_at: Date.now(),
  };
  await db.run(
    `insert into connections(id, workspace_id, app_id, external_account_id, status, scopes, secret_ciphertext, created_at)
     values(?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.workspace_id,
      row.app_id,
      row.external_account_id,
      row.status,
      row.scopes,
      row.secret_ciphertext,
      row.created_at,
    ],
  );
  return row;
}

export async function updateConnection(
  db: SqlClient,
  ws: string,
  id: string,
  patch: {
    status?: ConnectionRow["status"];
    cursor?: string | null;
    lastSyncedAt?: number;
    lastError?: string | null;
    secretCiphertext?: string | null;
    externalAccountId?: string | null;
  },
): Promise<ConnectionRow | null> {
  assertWorkspaceId(ws);
  await db.run(
    `update connections set
      status = coalesce(?, status),
      cursor = coalesce(?, cursor),
      last_synced_at = coalesce(?, last_synced_at),
      last_error = ?,
      secret_ciphertext = coalesce(?, secret_ciphertext),
      external_account_id = coalesce(?, external_account_id)
     where id = ? and workspace_id = ?`,
    [
      patch.status ?? null,
      patch.cursor ?? null,
      patch.lastSyncedAt ?? null,
      patch.lastError ?? null,
      patch.secretCiphertext ?? null,
      patch.externalAccountId ?? null,
      id,
      ws,
    ],
  );
  return getConnection(db, ws, id);
}

export async function deleteConnection(db: SqlClient, ws: string, id: string): Promise<boolean> {
  assertWorkspaceId(ws);
  const existing = await getConnection(db, ws, id);
  if (!existing) return false;
  await db.run("delete from connections where id = ? and workspace_id = ?", [id, ws]);
  return true;
}

// ------------------------------------------------------------ imports

export async function createImport(
  db: SqlClient,
  ws: string,
  kind: string,
  total: number,
): Promise<ImportRow> {
  assertWorkspaceId(ws);
  const row: ImportRow = {
    id: newId("imp"),
    workspace_id: ws,
    kind,
    status: "parsing",
    total,
    processed: 0,
    error: null,
    created_at: Date.now(),
    finished_at: null,
  };
  await db.run(
    "insert into imports(id, workspace_id, kind, status, total, processed, created_at) values(?,?,?,?,?,?,?)",
    [row.id, ws, kind, row.status, total, 0, row.created_at],
  );
  return row;
}

export async function bumpImport(db: SqlClient, ws: string, id: string, count: number) {
  assertWorkspaceId(ws);
  await db.run(
    "update imports set processed = processed + ?, status = 'enriching' where id = ? and workspace_id = ?",
    [count, id, ws],
  );
  await db.run(
    "update imports set status = 'done', finished_at = ? where id = ? and workspace_id = ? and processed >= total",
    [Date.now(), id, ws],
  );
  return getImport(db, ws, id);
}

export async function finishImport(
  db: SqlClient,
  ws: string,
  id: string,
  status: ImportRow["status"],
  error?: string,
): Promise<void> {
  assertWorkspaceId(ws);
  await db.run(
    "update imports set status = ?, error = ?, finished_at = ? where id = ? and workspace_id = ?",
    [status, error ?? null, Date.now(), id, ws],
  );
}

export async function getImport(db: SqlClient, ws: string, id: string): Promise<ImportRow | null> {
  assertWorkspaceId(ws);
  return db.first<ImportRow>("select * from imports where id = ? and workspace_id = ?", [id, ws]);
}

export async function listImports(db: SqlClient, ws: string): Promise<ImportRow[]> {
  assertWorkspaceId(ws);
  return db.all<ImportRow>(
    "select * from imports where workspace_id = ? order by created_at desc limit 20",
    [ws],
  );
}

// ------------------------------------------------------------ api keys

export async function createApiKey(
  db: SqlClient,
  ws: string,
  name: string,
  keyHash: string,
  prefix: string,
): Promise<ApiKeyRow> {
  assertWorkspaceId(ws);
  const row: ApiKeyRow = {
    id: newId("key"),
    workspace_id: ws,
    name: name.slice(0, 60),
    key_hash: keyHash,
    prefix,
    scopes: '["kb.read","kb.write"]',
    last_used_at: null,
    revoked_at: null,
    created_at: Date.now(),
  };
  await db.run(
    `insert into api_keys(id, workspace_id, name, key_hash, prefix, scopes, created_at)
     values(?,?,?,?,?,?,?)`,
    [row.id, ws, row.name, row.key_hash, row.prefix, row.scopes, row.created_at],
  );
  return row;
}

export async function listApiKeys(db: SqlClient, ws: string) {
  assertWorkspaceId(ws);
  return db.all<Omit<ApiKeyRow, "key_hash">>(
    `select id, workspace_id, name, prefix, scopes, last_used_at, revoked_at, created_at
     from api_keys where workspace_id = ? order by created_at desc`,
    [ws],
  );
}

export async function findApiKey(db: SqlClient, keyHash: string): Promise<ApiKeyRow | null> {
  return db.first<ApiKeyRow>("select * from api_keys where key_hash = ? and revoked_at is null", [
    keyHash,
  ]);
}

export async function touchApiKey(db: SqlClient, id: string): Promise<void> {
  await db.run("update api_keys set last_used_at = ? where id = ?", [Date.now(), id]);
}

export async function revokeApiKey(db: SqlClient, ws: string, id: string): Promise<boolean> {
  assertWorkspaceId(ws);
  const existing = await db.first<{ id: string }>(
    "select id from api_keys where id = ? and workspace_id = ? and revoked_at is null",
    [id, ws],
  );
  if (!existing) return false;
  await db.run("update api_keys set revoked_at = ? where id = ? and workspace_id = ?", [
    Date.now(),
    id,
    ws,
  ]);
  return true;
}

// ------------------------------------------------------------ usage + audit

export interface WorkspaceUsage {
  items: number;
  connections: number;
  seats: number;
  api_keys: number;
  mcp_calls_day: number;
  enrichments_month: number;
}

/** Per-state counts for the sidebar's enrichment queue. */
export interface EnrichmentQueue {
  /** Everything waiting, including the one a worker is inside (`running`). */
  pending: number;
  running: number;
  ready: number;
  failed: number;
  skipped: number;
  total: number;
}

export async function enrichmentQueueFor(db: SqlClient, ws: string): Promise<EnrichmentQueue> {
  assertWorkspaceId(ws);
  const row = await db.first<EnrichmentQueue>(
    `select
      coalesce(sum(case when embedding_state = 'pending' then 1 else 0 end), 0) as pending,
      coalesce(sum(case when embedding_state = 'pending' and enrich_started_at is not null then 1 else 0 end), 0) as running,
      coalesce(sum(case when embedding_state = 'ready' then 1 else 0 end), 0) as ready,
      coalesce(sum(case when embedding_state = 'failed' then 1 else 0 end), 0) as failed,
      coalesce(sum(case when embedding_state = 'skipped' then 1 else 0 end), 0) as skipped,
      count(*) as total
     from items where workspace_id = ? and deleted_at is null`,
    [ws],
  );
  return row ?? { pending: 0, running: 0, ready: 0, failed: 0, skipped: 0, total: 0 };
}

export interface EnrichmentQueueItems {
  running: ItemRow[];
  queued: ItemRow[];
  done: ItemRow[];
  failed: ItemRow[];
  skipped: ItemRow[];
}

/** Detail rows for the sidebar's queue dialog, newest first, capped per state. */
export async function enrichmentQueueItems(
  db: SqlClient,
  ws: string,
  limit = 25,
): Promise<EnrichmentQueueItems> {
  assertWorkspaceId(ws);
  const page = (clause: string) =>
    db.all<ItemRow>(
      `select * from items where workspace_id = ? and deleted_at is null and ${clause}
       order by updated_at desc limit ?`,
      [ws, limit],
    );
  const [running, queued, done, failed, skipped] = await Promise.all([
    page("embedding_state = 'pending' and enrich_started_at is not null"),
    page("embedding_state = 'pending' and enrich_started_at is null"),
    page("embedding_state = 'ready'"),
    page("embedding_state = 'failed'"),
    page("embedding_state = 'skipped'"),
  ]);
  return { running, queued, done, failed, skipped };
}

export interface ProviderCredentialRow {
  app_id: string;
  client_id: string;
  client_secret_ciphertext: string;
  updated_at: number;
}

export async function getProviderCredential(
  db: SqlClient,
  appId: string,
): Promise<ProviderCredentialRow | null> {
  return db.first<ProviderCredentialRow>("select * from provider_credentials where app_id = ?", [
    appId,
  ]);
}

export async function listProviderCredentials(
  db: SqlClient,
): Promise<Array<Omit<ProviderCredentialRow, "client_secret_ciphertext">>> {
  return db.all<Omit<ProviderCredentialRow, "client_secret_ciphertext">>(
    "select app_id, client_id, updated_at from provider_credentials order by app_id",
    [],
  );
}

export async function upsertProviderCredential(
  db: SqlClient,
  appId: string,
  clientId: string,
  ciphertext: string,
): Promise<void> {
  await db.run(
    `insert into provider_credentials(app_id, client_id, client_secret_ciphertext, updated_at)
     values (?, ?, ?, ?)
     on conflict(app_id) do update set
       client_id = excluded.client_id,
       client_secret_ciphertext = excluded.client_secret_ciphertext,
       updated_at = excluded.updated_at`,
    [appId, clientId, ciphertext, Date.now()],
  );
}

export async function deleteProviderCredential(db: SqlClient, appId: string): Promise<void> {
  await db.run("delete from provider_credentials where app_id = ?", [appId]);
}

export async function updateWorkspacePlan(
  db: SqlClient,
  ws: string,
  plan: WorkspaceRow["plan"],
): Promise<void> {
  assertWorkspaceId(ws);
  await db.run("update workspaces set plan = ? where id = ?", [plan, ws]);
}

export async function usageFor(db: SqlClient, ws: string): Promise<WorkspaceUsage> {
  assertWorkspaceId(ws);
  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const row = await db.first<WorkspaceUsage>(
    `select
      (select count(*) from items where workspace_id = ? and deleted_at is null) as items,
      (select count(*) from connections where workspace_id = ? and status != 'revoked') as connections,
      (select count(*) from memberships where workspace_id = ?) as seats,
      (select count(*) from api_keys where workspace_id = ? and revoked_at is null) as api_keys,
      coalesce((select sum(mcp_calls) from usage_daily where workspace_id = ? and day = ?), 0) as mcp_calls_day,
      coalesce((select sum(enrichments) from usage_daily where workspace_id = ? and substr(day,1,7) = ?), 0) as enrichments_month`,
    [ws, ws, ws, ws, ws, day, ws, month],
  );
  return (
    row ?? {
      items: 0,
      connections: 0,
      seats: 1,
      api_keys: 0,
      mcp_calls_day: 0,
      enrichments_month: 0,
    }
  );
}

const USAGE_COLUMNS = new Set(["enrichments", "mcp_calls"]);

export async function incrementUsage(
  db: SqlClient,
  ws: string,
  column: "enrichments" | "mcp_calls",
  amount = 1,
): Promise<void> {
  assertWorkspaceId(ws);
  if (!USAGE_COLUMNS.has(column)) throw new Error("invalid usage column");
  const day = new Date().toISOString().slice(0, 10);
  await db.run(
    `insert into usage_daily(workspace_id, day, ${column}) values(?,?,?)
     on conflict(workspace_id, day) do update set ${column} = ${column} + excluded.${column}`,
    [ws, day, amount],
  );
}

export async function audit(
  db: SqlClient,
  ws: string,
  actorUserId: string | null,
  action: string,
  target?: string | null,
  meta?: unknown,
): Promise<void> {
  assertWorkspaceId(ws);
  await db.run(
    "insert into audit_log(id, workspace_id, actor_user_id, action, target, meta, created_at) values(?,?,?,?,?,?,?)",
    [
      newId("aud"),
      ws,
      actorUserId,
      action,
      target ?? null,
      meta ? JSON.stringify(meta) : null,
      Date.now(),
    ],
  );
}

// ------------------------------------------------------------ cache

export async function getCached<T>(db: SqlClient, key: string): Promise<T | null> {
  const row = await db.first<{ payload: string; expires_at: number }>(
    "select payload, expires_at from query_cache where key = ?",
    [key],
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.run("delete from query_cache where key = ?", [key]);
    return null;
  }
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export async function setCached(
  db: SqlClient,
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  await db.run(
    `insert into query_cache(key, payload, expires_at) values(?,?,?)
     on conflict(key) do update set payload = excluded.payload, expires_at = excluded.expires_at`,
    [key, JSON.stringify(value), Date.now() + ttlMs],
  );
}

export async function purgeCache(db: SqlClient): Promise<void> {
  await db.run("delete from query_cache where expires_at < ?", [Date.now()]);
}

// ------------------------------------------------------------ account lifecycle

export async function deleteAccount(db: SqlClient, userId: string): Promise<string[]> {
  const rows = await db.all<{ workspace_id: string }>(
    `select m.workspace_id from memberships m
     where m.user_id = ?
       and (select count(*) from memberships x where x.workspace_id = m.workspace_id) = 1`,
    [userId],
  );
  const owned = rows.map((r) => r.workspace_id);
  for (const ws of owned) {
    await db.run("delete from audit_log where workspace_id = ?", [ws]);
    await db.run("delete from workspaces where id = ?", [ws]);
  }
  await db.run("delete from memberships where user_id = ?", [userId]);
  await db.run("delete from sessions where user_id = ?", [userId]);
  await db.run("delete from users where id = ?", [userId]);
  return owned;
}

export interface ChunkInput {
  vectorId: string;
  contentR2Key?: string;
  tokenCount?: number;
}

export async function replaceChunks(
  db: SqlClient,
  ws: string,
  itemId: string,
  chunks: ChunkInput[],
): Promise<string[]> {
  assertWorkspaceId(ws);
  const owned = await db.first<{ id: string }>(
    "select id from items where id = ? and workspace_id = ?",
    [itemId, ws],
  );
  if (!owned) return [];
  const old = await db.all<{ vector_id: string }>(
    `select c.vector_id from item_chunks c
     join items i on i.id = c.item_id
     where c.item_id = ? and i.workspace_id = ?`,
    [itemId, ws],
  );
  await db.run("delete from item_chunks where item_id = ?", [itemId]);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    await db.run(
      "insert into item_chunks(item_id, chunk_index, vector_id, content_r2_key, token_count) values(?,?,?,?,?)",
      [itemId, i, chunk.vectorId, chunk.contentR2Key ?? "", chunk.tokenCount ?? 0],
    );
  }
  return old.map((r) => r.vector_id);
}

export async function chunksForItem(
  db: SqlClient,
  ws: string,
  itemId: string,
): Promise<Array<{ chunk_index: number; vector_id: string; content_r2_key: string }>> {
  assertWorkspaceId(ws);
  return db.all(
    `select c.chunk_index, c.vector_id, c.content_r2_key from item_chunks c
     join items i on i.id = c.item_id
     where c.item_id = ? and i.workspace_id = ?
     order by c.chunk_index`,
    [itemId, ws],
  );
}

export async function deleteItemsByConnection(
  db: SqlClient,
  ws: string,
  connectionId: string,
): Promise<{ items: number; vectors: string[] }> {
  assertWorkspaceId(ws);
  const rows = await db.all<{ id: string }>(
    "select id from items where workspace_id = ? and connection_id = ?",
    [ws, connectionId],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { items: 0, vectors: [] };
  const placeholders = ids.map(() => "?").join(",");
  const vectors = await db.all<{ vector_id: string }>(
    `select vector_id from item_chunks where item_id in (${placeholders})`,
    ids,
  );
  await db.run(`delete from items where workspace_id = ? and id in (${placeholders})`, [
    ws,
    ...ids,
  ]);
  return { items: ids.length, vectors: vectors.map((v) => v.vector_id) };
}

export async function allVectorIds(db: SqlClient, ws: string): Promise<string[]> {
  assertWorkspaceId(ws);
  const rows = await db.all<{ vector_id: string }>(
    `select c.vector_id from item_chunks c
     join items i on i.id = c.item_id
     where i.workspace_id = ?`,
    [ws],
  );
  return rows.map((r) => r.vector_id);
}

export async function listWorkspaceIds(db: SqlClient): Promise<string[]> {
  const rows = await db.all<{ id: string }>("select id from workspaces where deleted_at is null");
  return rows.map((r) => r.id);
}

export async function exportWorkspace(db: SqlClient, ws: string) {
  assertWorkspaceId(ws);
  const connections = await listConnections(db, ws);
  return {
    workspace: await getWorkspace(db, ws),
    items: await db.all<ItemRow>(
      "select * from items where workspace_id = ? order by captured_at desc limit 100000",
      [ws],
    ),
    // Never export stored credentials, even encrypted ones.
    connections: connections.map(({ secret_ciphertext, ...safe }) => safe),
    tags: await db.all<{ name: string }>(
      "select name from tags where workspace_id = ? order by name",
      [ws],
    ),
    exported_at: Date.now(),
  };
}

export interface McpEventInput {
  event: "connect" | "tools_list" | "tool_call" | "error" | "request";
  tool?: string | null;
  clientName?: string | null;
  clientVersion?: string | null;
  status: "ok" | "error";
  durationMs?: number;
  detail?: string | null;
}

export interface McpEventRow {
  id: string;
  workspace_id: string;
  api_key_id: string | null;
  event: string;
  tool: string | null;
  client_name: string | null;
  client_version: string | null;
  status: "ok" | "error";
  duration_ms: number;
  detail: string | null;
  created_at: number;
}

export async function logMcpEvent(
  db: SqlClient,
  ws: string,
  apiKeyId: string,
  input: McpEventInput,
): Promise<void> {
  assertWorkspaceId(ws);
  await db.run(
    `insert into mcp_events(
      id, workspace_id, api_key_id, event, tool, client_name, client_version, status, duration_ms, detail, created_at
    ) values(?,?,?,?,?,?,?,?,?,?,?)`,
    [
      newId("evt"),
      ws,
      apiKeyId,
      input.event,
      input.tool ?? null,
      input.clientName?.slice(0, 80) ?? null,
      input.clientVersion?.slice(0, 40) ?? null,
      input.status,
      Math.max(0, Math.round(input.durationMs ?? 0)),
      input.detail?.slice(0, 2000) ?? null,
      Date.now(),
    ],
  );
}

export async function listMcpEvents(
  db: SqlClient,
  ws: string,
  apiKeyId: string,
  limit = 30,
): Promise<McpEventRow[]> {
  assertWorkspaceId(ws);
  return db.all<McpEventRow>(
    "select * from mcp_events where workspace_id = ? and api_key_id = ? order by created_at desc limit ?",
    [ws, apiKeyId, Math.min(Math.max(limit, 1), 100)],
  );
}

// ------------------------------------------------------------ scoped facade

/**
 * The only way application code touches tenant data. Every method injects the
 * workspace filter; raw workspace-less queries are not exported.
 */
export function forWorkspace(db: SqlClient, workspaceId: string) {
  assertWorkspaceId(workspaceId);
  return {
    id: workspaceId,
    listItems: (opts?: ItemListOptions) => listItems(db, workspaceId, opts),
    getItem: (id: string) => getItem(db, workspaceId, id),
    createItem: (input: ItemInput) => createItem(db, workspaceId, input),
    updateItem: (id: string, patch: ItemPatch) => updateItem(db, workspaceId, id, patch),
    softDeleteItem: (id: string) => softDeleteItem(db, workspaceId, id),
    setItemArchived: (id: string, archived: boolean) =>
      setItemArchived(db, workspaceId, id, archived),
    restoreItem: (id: string) => restoreItem(db, workspaceId, id),
    countItems: (status?: ItemStatus) => countItems(db, workspaceId, status),
    searchLexical: (
      q: string,
      opts?: { limit?: number; source?: string; kind?: string; since?: number },
    ) => searchLexical(db, workspaceId, q, opts),
    itemsByIds: (ids: string[]) => itemsByIds(db, workspaceId, ids),
    replaceChunks: (itemId: string, chunks: ChunkInput[]) =>
      replaceChunks(db, workspaceId, itemId, chunks),
    chunksForItem: (itemId: string) => chunksForItem(db, workspaceId, itemId),
    deleteItemsByConnection: (connectionId: string) =>
      deleteItemsByConnection(db, workspaceId, connectionId),
    vectorIds: () => allVectorIds(db, workspaceId),
    exportWorkspace: () => exportWorkspace(db, workspaceId),
    purgeTrash: (olderThan: number) => purgeTrash(db, workspaceId, olderThan),
    purgeItem: (id: string) => purgeItem(db, workspaceId, id),
    replaceItemEdges: (itemId: string, edges: ItemEdgeInput[]) =>
      replaceItemEdges(db, workspaceId, itemId, edges),
    relatedItems: (itemId: string, limit?: number) => relatedItems(db, workspaceId, itemId, limit),
    tagNeighbors: (itemId: string, limit?: number) => tagNeighbors(db, workspaceId, itemId, limit),
    tagCount: (itemId: string) => tagCount(db, workspaceId, itemId),
    itemsByCanonicalUrls: (urls: string[]) => itemsByCanonicalUrls(db, workspaceId, urls),
    listConnections: () => listConnections(db, workspaceId),
    getConnection: (id: string) => getConnection(db, workspaceId, id),
    upsertConnection: (input: Parameters<typeof upsertConnection>[2]) =>
      upsertConnection(db, workspaceId, input),
    updateConnection: (id: string, patch: Parameters<typeof updateConnection>[3]) =>
      updateConnection(db, workspaceId, id, patch),
    deleteConnection: (id: string) => deleteConnection(db, workspaceId, id),
    createImport: (kind: string, total: number) => createImport(db, workspaceId, kind, total),
    bumpImport: (id: string, count: number) => bumpImport(db, workspaceId, id, count),
    finishImport: (id: string, status: ImportRow["status"], error?: string) =>
      finishImport(db, workspaceId, id, status, error),
    getImport: (id: string) => getImport(db, workspaceId, id),
    listImports: () => listImports(db, workspaceId),
    createApiKey: (name: string, hash: string, prefix: string) =>
      createApiKey(db, workspaceId, name, hash, prefix),
    listApiKeys: () => listApiKeys(db, workspaceId),
    logMcpEvent: (apiKeyId: string, event: McpEventInput) =>
      logMcpEvent(db, workspaceId, apiKeyId, event),
    listMcpEvents: (apiKeyId: string, limit?: number) =>
      listMcpEvents(db, workspaceId, apiKeyId, limit),
    revokeApiKey: (id: string) => revokeApiKey(db, workspaceId, id),
    usage: () => usageFor(db, workspaceId),
    enrichmentQueue: () => enrichmentQueueFor(db, workspaceId),
    shareItem: (id: string, recipients?: string[]) => shareItem(db, workspaceId, id, recipients),
    itemShare: (id: string) => itemShare(db, workspaceId, id),
    unshareItem: (id: string) => unshareItem(db, workspaceId, id),
    searchPeople: (query: string) => searchPeople(db, workspaceId, query),
    filterWorkspaceMembers: (ids: string[]) => filterWorkspaceMembers(db, workspaceId, ids),
    enrichmentQueueItems: (limit?: number) => enrichmentQueueItems(db, workspaceId, limit),
    setPlan: (plan: WorkspaceRow["plan"]) => updateWorkspacePlan(db, workspaceId, plan),
    incrementUsage: (column: "enrichments" | "mcp_calls", amount?: number) =>
      incrementUsage(db, workspaceId, column, amount),
    audit: (actor: string | null, action: string, target?: string | null, meta?: unknown) =>
      audit(db, workspaceId, actor, action, target, meta),
  };
}

export type ScopedRepo = ReturnType<typeof forWorkspace>;
