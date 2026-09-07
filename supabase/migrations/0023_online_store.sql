-- ETAPA 23: loja pública por empresa. Revisar e aplicar manualmente no Supabase.
alter table public.companies add column if not exists store_slug text;
alter table public.companies add column if not exists store_enabled boolean not null default false;
create unique index if not exists companies_store_slug_unique on public.companies (lower(store_slug)) where store_slug is not null;
drop policy if exists company_store_manage on public.companies;
create policy company_store_manage on public.companies for update to authenticated using (public.current_company_role(id) in ('admin','gestor','comercial')) with check (public.current_company_role(id) in ('admin','gestor','comercial'));
grant update (store_slug, store_enabled) on public.companies to authenticated;

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id), customer_name text not null, customer_email text, customer_phone text,
  items jsonb not null default '[]'::jsonb, total numeric(14,2) not null default 0, status text not null default 'pending',
  origin text not null default 'loja_online', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists customers_company_id_key on public.customers(company_id,id);
alter table public.store_orders drop constraint if exists store_orders_total_check;
alter table public.store_orders add constraint store_orders_total_check check (total >= 0);
alter table public.store_orders drop constraint if exists store_orders_status_check;
alter table public.store_orders add constraint store_orders_status_check check (status = 'pending');
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'store_orders_company_customer_fk') then alter table public.store_orders add constraint store_orders_company_customer_fk foreign key (company_id,customer_id) references public.customers(company_id,id); end if;
end $$;
alter table public.store_orders enable row level security;
drop policy if exists store_orders_company_select on public.store_orders;
create policy store_orders_company_select on public.store_orders for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
drop policy if exists store_orders_company_update on public.store_orders;
create policy store_orders_company_update on public.store_orders for update to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));
grant select, update on public.store_orders to authenticated;

-- Apenas dados comerciais públicos são retornados. Custos, margens e fornecedores ficam fora desta função.
create or replace function public.get_public_storefront(p_slug text) returns jsonb
language sql security definer set search_path = public
as $$
  select case when c.id is null then '{}'::jsonb else jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'logo_path', c.logo_path),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category', p.category,
          'subcategory', p.subcategory,
          'short_description', coalesce(p.short_description, p.description, ''),
          'price', p.price,
          'stock', p.stock,
          'images', coalesce((
            select jsonb_agg(
              jsonb_build_object('storage_path', i.storage_path, 'alt_text', i.alt_text)
              order by i.sort_order
            )
            from public.product_images i
            where i.company_id = p.company_id and i.product_id = p.id
          ), '[]'::jsonb),
          'variants', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', v.id, 'name', v.name, 'price', coalesce(v.price, p.price), 'stock', v.stock, 'attributes', v.attributes)
              order by v.created_at
            )
            from public.product_variants v
            where v.company_id = p.company_id and v.product_id = p.id and v.active and v.stock > 0 and coalesce(v.price, p.price) > 0
          ), '[]'::jsonb)
        )
        order by p.featured desc, p.name
      )
      from public.products p
      where p.company_id = c.id
        and p.active
        and (p.price > 0 or exists (
          select 1 from public.product_variants v
          where v.company_id = p.company_id and v.product_id = p.id and v.active and v.stock > 0 and coalesce(v.price, p.price) > 0
        ))
        and (p.stock > 0 or exists (
          select 1 from public.product_variants v
          where v.company_id = p.company_id and v.product_id = p.id and v.active and v.stock > 0
        ))
    ), '[]'::jsonb)
  ) end
  from public.companies c
  where c.store_enabled and lower(c.store_slug) = lower(trim(p_slug))
  limit 1;
$$;
revoke all on function public.get_public_storefront(text) from public;
grant execute on function public.get_public_storefront(text) to anon, authenticated;

create or replace function public.create_public_store_order(p_slug text, p_customer jsonb, p_items jsonb) returns public.store_orders
language plpgsql security definer set search_path = public
as $$
declare target_company_id uuid; customer_id uuid; order_row public.store_orders; input_item jsonb; product_row public.products; variant_row public.product_variants; normalized jsonb := '[]'::jsonb; total numeric(14,2) := 0; qty numeric; unit_price numeric; product_id_text text; variant_id_text text; quantity_text text; product_id_value uuid; variant_id_value uuid;
begin
  select id into target_company_id from public.companies where store_enabled and lower(store_slug)=lower(trim(p_slug)) limit 1;
  if target_company_id is null then raise exception 'Loja não encontrada'; end if;
  if p_slug is null or length(trim(p_slug)) = 0 or length(trim(p_slug)) > 120 then raise exception 'Slug inválido'; end if;
  if jsonb_typeof(p_customer) <> 'object' or octet_length(coalesce(p_customer::text,'')) > 4096 then raise exception 'Cliente inválido'; end if;
  if coalesce(trim(p_customer->>'name'),'')='' or length(trim(p_customer->>'name')) > 160 then raise exception 'Nome do cliente inválido'; end if;
  if length(coalesce(trim(p_customer->>'email'),'')) > 254 or length(coalesce(trim(p_customer->>'phone'),'')) > 40 then raise exception 'Contato do cliente inválido'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 or octet_length(coalesce(p_items::text,'')) > 65536 then raise exception 'Itens do pedido inválidos'; end if;
  select id into customer_id from public.customers c where c.company_id=target_company_id and lower(coalesce(c.email,''))=lower(coalesce(p_customer->>'email','')) and coalesce(p_customer->>'email','')<>'' limit 1;
  if customer_id is null then insert into public.customers(company_id,name,email,phone) values(target_company_id,trim(p_customer->>'name'),nullif(trim(p_customer->>'email'),''),nullif(trim(p_customer->>'phone'),'')) returning id into customer_id; end if;
  for input_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(input_item) <> 'object' then raise exception 'Item inválido'; end if;
    product_id_text := nullif(trim(input_item->>'product_id'), ''); variant_id_text := nullif(trim(input_item->>'variant_id'), ''); quantity_text := nullif(trim(input_item->>'quantity'), '');
    if product_id_text is null or product_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Item inválido'; end if;
    if variant_id_text is not null and variant_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Item inválido'; end if;
    if quantity_text is null or quantity_text !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Quantidade inválida'; end if;
    product_id_value := product_id_text::uuid; if variant_id_text is not null then variant_id_value := variant_id_text::uuid; end if; qty := quantity_text::numeric; if qty <= 0 or qty > 10000 then raise exception 'Quantidade inválida'; end if;
    select * into product_row from public.products p where p.id=product_id_value and p.company_id=target_company_id and p.active for update;
    if product_row.id is null then raise exception 'Produto não encontrado'; end if;
    if variant_id_value is not null then select * into variant_row from public.product_variants v where v.id=variant_id_value and v.product_id=product_row.id and v.company_id=target_company_id and v.active for update; if variant_row.id is null or variant_row.stock < qty then raise exception 'Variação sem estoque'; end if; unit_price := coalesce(variant_row.price,product_row.price); else if product_row.stock < qty then raise exception 'Produto sem estoque'; end if; unit_price := product_row.price; end if;
    if unit_price is null or unit_price::text in ('NaN','Infinity','-Infinity') or unit_price <= 0 then raise exception 'Produto sem preço publicável'; end if;
    total := total + qty * unit_price; normalized := normalized || jsonb_build_array(jsonb_build_object('product_id',product_row.id,'variant_id',variant_id_value,'name',product_row.name,'qty',qty,'price',unit_price));
  end loop;
  insert into public.store_orders(company_id,customer_id,customer_name,customer_email,customer_phone,items,total) values(target_company_id,customer_id,trim(p_customer->>'name'),nullif(trim(p_customer->>'email'),''),nullif(trim(p_customer->>'phone'),''),normalized,round(total,2)) returning * into order_row;
  return order_row;
end; $$;
revoke all on function public.create_public_store_order(text,jsonb,jsonb) from public;
grant execute on function public.create_public_store_order(text,jsonb,jsonb) to anon, authenticated;

-- Imagens do catálogo são assets comerciais públicos; nenhum dado de produto interno é exposto por Storage.
update storage.buckets set public=true where id='product-catalog';
drop policy if exists product_catalog_public_select on storage.objects;
create policy product_catalog_public_select on storage.objects for select using (bucket_id='product-catalog');
update storage.buckets set public=true where id='company-branding';
drop policy if exists company_branding_public_select on storage.objects;
create policy company_branding_public_select on storage.objects for select using (bucket_id='company-branding');
