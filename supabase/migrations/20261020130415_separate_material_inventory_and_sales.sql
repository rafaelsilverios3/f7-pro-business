-- Keep products, raw materials, and services as explicit catalog item types.
-- Material balances remain stock-managed for production, but cannot be sold as
-- finished goods or services, even when a client bypasses the normal UI.

create or replace function public.reject_material_items_in_sales()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  item jsonb;
  catalog_item_id uuid;
  catalog_item_type text;
  catalog_company_id uuid;
begin
  if jsonb_typeof(new.items) is distinct from 'array' then
    return new;
  end if;

  for item in select value from jsonb_array_elements(new.items) loop
    if lower(coalesce(item->>'item_type', '')) = 'material' then
      raise exception using
        errcode = '23514',
        message = 'Matéria-prima é estoque interno de produção e não pode ser vendida como item final.';
    end if;

    catalog_item_id := nullif(item->>'product_id', '')::uuid;
    if catalog_item_id is null then
      continue;
    end if;

    select p.item_type, p.company_id
      into catalog_item_type
         , catalog_company_id
    from public.products p
    where p.id = catalog_item_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'O item referenciado não existe no catálogo.';
    end if;

    if catalog_company_id is distinct from new.company_id then
      raise exception using
        errcode = '23514',
        message = 'O item referenciado não pertence à empresa da venda.';
    end if;

    if catalog_item_type = 'material' then
      raise exception using
        errcode = '23514',
        message = 'Matéria-prima é estoque interno de produção e não pode ser vendida como item final.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists sales_reject_material_items on public.sales;
create trigger sales_reject_material_items
before insert or update of items on public.sales
for each row execute function public.reject_material_items_in_sales();

-- Purchases can replenish only stock-managed rows. The UI filter is helpful,
-- but this guard also protects direct API writes and legacy pending orders.
create or replace function public.require_stock_managed_purchase_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  catalog_item_type text;
  catalog_company_id uuid;
  purchase_company_id uuid;
begin
  select p.company_id
    into purchase_company_id
  from public.purchases p
  where p.id = new.purchase_id;

  if not found then
    raise exception using errcode = '23503', message = 'O pedido de compra não existe.';
  end if;
  if purchase_company_id is distinct from new.company_id then
    raise exception using errcode = '23514', message = 'O pedido de compra não pertence à empresa.';
  end if;

  select p.item_type, p.company_id
    into catalog_item_type, catalog_company_id
  from public.products p
  where p.id = new.product_id;

  if not found then
    raise exception using errcode = '23503', message = 'O item da compra não existe no catálogo.';
  end if;
  if catalog_company_id is distinct from new.company_id then
    raise exception using errcode = '23514', message = 'O item da compra não pertence à empresa.';
  end if;
  if catalog_item_type not in ('product', 'material') then
    raise exception using errcode = '23514', message = 'Somente produtos e matérias-primas possuem estoque de compra.';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_items_require_stock_managed_product on public.purchase_items;
create trigger purchase_items_require_stock_managed_product
before insert or update of product_id, company_id on public.purchase_items
for each row execute function public.require_stock_managed_purchase_item();

-- Existing pending purchase lines are checked again at receipt, so old or
-- manually inserted invalid lines cannot add stock to a service.
create or replace function public.require_stock_managed_purchase_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'received' and old.status is distinct from 'received' and exists (
    select 1
    from public.purchase_items i
    left join public.products p on p.id = i.product_id
    where i.purchase_id = new.id
      and (i.company_id is distinct from new.company_id
        or p.company_id is distinct from new.company_id
        or p.item_type not in ('product', 'material'))
  ) then
    raise exception using errcode = '23514', message = 'A compra contém um item sem estoque ou de outra empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_require_stock_managed_receipt on public.purchases;
create trigger purchases_require_stock_managed_receipt
before update of status on public.purchases
for each row execute function public.require_stock_managed_purchase_receipt();

create or replace function public.require_current_production_recipe_cost()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  recipe_cost_status text;
  recipe_product_id uuid;
begin
  select r.cost_status
       , r.product_id
    into recipe_cost_status
       , recipe_product_id
  from public.production_recipes r
  where r.id = new.recipe_id
    and r.company_id = new.company_id
  for update;

  if recipe_cost_status is distinct from 'current' or recipe_product_id is distinct from new.product_id then
    raise exception using
      errcode = '23514',
      message = 'A ficha técnica não corresponde ao produto ou seu custo está desatualizado. Atualize a ficha antes de produzir.';
  end if;

  return new;
end;
$$;

drop trigger if exists production_orders_require_current_recipe_cost on public.production_orders;
create trigger production_orders_require_current_recipe_cost
before insert on public.production_orders
for each row execute function public.require_current_production_recipe_cost();

-- Conceptual rollback: drop the four triggers created here and their functions
-- (sales_reject_material_items, purchase_items_require_stock_managed_product,
-- purchases_require_stock_managed_receipt, and
-- production_orders_require_current_recipe_cost). No catalog, stock, sale,
-- purchase, recipe, or financial rows are changed by this migration. Retain
-- the UI filters if any database guard is rolled back.
