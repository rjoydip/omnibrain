-- Why the last enrichment failed (fetch, parse, embedding), so the queue can be
-- inspected instead of guessing from `embedding_state`.
alter table items add column enrich_error text;
