-- Comissão e cancelamento são mantidos na mesma transação da venda.
alter table products add column if not exists commission_rate numeric(8,3) not null default 0;
alter table commissions drop constraint if exists commissions_status_check;
alter table commissions add constraint commissions_status_check check (status in ('pending', 'paid', 'reversed'));

create or replace function finalize_sale(sale_payload jsonb) returns sales
language plpgsql security invoker set search_path = public as $$
declare
  company uuid := (sale_payload->>'company_id')::uuid;
  customer uuid := nullif(sale_payload->>'customer_id','')::uuid;
  sale_row sales; item jsonb; product_row products; existing sales;
  subtotal numeric(14,2) := 0; cost_total numeric(14,2) := 0; total numeric(14,2);
  qty numeric; unit_price numeric; unit_cost numeric; item_rate numeric := 0;
  commission_total numeric(14,2) := 0; commission_rate numeric(8,3) := 0;
begin
  if auth.uid() is null or not is_company_member(company) then raise exception 'Usuário não pertence à empresa'; end if;
  if jsonb_typeof(sale_payload->'items') <> 'array' or jsonb_array_length(sale_payload->'items') = 0 then raise exception 'Venda sem itens'; end if;
  if nullif(sale_payload->>'idempotency_key','') is not null then
    select * into existing from sales where company_id = company and idempotency_key = sale_payload->>'idempotency_key';
    if existing.id is not null then return existing; end if;
  end if;
  for item in select * from jsonb_array_elements(sale_payload->'items') loop
    qty := (item->>'qty')::numeric; unit_price := coalesce((item->>'price')::numeric, 0); unit_cost := coalesce((item->>'cost')::numeric, 0);
    if qty <= 0 or unit_price < 0 or unit_cost < 0 then raise exception 'Item inválido'; end if;
    select * into product_row from products where id = (item->>'product_id')::uuid and company_id = company for update;
    if product_row.id is null or product_row.stock < qty then raise exception 'Estoque insuficiente'; end if;
    subtotal := subtotal + qty * unit_price; cost_total := cost_total + qty * unit_cost;
    item_rate := greatest(0, coalesce(nullif(item->>'commission_rate','')::numeric, product_row.commission_rate, 0));
    commission_total := commission_total + round((qty * unit_price) * item_rate / 100, 2);
    commission_rate := commission_rate + item_rate;
  end loop;
  subtotal := round(subtotal, 2); cost_total := round(cost_total, 2);
  total := greatest(0, round(subtotal - coalesce((sale_payload->>'discount')::numeric,0) + coalesce((sale_payload->>'addition')::numeric,0), 2));
  insert into sales(company_id, customer_id, status, items, subtotal, discount, addition, total, cost_total, profit, idempotency_key)
    values(company, customer, 'completed', sale_payload->'items', subtotal, coalesce((sale_payload->>'discount')::numeric,0), coalesce((sale_payload->>'addition')::numeric,0), total, cost_total, total-cost_total, nullif(sale_payload->>'idempotency_key','')) returning * into sale_row;
  for item in select * from jsonb_array_elements(sale_payload->'items') loop
    qty := (item->>'qty')::numeric; unit_price := (item->>'price')::numeric; unit_cost := coalesce((item->>'cost')::numeric,0);
    update products set stock = stock - qty where id = (item->>'product_id')::uuid and company_id = company;
    insert into sale_items(company_id, sale_id, product_id, quantity, price, cost) values(company, sale_row.id, (item->>'product_id')::uuid, qty, unit_price, unit_cost);
    insert into stock_movements(company_id, product_id, sale_id, type, quantity, reason) values(company, (item->>'product_id')::uuid, sale_row.id, 'out', qty, 'Venda');
  end loop;
  insert into financial_entries(company_id, sale_id, type, status, description, amount, due_date, paid_date) values(company, sale_row.id, 'receivable', 'paid', 'Venda', total, current_date, current_date);
  if customer is not null then update customers set total_purchased = total_purchased + total, sale_count = sale_count + 1, avg_ticket = round((total_purchased + total) / (sale_count + 1), 2), updated_at = now() where id = customer and company_id = company; end if;
  if nullif(trim(sale_payload->>'seller'), '') is not null and commission_total > 0 then
    insert into commissions(company_id, sale_id, seller, rate, amount, status) values(company, sale_row.id, sale_payload->>'seller', commission_rate / jsonb_array_length(sale_payload->'items'), commission_total, 'pending');
  end if;
  insert into audit_logs(company_id, user_id, action, entity, entity_id, new_data) values(company, auth.uid(), 'sale.finalized', 'Sale', sale_row.id, to_jsonb(sale_row));
  return sale_row;
end; $$;

create or replace function cancel_sale(target_sale uuid) returns sales
language plpgsql security invoker set search_path = public as $$
declare result sales; item jsonb;
begin
  select * into result from sales where id = target_sale and is_company_member(company_id) for update;
  if result.id is null then raise exception 'Venda não encontrada'; end if;
  if result.status = 'cancelled' then return result; end if;
  for item in select * from jsonb_array_elements(result.items) loop
    update products set stock = stock + (item->>'qty')::numeric where id = (item->>'product_id')::uuid and company_id = result.company_id;
    insert into stock_movements(company_id,product_id,sale_id,type,quantity,reason) values(result.company_id,(item->>'product_id')::uuid,result.id,'in',(item->>'qty')::numeric,'Estorno de venda');
  end loop;
  update financial_entries set status = 'cancelled' where sale_id = result.id and status <> 'cancelled';
  update commissions set status = 'reversed' where sale_id = result.id and status <> 'reversed';
  if result.customer_id is not null then update customers set total_purchased = greatest(0,total_purchased-result.total), sale_count = greatest(0,sale_count-1), avg_ticket = case when sale_count > 1 then round((total_purchased-result.total)/(sale_count-1),2) else 0 end where id = result.customer_id and company_id = result.company_id; end if;
  update sales set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = result.id returning * into result;
  insert into audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(result.company_id,auth.uid(),'sale.cancelled','Sale',result.id,to_jsonb(result),to_jsonb(result));
  return result;
end; $$;

grant select, insert, update on table products, commissions to authenticated;
