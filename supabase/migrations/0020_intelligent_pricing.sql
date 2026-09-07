-- ETAPA 20: histórico e aplicação segura de preços.
-- Revisar e aplicar manualmente no Supabase.

create table if not exists public.product_pricing_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  previous_price numeric(14,2) not null default 0,
  new_price numeric(14,2) not null,
  cost_snapshot numeric(14,2) not null default 0,
  real_cost numeric(14,2) not null default 0,
  target_margin numeric(8,3),
  real_margin numeric(8,3),
  pricing_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.product_pricing_history enable row level security;
drop policy if exists pricing_history_company on public.product_pricing_history;
create policy pricing_history_company on public.product_pricing_history for select using (public.is_company_member(company_id));
grant select on public.product_pricing_history to authenticated;

create or replace function public.apply_product_price(target_company uuid, target_product uuid, new_price numeric, pricing_data jsonb default '{}'::jsonb)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare actor_role text; product_row public.products; updated_row public.products; payload jsonb := coalesce(pricing_data, '{}'::jsonb);
begin
  actor_role := public.current_company_role(target_company);
  if actor_role not in ('admin','gestor') then raise exception 'Sem permissão para aplicar preço'; end if;
  if new_price < 0 then raise exception 'Preço inválido'; end if;
  select * into product_row from public.products where id = target_product and company_id = target_company for update;
  if product_row.id is null then raise exception 'Produto não encontrado'; end if;
  update public.products set price = round(new_price, 2), updated_at = now() where id = product_row.id returning * into updated_row;
  insert into public.product_pricing_history(company_id,product_id,previous_price,new_price,cost_snapshot,real_cost,target_margin,real_margin,pricing_data,created_by)
    values(target_company,target_product,product_row.price,updated_row.price,product_row.cost,coalesce((payload->>'realCost')::numeric,product_row.cost),(payload->>'targetMargin')::numeric,(payload->>'realMargin')::numeric,payload,auth.uid());
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(target_company,auth.uid(),'product.price_applied','Product',target_product,to_jsonb(product_row),to_jsonb(updated_row));
  return updated_row;
end;
$$;

revoke all on function public.apply_product_price(uuid,uuid,numeric,jsonb) from public, anon;
grant execute on function public.apply_product_price(uuid,uuid,numeric,jsonb) to authenticated;
