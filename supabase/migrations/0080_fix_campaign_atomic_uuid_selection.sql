-- Corrective hardening for the atomic campaign import function.
-- PostgreSQL has no min(uuid); preserve deterministic selection with array_agg,
-- avoid PL/pgSQL name collisions, and fail closed when tenant role is NULL.
do $$
declare
  current_definition text;
  fixed_definition text;
begin
  select pg_get_functiondef(p.oid)
    into current_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'import_commercial_campaign_atomic'
     and pg_get_function_identity_arguments(p.oid) = 'p_target_company uuid, p_file_name text, p_file_hash text, p_campaign_name text, p_customer_rows jsonb, p_product_rows jsonb, p_history_rows jsonb, p_action_rows jsonb, p_management_summary jsonb';

  if current_definition is null then
    raise exception 'RPC import_commercial_campaign_atomic não encontrada';
  end if;

  fixed_definition := regexp_replace(
    current_definition,
    'select min\(id\), count\(\*\) into',
    'select (array_agg(id order by id))[1], count(*) into',
    'gi'
  );

  fixed_definition := replace(fixed_definition, 'campaign_fact_keys(customer_key text, product_key text, fact_id uuid)', 'campaign_fact_keys(customer_key text, product_key text, stored_fact_id uuid)');
  fixed_definition := replace(fixed_definition, 'select fact_id into fact_id from campaign_fact_keys', 'select stored_fact_id into fact_id from campaign_fact_keys');
  fixed_definition := replace(fixed_definition, 'if auth.uid() is null or actor_role not in (''admin'', ''gestor'', ''comercial'') then', 'if auth.uid() is null or actor_role is null or actor_role not in (''admin'', ''gestor'', ''comercial'') then');

  if fixed_definition = current_definition then
    raise exception 'A RPC não contém o padrão UUID legado esperado';
  end if;

  execute fixed_definition;
end;
$$;
