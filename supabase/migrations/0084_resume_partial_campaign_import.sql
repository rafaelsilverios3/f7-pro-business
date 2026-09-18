-- Etapa 19.6H: concluir um batch parcial sem repetir cadastros.
-- Esta função só é válida para um import_id já existente no mesmo tenant e
-- preenche fatos/targets ausentes de forma idempotente. Não cria clientes,
-- produtos, vendas, estoque, financeiro ou CRM.

create or replace function public.resume_commercial_campaign_import_atomic(
  p_target_company uuid,
  p_file_name text,
  p_file_hash text,
  p_history_rows jsonb,
  p_action_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  import_row public.commercial_campaign_imports;
  campaign_row public.commercial_campaigns;
  facts_created integer := 0;
  targets_created integer := 0;
  facts_total integer := 0;
  targets_total integer := 0;
  facts_blocked integer := 0;
  targets_blocked integer := 0;
begin
  actor_role := public.current_company_role(p_target_company);
  if auth.uid() is null or actor_role not in ('admin', 'gestor', 'comercial') then
    raise exception 'Sem permissão para concluir campanha';
  end if;
  if nullif(trim(p_file_name), '') is null or nullif(trim(p_file_hash), '') is null then
    raise exception 'Arquivo da campanha sem identidade';
  end if;
  if jsonb_typeof(p_history_rows) <> 'array' or jsonb_typeof(p_action_rows) <> 'array' then
    raise exception 'Payload da campanha inválido';
  end if;
  if jsonb_array_length(p_history_rows) > 50000 or jsonb_array_length(p_action_rows) > 50000 then
    raise exception 'Payload da campanha excede o limite seguro';
  end if;

  select * into import_row
    from public.commercial_campaign_imports
   where company_id = p_target_company and file_hash = p_file_hash and file_name = p_file_name
   order by created_at desc, id desc limit 1
   for update;
  if import_row.id is null then
    raise exception 'Batch parcial não encontrado para este tenant e arquivo';
  end if;
  select * into campaign_row from public.commercial_campaigns
   where id = import_row.campaign_id and company_id = p_target_company
   for update;
  if campaign_row.id is null then
    raise exception 'Campanha do batch não pertence ao tenant';
  end if;

  select count(*) into facts_total from public.commercial_campaign_facts where company_id = p_target_company and import_id = import_row.id;
  select count(*) into targets_total from public.commercial_campaign_targets where company_id = p_target_company and import_id = import_row.id;
  if facts_total = jsonb_array_length(p_history_rows) and targets_total = jsonb_array_length(p_action_rows) then
    return jsonb_build_object('status', 'already_complete', 'campaign_id', campaign_row.id, 'import_id', import_row.id,
      'counts', jsonb_build_object('facts_created', 0, 'targets_created', 0, 'facts_total', facts_total, 'targets_total', targets_total));
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

  create temporary table campaign_customer_map on commit drop as
    select s.customer_key,
           case when count(c.id) = 1 then (array_agg(c.id))[1] else null end customer_id,
           count(c.id)::integer match_count
      from (select distinct customer_key from campaign_history_rows) s
      left join public.customers c
        on c.company_id = p_target_company
       and public.commercial_campaign_normalize(c.name) = s.customer_key
     group by s.customer_key;
  create unique index campaign_resume_customer_key_idx on campaign_customer_map(customer_key);

  create temporary table campaign_product_map on commit drop as
    select s.product_key,
           s.product_sku,
           case when count(p.id) = 1 then (array_agg(p.id))[1] else null end product_id,
           count(p.id)::integer match_count
      from (select distinct product_key, product_sku from campaign_history_rows) s
      left join public.products p
        on p.company_id = p_target_company
       and ((s.product_sku is not null and public.commercial_campaign_normalize(p.sku) = s.product_key)
         or (s.product_sku is null and public.commercial_campaign_normalize(p.name) = s.product_key))
     group by s.product_key, s.product_sku;
  create unique index campaign_resume_product_key_idx on campaign_product_map(product_key);

  insert into public.commercial_campaign_facts(
    company_id, campaign_id, import_id, customer_id, product_id, period_base, period_compare,
    source_sheet, source_row, source_customer_name, source_product_code, source_product_name,
    source_values, source_base_value, source_compare_value, source_difference, source_potential,
    source_variation_pct, canonical_base_value, canonical_compare_value, canonical_difference,
    canonical_variation_pct, divergence, divergence_details, match_status, idempotency_key
  )
  select p_target_company, campaign_row.id, import_row.id, cm.customer_id, pm.product_id,
         'FY2025', 'FY2026', h.source_sheet, h.source_row, h.customer_name, h.product_sku,
         h.product_name, jsonb_build_object('status', h.source_status), h.base_value, h.compare_value,
         h.source_difference, h.source_potential, h.source_variation_pct, h.base_value, h.compare_value,
         h.compare_value - h.base_value,
         case when h.base_value = 0 then null else (h.compare_value - h.base_value) / h.base_value end,
         coalesce(abs(h.source_difference - (h.compare_value - h.base_value)) > 0.005, false)
           or coalesce(abs(h.source_potential - greatest(0, h.base_value - h.compare_value)) > 0.005, false)
           or coalesce(abs(h.source_variation_pct - case when h.base_value = 0 then null else (h.compare_value - h.base_value) / h.base_value end) > 0.00005, false),
         jsonb_build_object(
           'differenceMismatch', coalesce(abs(h.source_difference - (h.compare_value - h.base_value)) > 0.005, false),
           'potentialMismatch', coalesce(abs(h.source_potential - greatest(0, h.base_value - h.compare_value)) > 0.005, false),
           'percentageMismatch', coalesce(abs(h.source_variation_pct - case when h.base_value = 0 then null else (h.compare_value - h.base_value) / h.base_value end) > 0.00005, false)
         ),
         'exact', 'history:' || h.source_row || ':' || h.customer_key || ':' || h.product_key
    from campaign_history_rows h
    join campaign_customer_map cm on cm.customer_key = h.customer_key and cm.match_count = 1
    join campaign_product_map pm on pm.product_key = h.product_key and pm.match_count = 1
   where not exists (
     select 1 from public.commercial_campaign_facts existing
      where existing.company_id = p_target_company and existing.import_id = import_row.id
        and existing.idempotency_key = 'history:' || h.source_row || ':' || h.customer_key || ':' || h.product_key
   );
  get diagnostics facts_created = row_count;

  create temporary table campaign_fact_keys on commit drop as
    select distinct on (h.customer_key, h.product_key)
           h.customer_key, h.product_key, f.id fact_id, f.customer_id, f.product_id
      from campaign_history_rows h
      join public.commercial_campaign_facts f
        on f.company_id = p_target_company and f.import_id = import_row.id
       and f.idempotency_key = 'history:' || h.source_row || ':' || h.customer_key || ':' || h.product_key
     order by h.customer_key, h.product_key, h.source_row, f.id;
  create unique index campaign_resume_fact_key_idx on campaign_fact_keys(customer_key, product_key);

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

  insert into public.commercial_campaign_targets(
    company_id, campaign_id, import_id, fact_id, customer_id, product_id, source_sheet, source_row,
    imported_priority, status, reason, action, informed_recovery_amount, canonical_potential,
    match_status, idempotency_key
  )
  select p_target_company, campaign_row.id, import_row.id, fk.fact_id, fk.customer_id, fk.product_id,
         a.source_sheet, a.source_row, a.imported_priority, 'NOT_CONTACTED', a.reason, a.action, 0,
         greatest(0, a.base_value - a.compare_value), 'exact',
         'target:' || a.source_row || ':' || a.customer_key || ':' || a.product_key
    from campaign_action_rows a
    join campaign_fact_keys fk on fk.customer_key = a.customer_key and fk.product_key = a.product_key
   where not exists (
     select 1 from public.commercial_campaign_targets existing
      where existing.company_id = p_target_company and existing.import_id = import_row.id
        and existing.idempotency_key = 'target:' || a.source_row || ':' || a.customer_key || ':' || a.product_key
   );
  get diagnostics targets_created = row_count;

  select count(*) into facts_total from public.commercial_campaign_facts where company_id = p_target_company and import_id = import_row.id;
  select count(*) into targets_total from public.commercial_campaign_targets where company_id = p_target_company and import_id = import_row.id;
  facts_blocked := greatest(0, jsonb_array_length(p_history_rows) - facts_total);
  targets_blocked := greatest(0, jsonb_array_length(p_action_rows) - targets_total);
  update public.commercial_campaign_imports
     set rows_valid = facts_total + targets_total,
         rows_review = facts_blocked + targets_blocked,
         updated_at = now()
   where id = import_row.id and company_id = p_target_company;

  return jsonb_build_object('status', 'resumed', 'campaign_id', campaign_row.id, 'import_id', import_row.id,
    'counts', jsonb_build_object('facts_created', facts_created, 'targets_created', targets_created,
      'facts_total', facts_total, 'targets_total', targets_total,
      'facts_blocked', facts_blocked, 'targets_blocked', targets_blocked));
exception when others then
  raise;
end;
$$;

revoke all on function public.resume_commercial_campaign_import_atomic(uuid,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.resume_commercial_campaign_import_atomic(uuid,text,text,jsonb,jsonb) to authenticated;
