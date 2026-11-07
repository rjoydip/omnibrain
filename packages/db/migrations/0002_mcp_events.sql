create table mcp_events (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  api_key_id text references api_keys(id) on delete set null,
  event text not null,
  tool text,
  client_name text,
  client_version text,
  status text not null check (status in ('ok', 'error')),
  duration_ms integer not null default 0,
  created_at integer not null
);
create index mcp_events_key on mcp_events(api_key_id, created_at desc);
create index mcp_events_ws on mcp_events(workspace_id, created_at desc);
