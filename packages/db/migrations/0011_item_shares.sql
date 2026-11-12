-- Public share links. The token is the only credential; revoking keeps the row
-- so the link can be re-enabled or audited later.
create table item_shares (
  token text primary key,
  item_id text not null references items(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  created_at integer not null,
  revoked_at integer
);

create index item_shares_item on item_shares(item_id);
