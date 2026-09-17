-- Preserve source-derived opportunity values separately from F7 calculations.
alter table public.commercial_campaign_facts
  add column if not exists source_potential numeric;
