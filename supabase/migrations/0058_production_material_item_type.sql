-- Allow production recipes to consume catalog items explicitly typed as material.
-- Apply manually after reviewing; no historical migration is modified.
create or replace function public.save_production_recipe(recipe_payload jsonb)
returns public.production_recipes
language plpgsql security invoker set search_path = public as $$
declare
  company_uuid uuid := (recipe_payload->>'company_id')::uuid;
  product_uuid uuid := (recipe_payload->>'product_id')::uuid;
  recipe_row public.production_recipes;
  material_payload jsonb;
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
    for material_payload in select * from jsonb_array_elements(recipe_payload->'items') loop
      select p.* into material_row from public.products as p where p.id=(material_payload->>'material_product_id')::uuid and p.company_id=company_uuid and p.active and coalesce(p.item_type,'product')='material' for update;
      if material_row.id is null then raise exception 'Matéria-prima inválida'; end if;
      material_cost := greatest(0, coalesce(material_row.cost,0));
      line_cost := round(greatest(0,(material_payload->>'quantity')::numeric) * greatest(0,coalesce((material_payload->>'conversion_factor')::numeric,1)) * material_cost, 2);
      if (material_payload->>'quantity')::numeric <= 0 then raise exception 'Quantidade de matéria-prima inválida'; end if;
      materials_total := materials_total + line_cost;
      insert into public.production_recipe_items(company_id, recipe_id, material_product_id, quantity, unit, conversion_factor, cost_snapshot, line_cost, position)
      values(company_uuid, recipe_row.id, material_row.id, (material_payload->>'quantity')::numeric, coalesce(nullif(material_payload->>'unit',''),'un'), greatest(0.000001,coalesce((material_payload->>'conversion_factor')::numeric,1)), material_cost, line_cost, coalesce((material_payload->>'position')::integer,0));
    end loop;
  end if;
  loss_cost := round(materials_total * loss_pct / 100, 2);
  materials_total := round(materials_total + loss_cost, 2);
  total := round(materials_total + recipe_row.labor_cost + recipe_row.other_cost + recipe_row.packaging_cost + recipe_row.overhead_cost, 2);
  update public.production_recipes set material_cost=materials_total, total_cost=total, unit_cost=round(total/yield_qty,2), cost_status='current' where id=recipe_row.id returning * into recipe_row;
  update public.products set cost=recipe_row.unit_cost, updated_at=now() where id=product_uuid and company_id=company_uuid;
  return recipe_row;
end; $$;


grant execute on function public.save_production_recipe(jsonb) to authenticated;
