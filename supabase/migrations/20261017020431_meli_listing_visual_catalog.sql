-- Enriches tenant-scoped Mercado Livre listing snapshots for the visual catalog.
-- No provider or commercial writes are performed by this schema migration.

alter table public.meli_listing_links
  add column if not exists image_url text,
  add column if not exists category_name text;

create index if not exists meli_listing_links_catalog_filter_idx
  on public.meli_listing_links (company_id, connection_id, category_id, status, synced_at desc);
