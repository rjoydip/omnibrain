-- Archive support: archived items stay searchable but drop out of the active list.
alter table items add column archived_at integer;
create index items_ws_archived on items(workspace_id, archived_at);
