-- ETAPA 21: catálogo rico, imagens, atributos e variações.
-- Revisar e aplicar manualmente no Supabase.

alter table public.products
  add column if not exists subcategory text,
  add column if not exists brand text,
  add column if not exists description text,
  add column if not exists unit text not null default 'un',
  add column if not exists short_description text,
  add column if not exists full_description text,
  add column if not exists material text,
  add column if not exists color text,
  add column if not exists size text,
  add column if not exists model text,
  add column if not exists weight numeric(14,3),
  add column if not exists dimensions jsonb not null default '{}'::jsonb,
  add column if not exists tags text[] not null default '{}',
  add column if not exists keywords text[] not null default '{}',
  add column if not exists featured boolean not null default false;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, storage_path text not null,
  alt_text text, sort_order integer not null default 0, is_primary boolean not null default false,
  created_at timestamptz not null default now(), unique(company_id, storage_path)
);
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, name text not null,
  sku text, barcode text, attributes jsonb not null default '{}'::jsonb, stock numeric(14,3) not null default 0,
  price numeric(14,2), cost numeric(14,2), image_path text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id, sku)
);
create table if not exists public.product_attributes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, name text not null, value text not null,
  attribute_type text not null default 'text', created_at timestamptz not null default now()
);

alter table public.sale_items add column if not exists variant_id uuid;
alter table public.stock_movements add column if not exists variant_id uuid;
create unique index if not exists products_company_id_key on public.products(company_id,id);
create unique index if not exists product_variants_company_id_key on public.product_variants(company_id,id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_images_company_product_fk') then alter table public.product_images add constraint product_images_company_product_fk foreign key (company_id,product_id) references public.products(company_id,id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'product_variants_company_product_fk') then alter table public.product_variants add constraint product_variants_company_product_fk foreign key (company_id,product_id) references public.products(company_id,id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'product_attributes_company_product_fk') then alter table public.product_attributes add constraint product_attributes_company_product_fk foreign key (company_id,product_id) references public.products(company_id,id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'sale_items_company_variant_fk') then alter table public.sale_items add constraint sale_items_company_variant_fk foreign key (company_id,variant_id) references public.product_variants(company_id,id); end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_company_variant_fk') then alter table public.stock_movements add constraint stock_movements_company_variant_fk foreign key (company_id,variant_id) references public.product_variants(company_id,id); end if;
end $$;
create index if not exists idx_product_variants_company_product on public.product_variants(company_id, product_id);
create index if not exists idx_product_variants_company_barcode on public.product_variants(company_id, barcode) where barcode is not null;
create index if not exists idx_product_images_company_product on public.product_images(company_id, product_id, sort_order);

do $$ declare table_name text; begin foreach table_name in array array['product_images','product_variants','product_attributes'] loop execute format('alter table public.%I enable row level security', table_name); execute format('drop policy if exists catalog_company_isolation on public.%I', table_name); execute format('drop policy if exists catalog_select on public.%I', table_name); execute format('drop policy if exists catalog_insert on public.%I', table_name); execute format('drop policy if exists catalog_update on public.%I', table_name); execute format('drop policy if exists catalog_delete on public.%I', table_name); execute format('create policy catalog_select on public.%I for select to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial'',''vendedor'',''estoque'',''atendimento''))', table_name); execute format('create policy catalog_insert on public.%I for insert to authenticated with check (public.current_company_role(company_id) in (''admin'',''gestor''))', table_name); execute format('create policy catalog_update on public.%I for update to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'')) with check (public.current_company_role(company_id) in (''admin'',''gestor''))', table_name); execute format('create policy catalog_delete on public.%I for delete to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor''))', table_name); execute format('grant select, insert, update, delete on public.%I to authenticated', table_name); end loop; end $$;

insert into storage.buckets (id, name, public) values ('product-catalog', 'product-catalog', false) on conflict (id) do nothing;
drop policy if exists product_catalog_select on storage.objects;
create policy product_catalog_select on storage.objects for select using (bucket_id = 'product-catalog' and public.is_company_member((storage.foldername(name))[1]::uuid));
drop policy if exists product_catalog_insert on storage.objects;
create policy product_catalog_insert on storage.objects for insert with check (bucket_id = 'product-catalog' and public.current_company_role((storage.foldername(name))[1]::uuid) in ('admin','gestor'));
drop policy if exists product_catalog_update on storage.objects;
create policy product_catalog_update on storage.objects for update using (bucket_id = 'product-catalog' and public.current_company_role((storage.foldername(name))[1]::uuid) in ('admin','gestor'));
drop policy if exists product_catalog_delete on storage.objects;
create policy product_catalog_delete on storage.objects for delete using (bucket_id = 'product-catalog' and public.current_company_role((storage.foldername(name))[1]::uuid) in ('admin','gestor'));

create or replace function public.apply_variant_price(target_company uuid, target_variant uuid, new_price numeric, pricing_data jsonb default '{}'::jsonb)
returns public.product_variants language plpgsql security definer set search_path = public as $$
declare result public.product_variants; previous public.product_variants; payload jsonb := coalesce(pricing_data, '{}'::jsonb);
begin
  if auth.uid() is null or public.current_company_role(target_company) not in ('admin','gestor') then raise exception 'Sem permissão para aplicar preço'; end if;
  if jsonb_typeof(payload) <> 'object' then raise exception 'Dados de precificação inválidos'; end if;
  if payload ? 'realCost' and (payload->>'realCost')::numeric < 0 then raise exception 'Custo real inválido'; end if;
  if payload ? 'variableRate' and ((payload->>'variableRate')::numeric < 0 or (payload->>'variableRate')::numeric >= 100) then raise exception 'Taxa variável inválida'; end if;
  if payload ? 'targetMargin' and ((payload->>'targetMargin')::numeric < 0 or (payload->>'targetMargin')::numeric >= 100) then raise exception 'Margem alvo inválida'; end if;
  if payload ? 'minimumPrice' and (payload->>'minimumPrice')::numeric < 0 then raise exception 'Preço mínimo inválido'; end if;
  if payload ? 'minimumPrice' and (payload->>'minimumPrice')::numeric > 0 and new_price < (payload->>'minimumPrice')::numeric then raise exception 'Preço abaixo do mínimo'; end if;
  select * into previous from public.product_variants where id = target_variant and company_id = target_company for update;
  if previous.id is null or new_price is null or new_price::text in ('NaN','Infinity','-Infinity') or new_price <= 0 or abs(new_price) > 9999999999999.99 then raise exception 'Variação ou preço inválido'; end if;
  update public.product_variants set price = round(new_price,2), updated_at = now() where id = target_variant returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(target_company,auth.uid(),'variant.price_applied','ProductVariant',target_variant,to_jsonb(previous),to_jsonb(result));
  return result;
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
    variant:=nullif(item->>'variant_id','')::uuid;
    if variant is null then update public.products set stock=stock+(item->>'qty')::numeric where id=(item->>'product_id')::uuid and company_id=result.company_id; else update public.product_variants set stock=stock+(item->>'qty')::numeric,updated_at=now() where id=variant and company_id=result.company_id; end if;
    insert into public.stock_movements(company_id,product_id,variant_id,sale_id,type,quantity,reason) values(result.company_id,(item->>'product_id')::uuid,variant,result.id,'in',(item->>'qty')::numeric,'Estorno de venda');
  end loop;
  update public.financial_entries set status='cancelled' where sale_id=result.id and status<>'cancelled'; update public.commissions set status='reversed' where sale_id=result.id and status<>'reversed';
  if result.customer_id is not null then
    update public.customers set total_purchased=greatest(0,total_purchased-result.total), sale_count=greatest(0,sale_count-1), avg_ticket=case when sale_count > 1 then round(greatest(0,total_purchased-result.total)/greatest(1,sale_count-1),2) else 0 end, last_purchase_date=(select max(s.sale_date) from public.sales s where s.company_id=result.company_id and s.customer_id=result.customer_id and s.id<>result.id and s.status='completed'), updated_at=now() where id=result.customer_id and company_id=result.company_id;
  end if;
  update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=result.id returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(result.company_id,auth.uid(),'sale.cancelled','Sale',result.id,to_jsonb(previous_sale),to_jsonb(result)); return result;
end; $$;
revoke all on function public.apply_variant_price(uuid,uuid,numeric,jsonb) from public, anon;
grant execute on function public.apply_variant_price(uuid,uuid,numeric,jsonb) to authenticated;

-- Finalização transacional continua no mesmo fluxo e respeita estoque/preço da variação.
create or replace function public.finalize_sale(sale_payload jsonb) returns public.sales
language plpgsql security invoker set search_path = public as $$
declare company uuid := (sale_payload->>'company_id')::uuid; customer uuid := nullif(sale_payload->>'customer_id','')::uuid; sale_row public.sales; item jsonb; product_row public.products; variant_row public.product_variants; existing public.sales; normalized_items jsonb := '[]'::jsonb; subtotal numeric(14,2):=0; cost_total numeric(14,2):=0; total numeric(14,2); qty numeric; unit_price numeric; unit_cost numeric; variant uuid; item_rate numeric:=0; commission_total numeric(14,2):=0; commission_rate numeric(8,3):=0;
begin
  if auth.uid() is null or public.current_company_role(company) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para finalizar venda'; end if;
  if jsonb_typeof(sale_payload->'items') <> 'array' or jsonb_array_length(sale_payload->'items') = 0 then raise exception 'Venda sem itens'; end if;
  if customer is not null and not exists (select 1 from public.customers where id=customer and company_id=company) then raise exception 'Cliente não pertence à empresa'; end if;
  if nullif(sale_payload->>'idempotency_key','') is not null then select * into existing from public.sales where company_id=company and idempotency_key=sale_payload->>'idempotency_key'; if existing.id is not null then return existing; end if; end if;
  for item in select * from jsonb_array_elements(sale_payload->'items') loop
    qty := (item->>'qty')::numeric; variant := nullif(item->>'variant_id','')::uuid;
    select * into product_row from public.products where id=(item->>'product_id')::uuid and company_id=company and active for update;
    if product_row.id is null then raise exception 'Produto não encontrado'; end if;
    if variant is not null then select * into variant_row from public.product_variants where id=variant and product_id=product_row.id and company_id=company and active for update; if variant_row.id is null then raise exception 'Variação não encontrada'; end if; if variant_row.stock < qty then raise exception 'Estoque insuficiente'; end if; end if;
    if qty <= 0 or (variant is null and product_row.stock < qty) then raise exception 'Estoque insuficiente'; end if;
    unit_price := greatest(0, coalesce(case when variant is null then product_row.price else variant_row.price end, product_row.price, 0)); unit_cost := greatest(0, coalesce(case when variant is null then product_row.cost else variant_row.cost end, product_row.cost, 0)); item_rate := greatest(0, coalesce(product_row.commission_rate,0));
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object('product_id',product_row.id,'variant_id',variant,'name',product_row.name || case when variant is null then '' else ' · ' || variant_row.name end,'qty',qty,'price',unit_price,'cost',unit_cost,'total',round(qty*unit_price,2),'commission_rate',item_rate)); subtotal:=subtotal+qty*unit_price; cost_total:=cost_total+qty*unit_cost; commission_total:=commission_total+round((qty*unit_price)*item_rate/100,2); commission_rate:=commission_rate+item_rate;
  end loop;
  subtotal:=round(subtotal,2); cost_total:=round(cost_total,2); total:=greatest(0,round(subtotal-greatest(0,coalesce((sale_payload->>'discount')::numeric,0))+greatest(0,coalesce((sale_payload->>'addition')::numeric,0)),2));
  insert into public.sales(company_id,customer_id,status,items,subtotal,discount,addition,total,cost_total,profit,idempotency_key) values(company,customer,'completed',normalized_items,subtotal,greatest(0,coalesce((sale_payload->>'discount')::numeric,0)),greatest(0,coalesce((sale_payload->>'addition')::numeric,0)),total,cost_total,total-cost_total,nullif(sale_payload->>'idempotency_key','')) returning * into sale_row;
  for item in select * from jsonb_array_elements(normalized_items) loop qty:=(item->>'qty')::numeric; variant:=nullif(item->>'variant_id','')::uuid; if variant is null then update public.products set stock=stock-qty,updated_at=now() where id=(item->>'product_id')::uuid and company_id=company; else update public.product_variants set stock=stock-qty,updated_at=now() where id=variant and company_id=company; end if; insert into public.sale_items(company_id,sale_id,product_id,variant_id,quantity,price,cost) values(company,sale_row.id,(item->>'product_id')::uuid,variant,qty,(item->>'price')::numeric,(item->>'cost')::numeric); insert into public.stock_movements(company_id,product_id,variant_id,sale_id,type,quantity,reason) values(company,(item->>'product_id')::uuid,variant,sale_row.id,'out',qty,'Venda'); end loop;
  insert into public.financial_entries(company_id,sale_id,type,status,description,amount,due_date,paid_date) values(company,sale_row.id,'receivable','paid','Venda',total,current_date,current_date); if customer is not null then update public.customers set total_purchased=total_purchased+total,sale_count=sale_count+1,avg_ticket=round((total_purchased+total)/(sale_count+1),2),last_purchase_date=current_date,updated_at=now() where id=customer and company_id=company; end if; if nullif(trim(sale_payload->>'seller'),'') is not null and commission_total>0 then insert into public.commissions(company_id,sale_id,seller,rate,amount,status) values(company,sale_row.id,sale_payload->>'seller',commission_rate/jsonb_array_length(normalized_items),commission_total,'pending'); end if; insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data) values(company,auth.uid(),'sale.finalized','Sale',sale_row.id,to_jsonb(sale_row)); return sale_row;
end; $$;
