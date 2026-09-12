-- Catalog supports products, raw materials and services without remapping existing rows.
alter table public.products drop constraint if exists products_item_type_check;
alter table public.products add constraint products_item_type_check check (item_type in ('product','material','service'));
create index if not exists idx_products_company_item_type on public.products(company_id, item_type);
