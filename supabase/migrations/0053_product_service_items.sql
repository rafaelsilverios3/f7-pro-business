-- Products and services share the catalog; services never affect inventory.
-- Apply manually after review. Conceptual rollback: set item_type back to
-- 'product' for all rows and restore the previous sale functions.

alter table public.products
  add column if not exists item_type text not null default 'product',
  add column if not exists duration_minutes integer;

alter table public.products drop constraint if exists products_item_type_check;
alter table public.products add constraint products_item_type_check check (item_type in ('product','service'));
create index if not exists idx_products_company_item_type on public.products(company_id,item_type);

create or replace function public.finalize_sale(sale_payload jsonb) returns public.sales
language plpgsql security invoker set search_path = public as $$
declare
  company uuid := (sale_payload->>'company_id')::uuid;
  customer uuid := nullif(sale_payload->>'customer_id','')::uuid;
  sale_row public.sales; item jsonb; product_row public.products; variant_row public.product_variants; existing public.sales;
  normalized_items jsonb := '[]'::jsonb; subtotal numeric(14,2):=0; cost_total numeric(14,2):=0; total numeric(14,2);
  qty numeric; unit_price numeric; unit_cost numeric; variant uuid; item_rate numeric:=0; commission_total numeric(14,2):=0; commission_rate numeric(8,3):=0; service boolean;
begin
  if auth.uid() is null or public.current_company_role(company) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para finalizar venda'; end if;
  if jsonb_typeof(sale_payload->'items') <> 'array' or jsonb_array_length(sale_payload->'items') = 0 then raise exception 'Venda sem itens'; end if;
  if customer is not null and not exists (select 1 from public.customers where id=customer and company_id=company) then raise exception 'Cliente não pertence à empresa'; end if;
  if nullif(sale_payload->>'idempotency_key','') is not null then select * into existing from public.sales where company_id=company and idempotency_key=sale_payload->>'idempotency_key'; if existing.id is not null then return existing; end if; end if;
  for item in select * from jsonb_array_elements(sale_payload->'items') loop
    qty := (item->>'qty')::numeric; variant := nullif(item->>'variant_id','')::uuid;
    select * into product_row from public.products where id=(item->>'product_id')::uuid and company_id=company and active for update;
    if product_row.id is null then raise exception 'Item não encontrado'; end if;
    service := product_row.item_type = 'service';
    if service and variant is not null then raise exception 'Serviço não possui variação de estoque'; end if;
    if not service and variant is not null then select * into variant_row from public.product_variants where id=variant and product_id=product_row.id and company_id=company and active for update; if variant_row.id is null then raise exception 'Variação não encontrada'; end if; if variant_row.stock < qty then raise exception 'Estoque insuficiente'; end if; end if;
    if qty <= 0 or (not service and variant is null and product_row.stock < qty) then raise exception 'Estoque insuficiente'; end if;
    unit_price := greatest(0, coalesce(case when variant is null then product_row.price else variant_row.price end, product_row.price, 0));
    unit_cost := greatest(0, coalesce(case when variant is null then product_row.cost else variant_row.cost end, product_row.cost, 0));
    item_rate := greatest(0, coalesce(product_row.commission_rate,0));
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object('product_id',product_row.id,'item_type',case when service then 'service' else 'product' end,'variant_id',variant,'linked_product_id',nullif(item->>'linked_product_id',''),'description',coalesce(nullif(item->>'description',''),product_row.name),'name',product_row.name || case when variant is null then '' else ' · ' || variant_row.name end,'qty',qty,'price',unit_price,'cost',unit_cost,'total',round(qty*unit_price,2),'commission_rate',item_rate));
    subtotal:=subtotal+qty*unit_price; cost_total:=cost_total+qty*unit_cost; commission_total:=commission_total+round((qty*unit_price)*item_rate/100,2); commission_rate:=commission_rate+item_rate;
  end loop;
  subtotal:=round(subtotal,2); cost_total:=round(cost_total,2); total:=greatest(0,round(subtotal-greatest(0,coalesce((sale_payload->>'discount')::numeric,0))+greatest(0,coalesce((sale_payload->>'addition')::numeric,0)),2));
  insert into public.sales(company_id,customer_id,status,items,subtotal,discount,addition,total,cost_total,profit,idempotency_key) values(company,customer,'completed',normalized_items,subtotal,greatest(0,coalesce((sale_payload->>'discount')::numeric,0)),greatest(0,coalesce((sale_payload->>'addition')::numeric,0)),total,cost_total,total-cost_total,nullif(sale_payload->>'idempotency_key','')) returning * into sale_row;
  for item in select * from jsonb_array_elements(normalized_items) loop
    qty:=(item->>'qty')::numeric; variant:=nullif(item->>'variant_id','')::uuid;
    if item->>'item_type' = 'product' then
      if variant is null then update public.products set stock=stock-qty,updated_at=now() where id=(item->>'product_id')::uuid and company_id=company; else update public.product_variants set stock=stock-qty,updated_at=now() where id=variant and company_id=company; end if;
      insert into public.stock_movements(company_id,product_id,variant_id,sale_id,type,quantity,reason) values(company,(item->>'product_id')::uuid,variant,sale_row.id,'out',qty,'Venda');
    end if;
    insert into public.sale_items(company_id,sale_id,product_id,variant_id,quantity,price,cost) values(company,sale_row.id,(item->>'product_id')::uuid,variant,qty,(item->>'price')::numeric,(item->>'cost')::numeric);
  end loop;
  insert into public.financial_entries(company_id,sale_id,type,status,description,amount,due_date,paid_date) values(company,sale_row.id,'receivable','paid','Venda',total,current_date,current_date);
  if customer is not null then update public.customers set total_purchased=total_purchased+total,sale_count=sale_count+1,avg_ticket=round((total_purchased+total)/(sale_count+1),2),last_purchase_date=current_date,updated_at=now() where id=customer and company_id=company; end if;
  if nullif(trim(sale_payload->>'seller'),'') is not null and commission_total>0 then insert into public.commissions(company_id,sale_id,seller,rate,amount,status) values(company,sale_row.id,sale_payload->>'seller',commission_rate/jsonb_array_length(normalized_items),commission_total,'pending'); end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data) values(company,auth.uid(),'sale.finalized','Sale',sale_row.id,to_jsonb(sale_row)); return sale_row;
end; $$;

create or replace function public.cancel_sale(target_sale uuid) returns public.sales
language plpgsql security invoker set search_path = public as $$
declare result public.sales; previous_sale public.sales; item jsonb; variant uuid;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into result from public.sales where id=target_sale and public.is_company_member(company_id) for update;
  if result.id is null then raise exception 'Venda não encontrada'; end if;
  if public.current_company_role(result.company_id) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para cancelar venda'; end if;
  if result.status='cancelled' then return result; end if;
  previous_sale := result;
  for item in select * from jsonb_array_elements(result.items) loop
    if coalesce(item->>'item_type','product') = 'product' then
      variant:=nullif(item->>'variant_id','')::uuid;
      if variant is null then update public.products set stock=stock+(item->>'qty')::numeric where id=(item->>'product_id')::uuid and company_id=result.company_id; else update public.product_variants set stock=stock+(item->>'qty')::numeric,updated_at=now() where id=variant and company_id=result.company_id; end if;
      insert into public.stock_movements(company_id,product_id,variant_id,sale_id,type,quantity,reason) values(result.company_id,(item->>'product_id')::uuid,variant,result.id,'in',(item->>'qty')::numeric,'Estorno de venda');
    end if;
  end loop;
  update public.financial_entries set status='cancelled' where sale_id=result.id and status<>'cancelled'; update public.commissions set status='reversed' where sale_id=result.id and status<>'reversed';
  if result.customer_id is not null then update public.customers set total_purchased=greatest(0,total_purchased-result.total), sale_count=greatest(0,sale_count-1), avg_ticket=case when sale_count > 1 then round(greatest(0,total_purchased-result.total)/greatest(1,sale_count-1),2) else 0 end, last_purchase_date=(select max(s.sale_date) from public.sales s where s.company_id=result.company_id and s.customer_id=result.customer_id and s.id<>result.id and s.status='completed'), updated_at=now() where id=result.customer_id and company_id=result.company_id; end if;
  update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=result.id returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(result.company_id,auth.uid(),'sale.cancelled','Sale',result.id,to_jsonb(previous_sale),to_jsonb(result)); return result;
end; $$;
