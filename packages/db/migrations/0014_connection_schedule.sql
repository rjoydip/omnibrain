-- Per-connection auto-sync cadence. 0 means manual only.
alter table connections add column sync_interval_minutes integer not null default 0;
