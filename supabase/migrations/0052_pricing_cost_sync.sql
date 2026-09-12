-- Keep pricing application transactional with the product source of truth.
-- Apply manually after review; this does not change RLS or variant pricing.
-- Conceptual rollback: restore the previous apply_product_price function body
-- from migration 0020; product values and pricing history remain unchanged.

create or replace function public.apply_product_price(target_company uuid, target_product uuid, new_price numeric, pricing_data jsonb default '{}'::jsonb)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare
  actor_role text;
  product_row public.products;
  updated_row public.products;
  payload jsonb := coalesce(pricing_data, '{}'::jsonb);
  applied_cost numeric;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  actor_role := public.current_company_role(target_company);
  if actor_role not in ('admin','gestor') then raise exception 'Sem permissão para aplicar preço'; end if;
  if new_price is null or new_price::text in ('NaN','Infinity','-Infinity') or new_price <= 0 or abs(new_price) > 9999999999999.99 then raise exception 'Preço inválido'; end if;
  if jsonb_typeof(payload) <> 'object' then raise exception 'Dados de precificação inválidos'; end if;
  if payload ? 'realCost' and ((payload->>'realCost')::numeric < 0 or (payload->>'realCost')::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Custo real inválido'; end if;
  if payload ? 'variableRate' and ((payload->>'variableRate')::numeric < 0 or (payload->>'variableRate')::numeric >= 100) then raise exception 'Taxa variável inválida'; end if;
  if payload ? 'targetMargin' and ((payload->>'targetMargin')::numeric < 0 or (payload->>'targetMargin')::numeric >= 100) then raise exception 'Margem alvo inválida'; end if;
  if payload ? 'minimumPrice' and (payload->>'minimumPrice')::numeric < 0 then raise exception 'Preço mínimo inválido'; end if;
  if payload ? 'minimumPrice' and (payload->>'minimumPrice')::numeric > 0 and new_price < (payload->>'minimumPrice')::numeric then raise exception 'Preço abaixo do mínimo'; end if;
  select * into product_row from public.products where id = target_product and company_id = target_company for update;
  if product_row.id is null then raise exception 'Produto não encontrado'; end if;
  applied_cost := coalesce((payload->>'realCost')::numeric, product_row.cost);
  update public.products set cost = round(applied_cost, 2), price = round(new_price, 2), updated_at = now() where id = product_row.id and company_id = target_company returning * into updated_row;
  insert into public.product_pricing_history(company_id,product_id,previous_price,new_price,cost_snapshot,real_cost,target_margin,real_margin,pricing_data,created_by)
    values(target_company,target_product,product_row.price,updated_row.price,product_row.cost,applied_cost,(payload->>'targetMargin')::numeric,(payload->>'realMargin')::numeric,payload,auth.uid());
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(target_company,auth.uid(),'product.price_applied','Product',target_product,to_jsonb(product_row),to_jsonb(updated_row));
  return updated_row;
end;
$$;

revoke all on function public.apply_product_price(uuid,uuid,numeric,jsonb) from public, anon;
grant execute on function public.apply_product_price(uuid,uuid,numeric,jsonb) to authenticated;
