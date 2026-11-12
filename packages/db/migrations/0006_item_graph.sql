-- Knowledge graph edges between items. Edges are undirected and stored with the
-- lexicographically smaller item id first so one row serves both directions.
create table item_edges (
  workspace_id text not null,
  from_item_id text not null references items(id) on delete cascade,
  to_item_id text not null references items(id) on delete cascade,
  kind text not null check (kind in ('semantic', 'tag', 'link')),
  weight real not null,
  created_at integer not null,
  primary key (workspace_id, from_item_id, to_item_id, kind)
);
create index item_edges_from on item_edges(workspace_id, from_item_id);
create index item_edges_to on item_edges(workspace_id, to_item_id);

alter table items add column graph_refreshed_at integer;
