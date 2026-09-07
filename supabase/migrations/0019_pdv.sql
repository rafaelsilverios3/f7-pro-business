-- ETAPA 19: campos e regras transacionais do PDV.
-- Revisar e aplicar manualmente no Supabase.

alter table public.products add column if not exists barcode text;
create index if not exists idx_products_company_barcode on public.products(company_id, barcode) where barcode is not null;
grant select on public.products to authenticated;

-- O preço e o custo são sempre lidos do produto dentro da transação.
-- O navegador pode sugerir valores, mas não consegue alterar a margem real.
create or replace function public.finalize_sale(sale_payload jsonb) returns public.sales
language plpgsql security invoker set search_path = public as $$
declare
  company uuid := (sale_payload->>'company_id')::uuid;
  customer uuid := nullif(sale_payload->>'customer_id','')::uuid;
  sale_row public.sales; item jsonb; product_row public.products; existing public.sales;
  normalized_items jsonb := '[]'::jsonb; subtotal numeric(14,2) := 0; cost_total numeric(14,2) := 0; total numeric(14,2);
  qty numeric; unit_price numeric; unit_cost numeric; item_rate numeric := 0; commission_total numeric(14,2) := 0; commission_rate numeric(8,3) := 0;
begin
  if auth.uid() is null or not public.is_company_member(company) then raise exception 'Usuário não pertence à empresa'; end if;
  if jsonb_typeof(sale_payload->'items') <> 'array' or jsonb_array_length(sale_payload->'items') = 0 then raise exception 'Venda sem itens'; end if;
  if nullif(sale_payload->>'idempotency_key','') is not null then
    select * into existing from public.sales where company_id = company and idempotency_key = sale_payload->>'idempotency_key';
    if existing.id is not null then return existing; end if;
  end if;
  for item in select * from jsonb_array_elements(sale_payload->'items') loop
    qty := (item->>'qty')::numeric;
    if qty <= 0 then raise exception 'Quantidade inválida'; end if;
    select * into product_row from public.products where id = (item->>'product_id')::uuid and company_id = company and active for update;
    if product_row.id is null or product_row.stock < qty then raise exception 'Estoque insuficiente'; end if;
    unit_price := greatest(0, coalesce(product_row.price, 0)); unit_cost := greatest(0, coalesce(product_row.cost, 0));
    item_rate := greatest(0, coalesce(product_row.commission_rate, 0));
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object('product_id', product_row.id, 'name', product_row.name, 'qty', qty, 'price', unit_price, 'cost', unit_cost, 'total', round(qty * unit_price, 2), 'commission_rate', item_rate));
    subtotal := subtotal + qty * unit_price; cost_total := cost_total + qty * unit_cost;
    commission_total := commission_total + round((qty * unit_price) * item_rate / 100, 2); commission_rate := commission_rate + item_rate;
  end loop;
  subtotal := round(subtotal, 2); cost_total := round(cost_total, 2);
  total := greatest(0, round(subtotal - greatest(0, coalesce((sale_payload->>'discount')::numeric,0)) + greatest(0, coalesce((sale_payload->>'addition')::numeric,0)), 2));
  insert into public.sales(company_id, customer_id, status, items, subtotal, discount, addition, total, cost_total, profit, idempotency_key)
    values(company, customer, 'completed', normalized_items, subtotal, greatest(0, coalesce((sale_payload->>'discount')::numeric,0)), greatest(0, coalesce((sale_payload->>'addition')::numeric,0)), total, cost_total, total-cost_total, nullif(sale_payload->>'idempotency_key','')) returning * into sale_row;
  for item in select * from jsonb_array_elements(normalized_items) loop
    qty := (item->>'qty')::numeric;
    update public.products set stock = stock - qty, updated_at = now() where id = (item->>'product_id')::uuid and company_id = company;
    insert into public.sale_items(company_id, sale_id, product_id, quantity, price, cost) values(company, sale_row.id, (item->>'product_id')::uuid, qty, (item->>'price')::numeric, (item->>'cost')::numeric);
    insert into public.stock_movements(company_id, product_id, sale_id, type, quantity, reason) values(company, (item->>'product_id')::uuid, sale_row.id, 'out', qty, 'Venda PDV');
  end loop;
  insert into public.financial_entries(company_id, sale_id, type, status, description, amount, due_date, paid_date) values(company, sale_row.id, 'receivable', 'paid', 'Venda PDV', total, current_date, current_date);
  if customer is not null then update public.customers set total_purchased = total_purchased + total, sale_count = sale_count + 1, avg_ticket = round((total_purchased + total) / (sale_count + 1), 2), last_purchase_date = current_date, updated_at = now() where id = customer and company_id = company; end if;
  if nullif(trim(sale_payload->>'seller'), '') is not null and commission_total > 0 then insert into public.commissions(company_id, sale_id, seller, rate, amount, status) values(company, sale_row.id, sale_payload->>'seller', commission_rate / jsonb_array_length(normalized_items), commission_total, 'pending'); end if;
  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data) values(company, auth.uid(), 'sale.finalized.pdv', 'Sale', sale_row.id, to_jsonb(sale_row));
  return sale_row;
end; $$;
