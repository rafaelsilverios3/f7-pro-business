-- Etapa 19.6D: importação de campanhas set-based.
-- A função continua atômica e não cria vendas, estoque, financeiro ou CRM.

create index if not exists customers_company_normalized_name_idx
  on public.customers (company_id, (public.commercial_campaign_normalize(name)));
create index if not exists products_company_normalized_sku_idx
  on public.products (company_id, (public.commercial_campaign_normalize(sku)));
create index if not exists products_company_normalized_name_idx
  on public.products (company_id, (public.commercial_campaign_normalize(name)));

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

  -- Idempotência permanece protegida por company_id + file_hash.
  select * into import_row
    from public.commercial_campaign_imports
   where company_id = p_target_company and file_hash = p_file_hash
   order by created_at desc limit 1;
  if import_row.id is not null then
    return jsonb_build_object('status', 'already_imported', 'campaign_id', import_row.campaign_id,
      'import_id', import_row.id, 'counts', jsonb_build_object(
        'customers_created', 0, 'customers_related', 0, 'products_created', 0,
        'products_related', 0, 'facts_created', 0, 'facts_blocked', 0,
        'targets_created', 0, 'targets_blocked', 0));
  end if;

  -- Validação estrutural é linear e ocorre antes de qualquer escrita.
  if exists (select 1 from jsonb_array_elements(p_customer_rows) e
             where nullif(trim(e.value->>'name'), '') is null) then
    raise exception 'Cliente inválido no payload';
  end if;
  if exists (select 1 from jsonb_array_elements(p_product_rows) e
             where nullif(trim(e.value->>'name'), '') is null
               and nullif(trim(e.value->>'sku'), '') is null) then
    raise exception 'Produto inválido no payload';
  end if;
  if exists (select 1 from (
      select value from jsonb_array_elements(p_history_rows)
      union all select value from jsonb_array_elements(p_action_rows)
    ) rows
    where nullif(trim(rows.value->>'customer'), '') is null
       or (nullif(trim(rows.value->>'code'), '') is null and nullif(trim(rows.value->>'product'), '') is null)
       or public.commercial_campaign_parse_numeric(rows.value->>'baseValue') is null
       or public.commercial_campaign_parse_numeric(rows.value->>'compareValue') is null) then
    raise exception 'Relação sem cliente, produto ou valores FY2025/FY2026';
  end if;

  -- Cada chave é normalizada uma única vez. Os mapas abaixo são reutilizados
  -- por facts e targets, eliminando os SELECTs por relação.
  create temporary table campaign_source_customers on commit drop as
    select distinct on (source_key) source_key, customer_name
      from (select trim(value->>'name') customer_name,
                   public.commercial_campaign_normalize(trim(value->>'name')) source_key
              from jsonb_array_elements(p_customer_rows)) source
     where source_key is not null and source_key <> ''
     order by source_key, customer_name;
  create unique index campaign_source_customers_key_idx on campaign_source_customers(source_key);

  create temporary table campaign_customer_catalog on commit drop as
    select id, public.commercial_campaign_normalize(name) source_key
      from public.customers where company_id = p_target_company;
  create index campaign_customer_catalog_key_idx on campaign_customer_catalog(source_key);

  create temporary table campaign_customer_map (
    source_key text primary key, source_name text not null, customer_id uuid,
    match_count integer not null default 0, created boolean not null default false
  ) on commit drop;
  insert into campaign_customer_map(source_key, source_name, customer_id, match_count)
    select s.source_key, s.customer_name, min(c.id), count(c.id)::integer
      from campaign_source_customers s
      left join campaign_customer_catalog c on c.source_key = s.source_key
     group by s.source_key, s.customer_name;
  insert into public.customers(company_id, name)
    select p_target_company, source_name from campaign_customer_map where match_count = 0;
  update campaign_customer_map m
     set customer_id = c.id, match_count = 1, created = true
    from public.customers c
    where m.match_count = 0 and c.company_id = p_target_company
      and public.commercial_campaign_normalize(c.name) = m.source_key;
  select count(*) filter (where created), count(*) filter (where match_count = 1 and not created)
    into customers_created, customers_related from campaign_customer_map;

  create temporary table campaign_source_products on commit drop as
    select distinct on (source_key) source_key, product_name, product_sku, unit_name,
           cost_value, price_value, stock_value, minimum_stock_value
      from (select nullif(trim(value->>'name'), '') product_name,
                   nullif(trim(value->>'sku'), '') product_sku,
                   coalesce(nullif(value->>'unit', ''), 'un') unit_name,
                   public.commercial_campaign_parse_numeric(value->>'cost') cost_value,
                   public.commercial_campaign_parse_numeric(value->>'price') price_value,
                   public.commercial_campaign_parse_numeric(value->>'stock') stock_value,
                   public.commercial_campaign_parse_numeric(value->>'minimum_stock') minimum_stock_value,
                   coalesce(public.commercial_campaign_normalize(nullif(trim(value->>'sku'), '')),
                            public.commercial_campaign_normalize(nullif(trim(value->>'name'), ''))) source_key
              from jsonb_array_elements(p_product_rows)) source
     where source_key is not null and source_key <> ''
     order by source_key, product_name nulls last;
  create unique index campaign_source_products_key_idx on campaign_source_products(source_key);

  create temporary table campaign_product_catalog on commit drop as
    select id, public.commercial_campaign_normalize(sku) sku_key,
           public.commercial_campaign_normalize(name) name_key
      from public.products where company_id = p_target_company;
  create index campaign_product_catalog_sku_idx on campaign_product_catalog(sku_key);
  create index campaign_product_catalog_name_idx on campaign_product_catalog(name_key);

  create temporary table campaign_product_map (
    source_key text primary key, product_name text, product_sku text, unit_name text,
    cost_value numeric, price_value numeric, stock_value numeric, minimum_stock_value numeric,
    product_id uuid, match_count integer not null default 0, created boolean not null default false
  ) on commit drop;
  insert into campaign_product_map(source_key, product_name, product_sku, unit_name, cost_value, price_value, stock_value, minimum_stock_value, product_id, match_count)
    select s.source_key, s.product_name, s.product_sku, s.unit_name, s.cost_value, s.price_value,
           s.stock_value, s.minimum_stock_value, min(c.id), count(c.id)::integer
      from campaign_source_products s
      left join campaign_product_catalog c
        on (s.product_sku is not null and c.sku_key = s.source_key)
        or (s.product_sku is null and c.name_key = s.source_key)
     group by s.source_key, s.product_name, s.product_sku, s.unit_name, s.cost_value,
              s.price_value, s.stock_value, s.minimum_stock_value;
  insert into public.products(company_id, name, sku, item_type, unit, cost, price, stock, minimum_stock, active, cost_source)
    select p_target_company, coalesce(product_name, product_sku), product_sku, 'product', unit_name,
           coalesce(cost_value, 0), coalesce(price_value, 0), coalesce(stock_value, 0),
           coalesce(minimum_stock_value, 0), true,
           case when cost_value is null then 'campaign_import_unknown' else 'campaign_import' end
      from campaign_product_map where match_count = 0;
  update campaign_product_map m
     set product_id = p.id, match_count = 1, created = true
    from public.products p
    where m.match_count = 0 and p.company_id = p_target_company
      and ((m.product_sku is not null and public.commercial_campaign_normalize(p.sku) = m.source_key)
        or (m.product_sku is null and public.commercial_campaign_normalize(p.name) = m.source_key));
  select count(*) filter (where created), count(*) filter (where match_count = 1 and not created),
         count(*) filter (where created and cost_value is null)
    into products_created, products_related, cost_unknown_products from campaign_product_map;

  select coalesce(sum(greatest(0, public.commercial_campaign_parse_numeric(value->>'baseValue') - public.commercial_campaign_parse_numeric(value->>'compareValue'))), 0)
    into canonical_action_potential from jsonb_array_elements(p_action_rows);

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
    jsonb_build_object('workbook', p_file_name, 'sheets', jsonb_build_object('clientes', jsonb_array_length(p_customer_rows), 'itens', jsonb_array_length(p_product_rows), 'cliente_x_item', jsonb_array_length(p_history_rows), 'plano_de_acao', jsonb_array_length(p_action_rows)), 'management_summary', p_management_summary, 'canonical_action_potential', canonical_action_potential, 'cost_unknown_products', cost_unknown_products),
    jsonb_array_length(p_history_rows) + jsonb_array_length(p_action_rows), 0, 0, 0, auth.uid())
  returning * into import_row;

  insert into public.commercial_campaign_import_entities(company_id, import_id, entity_type, entity_id, source_key)
    select p_target_company, import_row.id, 'customer', customer_id, source_key
      from campaign_customer_map where customer_id is not null
    on conflict (company_id, import_id, entity_type, source_key) do nothing;
  insert into public.commercial_campaign_import_entities(company_id, import_id, entity_type, entity_id, source_key)
    select p_target_company, import_row.id, 'product', product_id, source_key
      from campaign_product_map where product_id is not null
    on conflict (company_id, import_id, entity_type, source_key) do nothing;

  create temporary table campaign_history_rows on commit drop as
    select trim(value->>'customer') customer_name,
           public.commercial_campaign_normalize(trim(value->>'customer')) customer_key,
           nullif(trim(value->>'code'), '') product_sku,
           nullif(trim(value->>'product'), '') product_name,
           coalesce(public.commercial_campaign_normalize(nullif(trim(value->>'code'), '')), public.commercial_campaign_normalize(nullif(trim(value->>'product'), ''))) product_key,
           coalesce(value->>'sheet', 'Cliente x Item') source_sheet,
           greatest(coalesce(nullif(trim(value->>'sourceRow'), '')::integer, 1), 1) source_row,
           value->>'sourceStatus' source_status,
           public.commercial_campaign_parse_numeric(value->>'baseValue') base_value,
           public.commercial_campaign_parse_numeric(value->>'compareValue') compare_value,
           public.commercial_campaign_parse_numeric(value->>'sourceDifference') source_difference,
           public.commercial_campaign_parse_numeric(value->>'sourcePotential') source_potential,
           public.commercial_campaign_parse_numeric(value->>'sourceVariationPct') source_variation_pct
      from jsonb_array_elements(p_history_rows);
  create index campaign_history_customer_product_idx on campaign_history_rows(customer_key, product_key);

  insert into public.commercial_campaign_facts(company_id, campaign_id, import_id, customer_id, product_id, period_base, period_compare, source_sheet, source_row, source_customer_name, source_product_code, source_product_name, source_values, source_base_value, source_compare_value, source_difference, source_potential, source_variation_pct, canonical_base_value, canonical_compare_value, canonical_difference, canonical_variation_pct, divergence, divergence_details, match_status, idempotency_key)
    select p_target_company, campaign_row.id, import_row.id, cm.customer_id, pm.product_id, 'FY2025', 'FY2026', h.source_sheet, h.source_row, h.customer_name, h.product_sku, h.product_name,
           jsonb_build_object('status', h.source_status), h.base_value, h.compare_value, h.source_difference, h.source_potential, h.source_variation_pct,
           h.base_value, h.compare_value, h.compare_value - h.base_value, case when h.base_value = 0 then null else (h.compare_value - h.base_value) / h.base_value end,
           coalesce(abs(h.source_difference - (h.compare_value - h.base_value)) > 0.005, false)
             or coalesce(abs(h.source_potential - greatest(0, h.base_value - h.compare_value)) > 0.005, false)
             or coalesce(abs(h.source_variation_pct - case when h.base_value = 0 then null else (h.compare_value - h.base_value) / h.base_value end) > 0.00005, false),
           jsonb_build_object('differenceMismatch', coalesce(abs(h.source_difference - (h.compare_value - h.base_value)) > 0.005, false), 'potentialMismatch', coalesce(abs(h.source_potential - greatest(0, h.base_value - h.compare_value)) > 0.005, false), 'percentageMismatch', coalesce(abs(h.source_variation_pct - case when h.base_value = 0 then null else (h.compare_value - h.base_value) / h.base_value end) > 0.00005, false)),
           'exact', 'history:' || h.source_row || ':' || h.customer_key || ':' || h.product_key
      from campaign_history_rows h
      join campaign_customer_map cm on cm.source_key = h.customer_key and cm.match_count = 1 and cm.customer_id is not null
      join campaign_product_map pm on pm.source_key = h.product_key and pm.match_count = 1 and pm.product_id is not null;
  get diagnostics facts_created = row_count;
  select jsonb_array_length(p_history_rows) - facts_created into facts_blocked;

  create temporary table campaign_fact_keys on commit drop as
    select distinct on (h.customer_key, h.product_key) h.customer_key, h.product_key, f.id fact_id, f.customer_id, f.product_id
      from campaign_history_rows h
      join public.commercial_campaign_facts f on f.import_id = import_row.id
       and f.idempotency_key = 'history:' || h.source_row || ':' || h.customer_key || ':' || h.product_key
     order by h.customer_key, h.product_key, h.source_row, f.id;
  create unique index campaign_fact_keys_idx on campaign_fact_keys(customer_key, product_key);

  create temporary table campaign_action_rows on commit drop as
    select trim(value->>'customer') customer_name,
           public.commercial_campaign_normalize(trim(value->>'customer')) customer_key,
           coalesce(public.commercial_campaign_normalize(nullif(trim(value->>'code'), '')), public.commercial_campaign_normalize(nullif(trim(value->>'product'), ''))) product_key,
           coalesce(value->>'sheet', 'Plano de Acao') source_sheet,
           greatest(coalesce(nullif(trim(value->>'sourceRow'), '')::integer, 1), 1) source_row,
           substring(upper(coalesce(value->>'priority', '')) from '(P[123])') imported_priority,
           value->>'reason' reason, value->>'action' action,
           public.commercial_campaign_parse_numeric(value->>'baseValue') base_value,
           public.commercial_campaign_parse_numeric(value->>'compareValue') compare_value
      from jsonb_array_elements(p_action_rows);
  create index campaign_action_customer_product_idx on campaign_action_rows(customer_key, product_key);

  insert into public.commercial_campaign_targets(company_id, campaign_id, import_id, fact_id, customer_id, product_id, source_sheet, source_row, imported_priority, status, reason, action, informed_recovery_amount, canonical_potential, match_status, idempotency_key)
    select p_target_company, campaign_row.id, import_row.id, fk.fact_id, fk.customer_id, fk.product_id, a.source_sheet, a.source_row, a.imported_priority, 'NOT_CONTACTED', a.reason, a.action, 0, greatest(0, a.base_value - a.compare_value), 'exact', 'target:' || a.source_row || ':' || a.customer_key || ':' || a.product_key
      from campaign_action_rows a join campaign_fact_keys fk on fk.customer_key = a.customer_key and fk.product_key = a.product_key;
  get diagnostics targets_created = row_count;
  select jsonb_array_length(p_action_rows) - targets_created into targets_blocked;

  update public.commercial_campaign_imports
     set rows_valid = facts_created + targets_created,
         rows_review = facts_blocked + targets_blocked,
         source_metadata = source_metadata || jsonb_build_object('cost_unknown_products', cost_unknown_products)
   where id = import_row.id;
  return jsonb_build_object('status', 'imported', 'campaign_id', campaign_row.id, 'import_id', import_row.id,
    'counts', jsonb_build_object('customers_created', customers_created, 'customers_related', customers_related,
      'products_created', products_created, 'products_related', products_related, 'facts_created', facts_created,
      'facts_blocked', facts_blocked, 'targets_created', targets_created, 'targets_blocked', targets_blocked,
      'cost_unknown_products', cost_unknown_products));
exception when others then
  -- A function invocation is transactional: all writes roll back together.
  raise;
end;
$$;

revoke all on function public.import_commercial_campaign_atomic(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.import_commercial_campaign_atomic(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
