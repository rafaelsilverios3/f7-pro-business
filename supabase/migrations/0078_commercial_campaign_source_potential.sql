-- Preserve source-derived opportunity values separately from F7 calculations.
alter table public.commercial_campaign_facts
  add column if not exists source_potential numeric;
-- Conceptual rollback: drop source_potential only if consumers are disabled
-- and the column contains no source values that must be retained. Its values
-- are not reconstructible from F7-derived campaign values; export/backup first.
