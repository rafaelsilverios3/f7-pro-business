-- F7 PRO BUSINESS — fichas técnicas e produção transacional.
-- Aplicar manualmente após revisão. Rollback conceitual: cancelar ordens de produção,
-- preservar snapshots históricos e remover as tabelas production_* somente após exportar dados.

create table if not exists public.production_recipes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  yield_quantity numeric(14,3) not null default 1 check (yield_quantity > 0),
  yield_unit text not null default 'un',
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  other_cost numeric(14,2) not null default 0 check (other_cost >= 0),
  packaging_cost numeric(14,2) not null default 0 check (packaging_cost >= 0),
  overhead_cost numeric(14,2) not null default 0 check (overhead_cost >= 0),
  loss_percent numeric(8,3) not null default 0 check (loss_percent >= 0 and loss_percent <= 100),
  material_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  cost_status text not null default 'current' check (cost_status in ('current','stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, product_id)
);

create table if not exists public.production_recipe_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipe_id uuid not null references public.production_recipes(id) on delete cascade,
  material_product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'un',
  conversion_factor numeric(14,6) not null default 1 check (conversion_factor > 0),
  cost_snapshot numeric(14,2) not null default 0,
  line_cost numeric(14,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipe_id uuid not null references public.production_recipes(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  material_cost numeric(14,2) not null default 0,
  labor_cost numeric(14,2) not null default 0,
  other_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.production_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  material_product_id uuid not null references public.products(id) on delete restrict,
  quantity_used numeric(14,3) not null,
  unit text not null,
  cost_snapshot numeric(14,2) not null,
  total_cost numeric(14,2) not null
);

create index if not exists idx_production_recipes_company on public.production_recipes(company_id);
create index if not exists idx_production_recipe_items_recipe on public.production_recipe_items(company_id, recipe_id);
create index if not exists idx_production_orders_company_created on public.production_orders(company_id, created_at desc);

do $$ declare table_name text; begin
  foreach table_name in array array['production_recipes','production_recipe_items','production_orders','production_order_items'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists company_isolation on public.%I', table_name);
    execute format('create policy company_isolation on public.%I for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))', table_name);
  end loop;
end $$;

drop trigger if exists production_recipes_set_updated_at on public.production_recipes;
create trigger production_recipes_set_updated_at before update on public.production_recipes
for each row execute function public.set_updated_at();

create or replace function public.mark_production_recipes_stale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cost is distinct from old.cost then
    update public.production_recipes set cost_status='stale', updated_at=now()
    where company_id=new.company_id and exists (select 1 from public.production_recipe_items i where i.recipe_id=production_recipes.id and i.material_product_id=new.id);
  end if;
  return new;
end; $$;
drop trigger if exists products_mark_production_recipes_stale on public.products;
create trigger products_mark_production_recipes_stale after update of cost on public.products
for each row execute function public.mark_production_recipes_stale();

grant select, insert, update, delete on public.production_recipes, public.production_recipe_items, public.production_orders, public.production_order_items to authenticated;

create or replace function public.save_production_recipe(recipe_payload jsonb)
returns public.production_recipes
language plpgsql security invoker set search_path = public as $$
declare
  company_uuid uuid := (recipe_payload->>'company_id')::uuid;
  product_uuid uuid := (recipe_payload->>'product_id')::uuid;
  recipe_row public.production_recipes;
  material jsonb;
  material_row public.products;
  material_cost numeric(14,2);
  line_cost numeric(14,2);
  materials_total numeric(14,2) := 0;
  loss_cost numeric(14,2);
  total numeric(14,2);
  yield_qty numeric := greatest(0.001, coalesce((recipe_payload->>'yield_quantity')::numeric, 1));
  loss_pct numeric := greatest(0, least(100, coalesce((recipe_payload->>'loss_percent')::numeric, 0)));
begin
  if auth.uid() is null or public.current_company_role(company_uuid) not in ('admin','gestor','estoque') then raise exception 'Sem permissão para gerenciar produção'; end if;
  if not exists (select 1 from public.products where id = product_uuid and company_id = company_uuid and active and coalesce(item_type,'product') = 'product') then raise exception 'Produto final inválido'; end if;
  insert into public.production_recipes(company_id, product_id, yield_quantity, yield_unit, labor_cost, other_cost, packaging_cost, overhead_cost, loss_percent)
  values (company_uuid, product_uuid, yield_qty, coalesce(nullif(recipe_payload->>'yield_unit',''),'un'), greatest(0,coalesce((recipe_payload->>'labor_cost')::numeric,0)), greatest(0,coalesce((recipe_payload->>'other_cost')::numeric,0)), greatest(0,coalesce((recipe_payload->>'packaging_cost')::numeric,0)), greatest(0,coalesce((recipe_payload->>'overhead_cost')::numeric,0)), loss_pct)
  on conflict (company_id, product_id) do update set yield_quantity=excluded.yield_quantity, yield_unit=excluded.yield_unit, labor_cost=excluded.labor_cost, other_cost=excluded.other_cost, packaging_cost=excluded.packaging_cost, overhead_cost=excluded.overhead_cost, loss_percent=excluded.loss_percent, cost_status='current'
  returning * into recipe_row;
  delete from public.production_recipe_items where recipe_id = recipe_row.id and company_id = company_uuid;
  if jsonb_typeof(recipe_payload->'items') = 'array' then
    for material in select * from jsonb_array_elements(recipe_payload->'items') loop
      select * into material_row from public.products where id=(material->>'material_product_id')::uuid and company_id=company_uuid and active and coalesce(item_type,'product')='product' for update;
      if material_row.id is null then raise exception 'Matéria-prima inválida'; end if;
      material_cost := greatest(0, coalesce(material_row.cost,0));
      line_cost := round(greatest(0,(material->>'quantity')::numeric) * greatest(0,coalesce((material->>'conversion_factor')::numeric,1)) * material_cost, 2);
      if (material->>'quantity')::numeric <= 0 then raise exception 'Quantidade de matéria-prima inválida'; end if;
      materials_total := materials_total + line_cost;
      insert into public.production_recipe_items(company_id, recipe_id, material_product_id, quantity, unit, conversion_factor, cost_snapshot, line_cost, position)
      values(company_uuid, recipe_row.id, material_row.id, (material->>'quantity')::numeric, coalesce(nullif(material->>'unit',''),'un'), greatest(0.000001,coalesce((material->>'conversion_factor')::numeric,1)), material_cost, line_cost, coalesce((material->>'position')::integer,0));
    end loop;
  end if;
  loss_cost := round(materials_total * loss_pct / 100, 2);
  materials_total := round(materials_total + loss_cost, 2);
  total := round(materials_total + recipe_row.labor_cost + recipe_row.other_cost + recipe_row.packaging_cost + recipe_row.overhead_cost, 2);
  update public.production_recipes set material_cost=materials_total, total_cost=total, unit_cost=round(total/yield_qty,2), cost_status='current' where id=recipe_row.id returning * into recipe_row;
  update public.products set cost=recipe_row.unit_cost, updated_at=now() where id=product_uuid and company_id=company_uuid;
  return recipe_row;
end; $$;

create or replace function public.complete_production_order(order_payload jsonb)
returns public.production_orders
language plpgsql security invoker set search_path = public as $$
declare
  company_uuid uuid := (order_payload->>'company_id')::uuid;
  recipe_uuid uuid := (order_payload->>'recipe_id')::uuid;
  quantity_to_make numeric := (order_payload->>'quantity')::numeric;
  recipe_row public.production_recipes;
  final_product public.products;
  item record;
  material_row public.products;
  required_qty numeric;
  order_row public.production_orders;
begin
  if auth.uid() is null or public.current_company_role(company_uuid) not in ('admin','gestor','estoque') then raise exception 'Sem permissão para produzir'; end if;
  if quantity_to_make is null or quantity_to_make <= 0 then raise exception 'Quantidade produzida inválida'; end if;
  select * into recipe_row from public.production_recipes where id=recipe_uuid and company_id=company_uuid for update;
  if recipe_row.id is null then raise exception 'Ficha técnica não encontrada'; end if;
  select * into final_product from public.products where id=recipe_row.product_id and company_id=company_uuid and active for update;
  for item in select * from public.production_recipe_items where recipe_id=recipe_uuid and company_id=company_uuid order by position, id for update loop
    required_qty := round(item.quantity * item.conversion_factor * quantity_to_make / recipe_row.yield_quantity, 3);
    select * into material_row from public.products where id=item.material_product_id and company_id=company_uuid and active for update;
    if material_row.id is null or material_row.stock < required_qty then raise exception 'Estoque insuficiente para matéria-prima'; end if;
  end loop;
  insert into public.production_orders(company_id,recipe_id,product_id,quantity,material_cost,labor_cost,other_cost,total_cost,unit_cost,created_by)
  values(company_uuid,recipe_uuid,recipe_row.product_id,quantity_to_make,round(recipe_row.material_cost*quantity_to_make/recipe_row.yield_quantity,2),round(recipe_row.labor_cost*quantity_to_make/recipe_row.yield_quantity,2),round((recipe_row.other_cost+recipe_row.packaging_cost+recipe_row.overhead_cost)*quantity_to_make/recipe_row.yield_quantity,2),round(recipe_row.total_cost*quantity_to_make/recipe_row.yield_quantity,2),recipe_row.unit_cost,auth.uid()) returning * into order_row;
  for item in select * from public.production_recipe_items where recipe_id=recipe_uuid and company_id=company_uuid order by position, id loop
    required_qty := round(item.quantity * item.conversion_factor * quantity_to_make / recipe_row.yield_quantity, 3);
    update public.products set stock=stock-required_qty, updated_at=now() where id=item.material_product_id and company_id=company_uuid;
    insert into public.stock_movements(company_id,product_id,type,quantity,reason) values(company_uuid,item.material_product_id,'out',required_qty,'Produção '||order_row.id);
    insert into public.production_order_items(company_id,production_order_id,material_product_id,quantity_used,unit,cost_snapshot,total_cost) values(company_uuid,order_row.id,item.material_product_id,required_qty,item.unit,item.cost_snapshot,round(required_qty*item.cost_snapshot,2));
  end loop;
  update public.products set stock=stock+quantity_to_make, updated_at=now() where id=recipe_row.product_id and company_id=company_uuid;
  insert into public.stock_movements(company_id,product_id,type,quantity,reason) values(company_uuid,recipe_row.product_id,'in',quantity_to_make,'Produção '||order_row.id);
  return order_row;
end; $$;

grant execute on function public.save_production_recipe(jsonb) to authenticated;
grant execute on function public.complete_production_order(jsonb) to authenticated;
