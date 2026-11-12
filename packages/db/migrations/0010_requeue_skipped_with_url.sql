-- The queue only means "outstanding enrichment". Items skipped for lack of a URL
-- stay skipped; everything else goes back to waiting so it is visible again.
update items
set embedding_state = 'pending', enrich_started_at = null, enrich_error = null
where embedding_state = 'skipped' and url is not null and deleted_at is null;
