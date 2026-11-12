-- Distinguishes a queued item from one a worker is inside right now.
alter table items add column enrich_started_at integer;
