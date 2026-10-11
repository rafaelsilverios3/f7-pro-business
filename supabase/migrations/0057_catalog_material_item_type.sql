-- Catalog supports products, raw materials and services without remapping existing rows.
alter table public.products drop constraint if exists products_item_type_check;
alter table public.products add constraint products_item_type_check check (item_type in ('product','material','service'));
create index if not exists idx_products_company_item_type on public.products(company_id, item_type);
-- Conceptual rollback: after 0058/0074 are reversed, restore the 0053 check
-- constraint (item_type in ('product','service')) and drop the added index.
-- First identify and remap every material row: the CHECK cannot be restored
-- while such rows exist, and their original type cannot be inferred reliably.
