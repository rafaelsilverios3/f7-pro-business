-- Atomic campaign import and explicit provenance for unknown product costs.
-- The import function is the only write path for a campaign batch. All
-- catalog, campaign, import, fact and target writes happen in one transaction.

alter table public.products
  add column if not exists cost_source text not null default 'manual';

alter table public.products drop constraint if exists products_cost_source_check;
alter table public.products add constraint products_cost_source_check
  check (cost_source in ('manual', 'purchase', 'production', 'campaign_import', 'campaign_import_unknown'));

create table if not exists public.commercial_campaign_import_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_id uuid not null references public.commercial_campaign_imports(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'product')),
  entity_id uuid not null,
  source_key text not null,
  created_at timestamptz not null default now(),
  unique (company_id, import_id, entity_type, source_key),
  unique (company_id, import_id, entity_type, entity_id)
);

create index if not exists commercial_campaign_import_entities_company_idx
  on public.commercial_campaign_import_entities(company_id, import_id, entity_type);

alter table public.commercial_campaign_import_entities enable row level security;
drop policy if exists commercial_campaign_import_entities_select on public.commercial_campaign_import_entities;
drop policy if exists commercial_campaign_import_entities_manage on public.commercial_campaign_import_entities;
create policy commercial_campaign_import_entities_select on public.commercial_campaign_import_entities
  for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
create policy commercial_campaign_import_entities_manage on public.commercial_campaign_import_entities
  for all to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','comercial'))
  with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));
grant select, insert, update, delete on public.commercial_campaign_import_entities to authenticated;
grant all on public.commercial_campaign_import_entities to service_role;

create or replace function public.commercial_campaign_normalize(value text)
returns text language sql immutable strict set search_path = public as $$
  select trim(regexp_replace(
    translate(upper(coalesce(value, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'),
    '[^A-Z0-9]+', ' ', 'g'
  ));
$$;

create or replace function public.commercial_campaign_parse_numeric(value text)
returns numeric language plpgsql immutable set search_path = public as $$
declare raw text := nullif(trim(value), '');
begin
  if raw is null then return null; end if;
  if raw like '%,%' then raw := replace(replace(raw, '.', ''), ',', '.'); end if;
  return raw::numeric;
exception when others then
  raise exception 'Valor monetário inválido: %', value using errcode = '22023';
end;
$$;

create or replace function public.import_commercial_campaign_atomic(
  p_target_company uuid,
  p_file_name text,
  p_file_hash text,
  p_campaign_name text,
  p_customer_rows jsonb,
  p_product_rows jsonb,
  p_history_rows jsonb,
  p_action_rows jsonb,
  p_management_summary jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  campaign_row public.commercial_campaigns;
  import_row public.commercial_campaign_imports;
  row jsonb;
  source_key text;
  customer_name text;
  product_name text;
  product_sku text;
  customer_id uuid;
  product_id uuid;
  fact_id uuid;
  customer_matches integer;
  product_matches integer;
  base_value numeric;
  compare_value numeric;
  source_difference numeric;
  source_potential numeric;
  source_variation_pct numeric;
  canonical_difference numeric;
  canonical_potential numeric;
  canonical_variation_pct numeric;
  difference_mismatch boolean;
  potential_mismatch boolean;
  percentage_mismatch boolean;
  imported_priority text;
  canonical_action_potential numeric := 0;
  customers_created integer := 0;
  customers_related integer := 0;
  products_created integer := 0;
  products_related integer := 0;
  facts_created integer := 0;
  facts_blocked integer := 0;
  targets_created integer := 0;
  targets_blocked integer := 0;
  cost_unknown_products integer := 0;
begin
  actor_role := public.current_company_role(p_target_company);
  if auth.uid() is null or actor_role not in ('admin', 'gestor', 'comercial') then
    raise exception 'Sem permissão para importar campanha';
  end if;
  if nullif(trim(p_file_name), '') is null or nullif(trim(p_file_hash), '') is null then
    raise exception 'Arquivo da campanha sem identidade';
  end if;
  if jsonb_typeof(p_customer_rows) <> 'array'
     or jsonb_typeof(p_product_rows) <> 'array'
     or jsonb_typeof(p_history_rows) <> 'array'
     or jsonb_typeof(p_action_rows) <> 'array' then
    raise exception 'Payload da campanha inválido';
  end if;
  if jsonb_array_length(p_customer_rows) > 10000 or jsonb_array_length(p_product_rows) > 10000
     or jsonb_array_length(p_history_rows) > 50000 or jsonb_array_length(p_action_rows) > 50000 then
    raise exception 'Payload da campanha excede o limite seguro';
  end if;

  -- Idempotency is checked before any write. A retry returns the original batch.
  select * into import_row
    from public.commercial_campaign_imports
   where company_id = p_target_company and file_hash = p_file_hash
   order by created_at desc limit 1;
  if import_row.id is not null then
    return jsonb_build_object('status', 'already_imported', 'campaign_id', import_row.campaign_id,
      'import_id', import_row.id, 'counts', jsonb_build_object('customers_created', 0,
      'customers_related', 0, 'products_created', 0, 'products_related', 0,
      'facts_created', 0, 'facts_blocked', 0, 'targets_created', 0, 'targets_blocked', 0));
  end if;

  -- Structural validation happens before catalog writes. Unknown cost is valid,
  -- but is explicitly represented as campaign_import_unknown below.
  for row in select * from jsonb_array_elements(p_customer_rows) loop
    if nullif(trim(row->>'name'), '') is null then raise exception 'Cliente inválido no payload'; end if;
  end loop;
  for row in select * from jsonb_array_elements(p_product_rows) loop
    if nullif(trim(row->>'name'), '') is null and nullif(trim(row->>'sku'), '') is null then
      raise exception 'Produto inválido no payload';
    end if;
    if nullif(trim(row->>'cost'), '') is not null then perform public.commercial_campaign_parse_numeric(row->>'cost'); end if;
    if nullif(trim(row->>'price'), '') is not null then perform public.commercial_campaign_parse_numeric(row->>'price'); end if;
    if nullif(trim(row->>'stock'), '') is not null then perform public.commercial_campaign_parse_numeric(row->>'stock'); end if;
    if nullif(trim(row->>'minimum_stock'), '') is not null then perform public.commercial_campaign_parse_numeric(row->>'minimum_stock'); end if;
  end loop;
  for row in
    select value from jsonb_array_elements(p_history_rows)
    union all
    select value from jsonb_array_elements(p_action_rows)
  loop
    if nullif(trim(row->>'customer'), '') is null or (nullif(trim(row->>'code'), '') is null and nullif(trim(row->>'product'), '') is null) then
      raise exception 'Relação sem cliente ou produto na linha %', coalesce(row->>'sourceRow', '?');
    end if;
    base_value := public.commercial_campaign_parse_numeric(row->>'baseValue');
    compare_value := public.commercial_campaign_parse_numeric(row->>'compareValue');
    if base_value is null or compare_value is null then
      raise exception 'Relação sem valores FY2025/FY2026 na linha %', coalesce(row->>'sourceRow', '?');
    end if;
  end loop;
  for row in select * from jsonb_array_elements(p_action_rows) loop
    base_value := public.commercial_campaign_parse_numeric(row->>'baseValue');
    compare_value := public.commercial_campaign_parse_numeric(row->>'compareValue');
    canonical_action_potential := canonical_action_potential + greatest(0, base_value - compare_value);
  end loop;

  select * into campaign_row from public.commercial_campaigns
   where company_id = p_target_company and name = p_campaign_name
   order by created_at desc limit 1 for update;
  if campaign_row.id is null then
    insert into public.commercial_campaigns(company_id, name, description, campaign_type, base_period, compare_period, status, source_file_name, source_file_hash, created_by)
    values (p_target_company, p_campaign_name, 'Recuperação comercial FY2025 x FY2026', 'commercial_recovery', 'FY2025', 'FY2026', 'active', p_file_name, p_file_hash, auth.uid())
    returning * into campaign_row;
  elsif campaign_row.source_file_hash is not null and campaign_row.source_file_hash <> p_file_hash then
    raise exception 'Já existe campanha parcial com outra origem; revisão necessária';
  end if;

  insert into public.commercial_campaign_imports(company_id, campaign_id, file_name, file_hash, status, source_metadata, rows_total, rows_valid, rows_review, rows_rejected, created_by)
  values (p_target_company, campaign_row.id, p_file_name, p_file_hash, 'imported',
    jsonb_build_object('workbook', p_file_name, 'sheets', jsonb_build_object('clientes', jsonb_array_length(p_customer_rows), 'itens', jsonb_array_length(p_product_rows), 'cliente_x_item', jsonb_array_length(p_history_rows), 'plano_de_acao', jsonb_array_length(p_action_rows)), 'management_summary', p_management_summary, 'canonical_action_potential', canonical_action_potential, 'cost_unknown_products', 0),
    jsonb_array_length(p_history_rows) + jsonb_array_length(p_action_rows), 0, 0, 0, auth.uid())
  returning * into import_row;

  -- Customers are reused by normalized name; duplicates remain blocked.
  for row in select * from jsonb_array_elements(p_customer_rows) loop
    customer_name := trim(row->>'name');
    select min(id), count(*) into customer_id, customer_matches from public.customers
      where company_id = p_target_company and public.commercial_campaign_normalize(name) = public.commercial_campaign_normalize(customer_name);
    if customer_matches = 0 then
      insert into public.customers(company_id, name) values (p_target_company, customer_name) returning id into customer_id;
      customers_created := customers_created + 1;
    else
      customers_related := customers_related + 1;
    end if;
    source_key := public.commercial_campaign_normalize(customer_name);
    insert into public.commercial_campaign_import_entities(company_id, import_id, entity_type, entity_id, source_key)
      values (p_target_company, import_row.id, 'customer', customer_id, source_key)
      on conflict (company_id, import_id, entity_type, source_key) do nothing;
  end loop;

  -- Products use SKU first and description only when there is no SKU. Cost zero
  -- is canonical for the existing catalog, but provenance makes it explicit.
  for row in select * from jsonb_array_elements(p_product_rows) loop
    product_name := nullif(trim(row->>'name'), '');
    product_sku := nullif(trim(row->>'sku'), '');
    if product_sku is not null then
      select min(id), count(*) into product_id, product_matches from public.products
        where company_id = p_target_company and public.commercial_campaign_normalize(sku) = public.commercial_campaign_normalize(product_sku);
    else
      select min(id), count(*) into product_id, product_matches from public.products
        where company_id = p_target_company and public.commercial_campaign_normalize(name) = public.commercial_campaign_normalize(product_name);
    end if;
    if product_matches = 0 then
      insert into public.products(company_id, name, sku, item_type, unit, cost, price, stock, minimum_stock, active, cost_source)
      values (p_target_company, coalesce(product_name, product_sku), product_sku, 'product', coalesce(nullif(row->>'unit', ''), 'un'),
        coalesce(public.commercial_campaign_parse_numeric(row->>'cost'), 0), coalesce(public.commercial_campaign_parse_numeric(row->>'price'), 0),
        coalesce(public.commercial_campaign_parse_numeric(row->>'stock'), 0), coalesce(public.commercial_campaign_parse_numeric(row->>'minimum_stock'), 0), true,
        case when nullif(trim(row->>'cost'), '') is null then 'campaign_import_unknown' else 'campaign_import' end)
      returning id into product_id;
      products_created := products_created + 1;
      if nullif(trim(row->>'cost'), '') is null then cost_unknown_products := cost_unknown_products + 1; end if;
    else
      products_related := products_related + 1;
    end if;
    source_key := coalesce(public.commercial_campaign_normalize(product_sku), public.commercial_campaign_normalize(product_name));
    insert into public.commercial_campaign_import_entities(company_id, import_id, entity_type, entity_id, source_key)
      values (p_target_company, import_row.id, 'product', product_id, source_key)
      on conflict (company_id, import_id, entity_type, source_key) do nothing;
  end loop;
  update public.commercial_campaign_imports set source_metadata = source_metadata || jsonb_build_object('cost_unknown_products', cost_unknown_products) where id = import_row.id;

  create temporary table campaign_fact_keys(customer_key text, product_key text, fact_id uuid) on commit drop;
  for row in select * from jsonb_array_elements(p_history_rows) loop
    customer_name := trim(row->>'customer');
    product_sku := nullif(trim(row->>'code'), '');
    product_name := nullif(trim(row->>'product'), '');
    select min(id), count(*) into customer_id, customer_matches from public.customers where company_id = p_target_company and public.commercial_campaign_normalize(name) = public.commercial_campaign_normalize(customer_name);
    if product_sku is not null then
      select min(id), count(*) into product_id, product_matches from public.products where company_id = p_target_company and public.commercial_campaign_normalize(sku) = public.commercial_campaign_normalize(product_sku);
    else
      select min(id), count(*) into product_id, product_matches from public.products where company_id = p_target_company and public.commercial_campaign_normalize(name) = public.commercial_campaign_normalize(product_name);
    end if;
    if customer_matches = 1 and product_matches = 1 then
      base_value := public.commercial_campaign_parse_numeric(row->>'baseValue'); compare_value := public.commercial_campaign_parse_numeric(row->>'compareValue');
      source_difference := public.commercial_campaign_parse_numeric(row->>'sourceDifference'); source_potential := public.commercial_campaign_parse_numeric(row->>'sourcePotential'); source_variation_pct := public.commercial_campaign_parse_numeric(row->>'sourceVariationPct');
      canonical_difference := compare_value - base_value; canonical_potential := greatest(0, base_value - compare_value); canonical_variation_pct := case when base_value = 0 then null else canonical_difference / base_value end;
      difference_mismatch := source_difference is not null and abs(source_difference - canonical_difference) > 0.005; potential_mismatch := source_potential is not null and abs(source_potential - canonical_potential) > 0.005; percentage_mismatch := source_variation_pct is not null and canonical_variation_pct is not null and abs(source_variation_pct - canonical_variation_pct) > 0.00005;
      insert into public.commercial_campaign_facts(company_id, campaign_id, import_id, customer_id, product_id, period_base, period_compare, source_sheet, source_row, source_customer_name, source_product_code, source_product_name, source_values, source_base_value, source_compare_value, source_difference, source_potential, source_variation_pct, canonical_base_value, canonical_compare_value, canonical_difference, canonical_variation_pct, divergence, divergence_details, match_status, idempotency_key)
      values (p_target_company, campaign_row.id, import_row.id, customer_id, product_id, 'FY2025', 'FY2026', coalesce(row->>'sheet', 'Cliente x Item'), coalesce(nullif(trim(row->>'sourceRow'), '')::integer, 0), customer_name, product_sku, product_name, jsonb_build_object('status', row->>'sourceStatus'), base_value, compare_value, source_difference, source_potential, source_variation_pct, base_value, compare_value, canonical_difference, canonical_variation_pct, difference_mismatch or potential_mismatch or percentage_mismatch, jsonb_build_object('differenceMismatch', difference_mismatch, 'potentialMismatch', potential_mismatch, 'percentageMismatch', percentage_mismatch), 'exact', 'history:' || coalesce(row->>'sourceRow', '0') || ':' || public.commercial_campaign_normalize(customer_name) || ':' || public.commercial_campaign_normalize(coalesce(product_sku, product_name)))
      returning id into fact_id;
      insert into campaign_fact_keys values (public.commercial_campaign_normalize(customer_name), public.commercial_campaign_normalize(coalesce(product_sku, product_name)), fact_id);
      facts_created := facts_created + 1;
    else
      facts_blocked := facts_blocked + 1;
    end if;
  end loop;

  for row in select * from jsonb_array_elements(p_action_rows) loop
    customer_name := trim(row->>'customer'); product_sku := nullif(trim(row->>'code'), ''); product_name := nullif(trim(row->>'product'), '');
    select fact_id into fact_id from campaign_fact_keys where customer_key = public.commercial_campaign_normalize(customer_name) and product_key = public.commercial_campaign_normalize(coalesce(product_sku, product_name)) limit 1;
    if fact_id is null then targets_blocked := targets_blocked + 1; continue; end if;
    base_value := public.commercial_campaign_parse_numeric(row->>'baseValue'); compare_value := public.commercial_campaign_parse_numeric(row->>'compareValue'); canonical_potential := greatest(0, base_value - compare_value);
    imported_priority := substring(upper(coalesce(row->>'priority', '')) from '(P[123])');
    select f.customer_id, f.product_id into customer_id, product_id from public.commercial_campaign_facts f where f.id = fact_id;
    insert into public.commercial_campaign_targets(company_id, campaign_id, import_id, fact_id, customer_id, product_id, source_sheet, source_row, imported_priority, status, reason, action, informed_recovery_amount, canonical_potential, match_status, idempotency_key)
      values (p_target_company, campaign_row.id, import_row.id, fact_id, customer_id, product_id, coalesce(row->>'sheet', 'Plano de Acao'), coalesce(nullif(trim(row->>'sourceRow'), '')::integer, 0), imported_priority, 'NOT_CONTACTED', row->>'reason', row->>'action', 0, canonical_potential, 'exact', 'target:' || coalesce(row->>'sourceRow', '0') || ':' || public.commercial_campaign_normalize(customer_name) || ':' || public.commercial_campaign_normalize(coalesce(product_sku, product_name)));
    targets_created := targets_created + 1;
  end loop;
  update public.commercial_campaign_imports set rows_valid = facts_created + targets_created, rows_review = facts_blocked + targets_blocked where id = import_row.id;
  return jsonb_build_object('status', 'imported', 'campaign_id', campaign_row.id, 'import_id', import_row.id,
    'counts', jsonb_build_object('customers_created', customers_created, 'customers_related', customers_related, 'products_created', products_created, 'products_related', products_related, 'facts_created', facts_created, 'facts_blocked', facts_blocked, 'targets_created', targets_created, 'targets_blocked', targets_blocked, 'cost_unknown_products', cost_unknown_products));
exception when others then
  -- PL/pgSQL function invocation is transactional: all writes in this call roll back.
  raise;
end;
$$;

revoke all on function public.import_commercial_campaign_atomic(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.import_commercial_campaign_atomic(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
