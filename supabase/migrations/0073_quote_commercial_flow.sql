-- Etapa 16: orçamento comercial tenant-safe, com snapshot e conversão atômica.
-- Migração aditiva: não apaga nem reescreve dados legados.

alter table public.quotes
  add column if not exists subtotal numeric(14,2) not null default 0,
  add column if not exists discount numeric(14,2) not null default 0,
  add column if not exists addition numeric(14,2) not null default 0,
  add column if not exists valid_until date,
  add column if not exists notes text,
  add column if not exists seller_user_id uuid,
  add column if not exists opportunity_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_quotes_company_status_created on public.quotes(company_id, status, created_at desc);
create index if not exists idx_quotes_company_customer on public.quotes(company_id, customer_id, created_at desc);
create index if not exists idx_quotes_company_seller on public.quotes(company_id, seller_user_id, created_at desc);
create index if not exists idx_quotes_company_opportunity on public.quotes(company_id, opportunity_id, created_at desc);

-- Auditoria legada segura: a aplicação pode consultar esta view para identificar
-- orçamentos que precisam de revisão humana antes da conversão.
create or replace view public.quote_legacy_audit as
select q.id, q.company_id, q.status, q.sale_id, q.customer_id, q.items, q.created_at,
  (jsonb_typeof(q.items) = 'array' and jsonb_array_length(q.items) > 0
    and not exists (
      select 1 from jsonb_array_elements(q.items) item
      where coalesce(item->>'unit_price', item->>'price') is null
         or coalesce(item->>'qty', item->>'quantity') is null
    )) as has_reliable_snapshot,
  (q.customer_id is null or exists (select 1 from public.customers c where c.id = q.customer_id and c.company_id = q.company_id)) as customer_is_tenant_safe,
  (q.sale_id is null or exists (select 1 from public.sales s where s.id = q.sale_id and s.company_id = q.company_id)) as sale_is_tenant_safe
from public.quotes q;
revoke all on public.quote_legacy_audit from public, anon, authenticated;
grant select on public.quote_legacy_audit to service_role;

create or replace function public.quote_items_normalize(payload jsonb, target_company uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare item jsonb; normalized jsonb := '[]'::jsonb; product_row public.products;
  qty numeric; unit_price numeric; unit_cost numeric; variant uuid;
begin
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) = 0 then
    raise exception 'Orçamento sem itens';
  end if;
  for item in select value from jsonb_array_elements(payload) loop
    if (item->>'product_id') is null then raise exception 'Item sem produto'; end if;
    qty := nullif(coalesce(item->>'qty', item->>'quantity'), '')::numeric;
    unit_price := nullif(coalesce(item->>'unit_price', item->>'price'), '')::numeric;
    if qty is null or qty <= 0 or unit_price is null or unit_price < 0 then raise exception 'Snapshot de item inválido'; end if;
    select * into product_row from public.products where id = (item->>'product_id')::uuid and company_id = target_company and active;
    if product_row.id is null then raise exception 'Produto não pertence à empresa'; end if;
    variant := nullif(item->>'variant_id', '')::uuid;
    if variant is not null and not exists (select 1 from public.product_variants v where v.id = variant and v.product_id = product_row.id and v.company_id = target_company and v.active) then
      raise exception 'Variação não pertence à empresa';
    end if;
    unit_cost := nullif(coalesce(item->>'unit_cost', item->>'cost'), '')::numeric;
    if unit_cost is null then unit_cost := greatest(0, coalesce(product_row.cost, 0)); end if;
    if unit_cost < 0 then raise exception 'Custo de item inválido'; end if;
    normalized := normalized || jsonb_build_array(
      jsonb_build_object(
        'product_id', product_row.id,
        'variant_id', variant,
        'item_type', coalesce(nullif(item->>'item_type',''), product_row.item_type, 'product'),
        'name', coalesce(nullif(item->>'name',''), product_row.name),
        'description', nullif(item->>'description',''),
        'qty', qty,
        'quantity', qty,
        'unit_price', round(unit_price, 2),
        'price', round(unit_price, 2),
        'unit_cost', round(unit_cost, 2),
        'cost', round(unit_cost, 2),
        'subtotal', round(qty * unit_price, 2),
        'total', round(qty * unit_price, 2)
      ));
  end loop;
  return normalized;
end;
$$;

create or replace function public.validate_quote_commercial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare item jsonb; subtotal_value numeric(14,2) := 0; allowed_transition boolean := false;
  discount_value numeric(14,2); addition_value numeric(14,2);
begin
  if auth.uid() is null or not public.is_company_member(new.company_id) then raise exception 'Usuário não pertence à empresa'; end if;
  if new.customer_id is not null and not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then raise exception 'Cliente não pertence à empresa'; end if;
  if new.seller_user_id is not null and not exists (select 1 from public.company_users m where m.company_id = new.company_id and m.user_id = new.seller_user_id and m.active) then raise exception 'Vendedor não é membro ativo da empresa'; end if;
  if new.opportunity_id is not null and not exists (select 1 from public.opportunities o where o.id = new.opportunity_id and o.company_id = new.company_id) then raise exception 'Oportunidade não pertence à empresa'; end if;
  new.items := public.quote_items_normalize(new.items, new.company_id);
  for item in select value from jsonb_array_elements(new.items) loop subtotal_value := subtotal_value + (item->>'subtotal')::numeric; end loop;
  subtotal_value := round(subtotal_value, 2);
  discount_value := greatest(0, coalesce(new.discount, 0));
  addition_value := greatest(0, coalesce(new.addition, 0));
  new.subtotal := subtotal_value;
  new.discount := discount_value;
  new.addition := addition_value;
  new.total := greatest(0, round(subtotal_value - discount_value + addition_value, 2));
  new.updated_at := now();
  if new.status not in ('draft','sent','viewed','negotiating','approved','refused','expired','converted','cancelled') then raise exception 'Status de orçamento inválido'; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status in ('converted','cancelled','refused','expired') then raise exception 'Orçamento em estado terminal'; end if;
    allowed_transition := case old.status
      when 'draft' then new.status in ('sent','viewed','negotiating','approved','refused','cancelled')
      when 'sent' then new.status in ('viewed','negotiating','approved','refused','expired','cancelled')
      when 'viewed' then new.status in ('negotiating','approved','refused','expired','cancelled')
      when 'negotiating' then new.status in ('approved','refused','expired','cancelled')
      when 'approved' then new.status in ('converted','cancelled')
      else false
    end;
    if not allowed_transition then raise exception 'Transição de orçamento inválida'; end if;
    if new.status = 'converted' and new.sale_id is null then raise exception 'Orçamento convertido precisa de venda'; end if;
    if new.status = 'approved' then new.approved_at := coalesce(new.approved_at, now()); end if;
    if new.status in ('refused','cancelled') then new.rejected_at := case when new.status = 'refused' then coalesce(new.rejected_at, now()) else new.rejected_at end; new.cancelled_at := case when new.status = 'cancelled' then coalesce(new.cancelled_at, now()) else new.cancelled_at end; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_validate_commercial on public.quotes;
create trigger quotes_validate_commercial before insert or update on public.quotes for each row execute function public.validate_quote_commercial();

alter table public.quotes enable row level security;
drop policy if exists company_isolation on public.quotes;
drop policy if exists quotes_select on public.quotes;
drop policy if exists quotes_insert on public.quotes;
drop policy if exists quotes_update on public.quotes;
drop policy if exists quotes_delete on public.quotes;
create policy quotes_select on public.quotes for select to authenticated using (public.is_company_member(company_id));
create policy quotes_insert on public.quotes for insert to authenticated with check (public.is_company_member(company_id));
create policy quotes_update on public.quotes for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
revoke delete on public.quotes from authenticated;
grant select, insert, update on public.quotes to authenticated;

create or replace function public.finalize_sale_from_quote(sale_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare company uuid := (sale_payload->>'company_id')::uuid; customer uuid := nullif(sale_payload->>'customer_id','')::uuid;
  sale_row public.sales; existing public.sales; item jsonb; product_row public.products; variant_row public.product_variants;
  normalized_items jsonb := '[]'::jsonb; subtotal_value numeric(14,2) := 0; cost_total numeric(14,2) := 0; total_value numeric(14,2);
  qty numeric; unit_price numeric; unit_cost numeric; variant uuid; commission_total numeric(14,2) := 0; commission_rate numeric(8,3) := 0; item_rate numeric := 0;
begin
  if auth.uid() is null or public.current_company_role(company) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para converter orçamento'; end if;
  if customer is not null and not exists (select 1 from public.customers where id = customer and company_id = company) then raise exception 'Cliente não pertence à empresa'; end if;
  select * into existing from public.sales where company_id = company and idempotency_key = sale_payload->>'idempotency_key';
  if existing.id is not null then return existing; end if;
  for item in select value from jsonb_array_elements(sale_payload->'items') loop
    qty := nullif(coalesce(item->>'qty', item->>'quantity'), '')::numeric;
    unit_price := nullif(coalesce(item->>'unit_price', item->>'price'), '')::numeric;
    unit_cost := nullif(coalesce(item->>'unit_cost', item->>'cost'), '')::numeric;
    if qty is null or qty <= 0 or unit_price is null or unit_price < 0 or unit_cost is null or unit_cost < 0 then raise exception 'Snapshot legado sem preço/custo confiável'; end if;
    variant := nullif(item->>'variant_id','')::uuid;
    select * into product_row from public.products where id = (item->>'product_id')::uuid and company_id = company and active for update;
    if product_row.id is null then raise exception 'Produto não encontrado'; end if;
    if coalesce(item->>'item_type','product') = 'service' then
      if variant is not null then raise exception 'Serviço não possui variação'; end if;
    elsif variant is not null then
      select * into variant_row from public.product_variants where id = variant and product_id = product_row.id and company_id = company and active for update;
      if variant_row.id is null or variant_row.stock < qty then raise exception 'Estoque insuficiente'; end if;
    elsif product_row.stock < qty then raise exception 'Estoque insuficiente';
    end if;
    item_rate := greatest(0, coalesce(product_row.commission_rate, 0));
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object('product_id', product_row.id, 'variant_id', variant, 'item_type', coalesce(item->>'item_type','product'), 'name', coalesce(item->>'name', product_row.name), 'qty', qty, 'price', round(unit_price,2), 'cost', round(unit_cost,2), 'total', round(qty * unit_price,2), 'commission_rate', item_rate));
    subtotal_value := subtotal_value + qty * unit_price; cost_total := cost_total + qty * unit_cost; commission_total := commission_total + round((qty * unit_price) * item_rate / 100, 2); commission_rate := commission_rate + item_rate;
  end loop;
  subtotal_value := round(subtotal_value, 2);
  total_value := greatest(0, round(subtotal_value - greatest(0, coalesce((sale_payload->>'discount')::numeric,0)) + greatest(0, coalesce((sale_payload->>'addition')::numeric,0)), 2));
  insert into public.sales(company_id, customer_id, status, items, subtotal, discount, addition, total, cost_total, profit, idempotency_key)
    values(company, customer, 'completed', normalized_items, subtotal_value, greatest(0, coalesce((sale_payload->>'discount')::numeric,0)), greatest(0, coalesce((sale_payload->>'addition')::numeric,0)), total_value, round(cost_total,2), total_value-round(cost_total,2), sale_payload->>'idempotency_key') returning * into sale_row;
  for item in select value from jsonb_array_elements(normalized_items) loop
    qty := (item->>'qty')::numeric; variant := nullif(item->>'variant_id','')::uuid;
    if item->>'item_type' <> 'service' then
      if variant is null then update public.products set stock = stock - qty, updated_at = now() where id = (item->>'product_id')::uuid and company_id = company; else update public.product_variants set stock = stock - qty, updated_at = now() where id = variant and company_id = company; end if;
      insert into public.stock_movements(company_id, product_id, variant_id, sale_id, type, quantity, reason) values(company, (item->>'product_id')::uuid, variant, sale_row.id, 'out', qty, 'Venda convertida de orçamento');
    end if;
    insert into public.sale_items(company_id, sale_id, product_id, variant_id, quantity, price, cost) values(company, sale_row.id, (item->>'product_id')::uuid, variant, qty, (item->>'price')::numeric, (item->>'cost')::numeric);
  end loop;
  insert into public.financial_entries(company_id, sale_id, type, status, description, amount, due_date, paid_date) values(company, sale_row.id, 'receivable', 'paid', 'Venda convertida de orçamento', total_value, current_date, current_date);
  if customer is not null then update public.customers set total_purchased = total_purchased + total_value, sale_count = sale_count + 1, avg_ticket = round((total_purchased + total_value)/(sale_count + 1),2), last_purchase_date = current_date, updated_at = now() where id = customer and company_id = company; end if;
  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data) values(company, auth.uid(), 'quote.converted', 'QuoteSale', sale_row.id, to_jsonb(sale_row));
  return sale_row;
end;
$$;

create or replace function public.approve_quote(target_quote uuid)
returns public.quotes
language plpgsql
security invoker
set search_path = public
as $$
declare result public.quotes;
begin
  select * into result from public.quotes where id = target_quote and public.is_company_member(company_id) for update;
  if result.id is null then raise exception 'Orçamento não encontrado'; end if;
  if result.status in ('converted','cancelled','refused','expired') then raise exception 'Transição de orçamento inválida'; end if;
  update public.quotes set status = 'approved', approved_at = now(), updated_at = now() where id = target_quote returning * into result;
  return result;
end;
$$;

create or replace function public.convert_quote_to_sale(target_quote uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare quote_row public.quotes; result public.sales; payload jsonb;
begin
  select * into quote_row from public.quotes where id = target_quote for update;
  if quote_row.id is null or not public.is_company_member(quote_row.company_id) then raise exception 'Orçamento não encontrado'; end if;
  if public.current_company_role(quote_row.company_id) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para converter orçamento'; end if;
  if quote_row.sale_id is not null then select * into result from public.sales where id = quote_row.sale_id and company_id = quote_row.company_id; if result.id is not null then return result; end if; end if;
  if quote_row.status <> 'approved' then raise exception 'Orçamento precisa estar aprovado'; end if;
  if quote_row.valid_until is not null and quote_row.valid_until < current_date then raise exception 'Orçamento expirado'; end if;
  if quote_row.items is null or exists (select 1 from jsonb_array_elements(quote_row.items) item where coalesce(item->>'unit_price', item->>'price') is null or coalesce(item->>'unit_cost', item->>'cost') is null) then raise exception 'Orçamento legado exige revisão humana'; end if;
  payload := jsonb_build_object('company_id', quote_row.company_id, 'customer_id', quote_row.customer_id, 'items', quote_row.items, 'discount', quote_row.discount, 'addition', quote_row.addition, 'idempotency_key', 'quote:' || quote_row.id);
  result := public.finalize_sale_from_quote(payload);
  update public.quotes set status = 'converted', sale_id = result.id, converted_at = coalesce(converted_at, now()), updated_at = now() where id = quote_row.id and company_id = quote_row.company_id and sale_id is null;
  if not found then select * into result from public.sales where id = quote_row.sale_id and company_id = quote_row.company_id; end if;
  return result;
end;
$$;

revoke all on function public.quote_items_normalize(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.finalize_sale_from_quote(jsonb) from public, anon, authenticated;
grant execute on function public.approve_quote(uuid) to authenticated;
grant execute on function public.convert_quote_to_sale(uuid) to authenticated;
-- Conceptual rollback: restore the prior quotes policies/grants and function,
-- trigger, and view definitions, then drop this migration's added columns and
-- indexes only after dependent code is disabled. Added quote snapshots, approval
-- states, and conversion timestamps are not recoverable from DDL rollback;
-- back up affected quotes first. Sales already created from quotes are separate
-- business records and must be reconciled, never deleted as an assumed inverse.
