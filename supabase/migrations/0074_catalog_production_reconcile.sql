-- Reconcile catalog item types for installations that applied the product/service
-- migration before production materials were enabled. Historical rows remain
-- untouched; this only makes the allowed type set and index idempotent.
alter table public.products drop constraint if exists products_item_type_check;
alter table public.products add constraint products_item_type_check check (item_type in ('product','material','service'));
create index if not exists idx_products_company_item_type on public.products(company_id, item_type);
