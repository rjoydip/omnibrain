-- OmniBrain initial schema. SQLite dialect; applied by Alchemy to D1 and by
-- the dev server to bun:sqlite. Keep migrations additive.

create table users (
  id text primary key,
  email text not null unique,
  name text,
  created_at integer not null
);

create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at integer not null,
  created_at integer not null
);
create index sessions_user on sessions(user_id);

create table otp_codes (
  email text primary key,
  code_hash text not null,
  expires_at integer not null,
  attempts integer not null default 0,
  consumed_at integer
);

create table workspaces (
  id text primary key,
  name text not null,
  slug text not null unique,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  stripe_customer_id text,
  created_at integer not null,
  deleted_at integer
);

create table memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at integer not null,
  primary key (workspace_id, user_id)
);
create index memberships_user on memberships(user_id);

create table connections (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  app_id text not null,
  external_account_id text,
  status text not null check (status in ('authorizing', 'connected', 'degraded', 'paused', 'revoked')),
  scopes text not null default '[]',
  secret_ciphertext text,
  cursor text,
  last_synced_at integer,
  last_error text,
  created_at integer not null,
  unique (workspace_id, app_id, external_account_id)
);
create index connections_ws on connections(workspace_id);

create table items (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('bookmark', 'note', 'highlight', 'file')),
  source text not null,
  connection_id text references connections(id) on delete set null,
  external_id text,
  url text,
  canonical_url text,
  title text not null,
  excerpt text,
  content_r2_key text,
  summary text,
  lang text,
  author text,
  published_at integer,
  captured_at integer not null,
  content_hash text not null,
  tags_text text not null default '',
  embedding_state text not null default 'pending'
    check (embedding_state in ('pending', 'ready', 'failed', 'skipped')),
  deleted_at integer,
  created_at integer not null,
  updated_at integer not null
);

create unique index items_external
  on items(workspace_id, connection_id, external_id)
  where external_id is not null;
create unique index items_canonical
  on items(workspace_id, canonical_url)
  where canonical_url is not null and deleted_at is null;
create index items_ws_captured on items(workspace_id, captured_at desc);
create index items_ws_source on items(workspace_id, source);
create index items_trash on items(workspace_id, deleted_at);

create virtual table items_fts using fts5(
  title,
  excerpt,
  tags_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

create trigger items_ai after insert on items begin
  insert into items_fts(rowid, title, excerpt, tags_text)
  values (new.rowid, new.title, coalesce(new.excerpt, ''), coalesce(new.tags_text, ''));
end;

create trigger items_au after update on items begin
  delete from items_fts where rowid = old.rowid;
  insert into items_fts(rowid, title, excerpt, tags_text)
  values (new.rowid, new.title, coalesce(new.excerpt, ''), coalesce(new.tags_text, ''));
end;

create trigger items_ad after delete on items begin
  delete from items_fts where rowid = old.rowid;
end;

create table tags (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null
);
create unique index tags_name on tags(workspace_id, name);

create table item_tags (
  workspace_id text not null,
  item_id text not null references items(id) on delete cascade,
  tag_id text not null references tags(id) on delete cascade,
  primary key (item_id, tag_id)
);

create table item_chunks (
  item_id text not null references items(id) on delete cascade,
  chunk_index integer not null,
  vector_id text not null unique,
  content_r2_key text not null default '',
  token_count integer not null default 0,
  primary key (item_id, chunk_index)
);

create table imports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null,
  status text not null check (status in ('queued', 'parsing', 'enriching', 'done', 'failed')),
  total integer not null default 0,
  processed integer not null default 0,
  error text,
  created_at integer not null,
  finished_at integer
);
create index imports_ws on imports(workspace_id, created_at desc);

create table api_keys (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  prefix text not null,
  scopes text not null default '["kb.read","kb.write"]',
  last_used_at integer,
  revoked_at integer,
  created_at integer not null
);
create index api_keys_ws on api_keys(workspace_id);

create table usage_daily (
  workspace_id text not null references workspaces(id) on delete cascade,
  day text not null,
  enrichments integer not null default 0,
  mcp_calls integer not null default 0,
  primary key (workspace_id, day)
);

create table query_cache (
  key text primary key,
  payload text not null,
  expires_at integer not null
);

create table audit_log (
  id text primary key,
  workspace_id text not null,
  actor_user_id text,
  action text not null,
  target text,
  ip_hash text,
  meta text,
  created_at integer not null
);
create index audit_ws on audit_log(workspace_id, created_at desc);
