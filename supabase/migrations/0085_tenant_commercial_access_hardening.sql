-- Tenant isolation and transactional write boundary hardening.
-- Conceptual rollback is manual, not an automated inverse: prefer a forward-fix.
-- If business logic must be reverted, restore
-- the prior feature RPC definition/grants, table policies and SECURITY INVOKER
-- attributes, and prior purchase RPC body; then remove adjust_inventory and
-- company_has_feature_internal only after dependent Edge Functions are rolled
-- back. Keep TRUNCATE/TRIGGER revocations; never restore those unsafe grants.
-- This migration changes no application rows.

-- Supabase's role bootstrap may grant TRUNCATE, TRIGGER, REFERENCES and
-- MAINTAIN to API roles by default. These are schema/maintenance privileges,
-- not application row access. Revoke them from existing public relations and
-- defaults owned by the migration executor. Supabase-managed owners such as
-- supabase_admin are not alterable by an ordinary migration role; their
-- defaults are intentionally not modified. Keep row-level privileges and
-- database-owner administration.
revoke truncate, trigger, references, maintain on all tables in schema public
  from public, anon, authenticated, service_role;

do $$
begin
  -- Per-schema REVOKE cannot cancel a privilege supplied by the role's global
  -- defaults, so harden both scopes for the migration executor.
  execute format(
    'alter default privileges for role %I revoke truncate, trigger, references, maintain on tables from public, anon, authenticated, service_role',
    current_user
  );
  execute format(
    'alter default privileges for role %I in schema public revoke truncate, trigger, references, maintain on tables from public, anon, authenticated, service_role',
    current_user
  );

  -- If an inherited role still conveys these rights, stop instead of leaving
  -- an apparently successful but incomplete hardening migration.
  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        has_table_privilege('anon', relation.oid, 'TRUNCATE')
        or has_table_privilege('anon', relation.oid, 'TRIGGER')
        or has_table_privilege('anon', relation.oid, 'REFERENCES')
        or has_table_privilege('anon', relation.oid, 'MAINTAIN')
        or has_table_privilege('authenticated', relation.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', relation.oid, 'TRIGGER')
        or has_table_privilege('authenticated', relation.oid, 'REFERENCES')
        or has_table_privilege('authenticated', relation.oid, 'MAINTAIN')
        or has_table_privilege('service_role', relation.oid, 'TRUNCATE')
        or has_table_privilege('service_role', relation.oid, 'TRIGGER')
        or has_table_privilege('service_role', relation.oid, 'REFERENCES')
        or has_table_privilege('service_role', relation.oid, 'MAINTAIN')
      )
  ) then
    raise exception 'Unexpected inherited table-level schema or maintenance privilege remains on a public relation';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_default_acl defaults
    join pg_catalog.pg_roles owner_role on owner_role.oid = defaults.defaclrole
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
    where owner_role.rolname = current_user
      and (defaults.defaclnamespace = 0 or exists (
        select 1 from pg_catalog.pg_namespace namespace
        where namespace.oid = defaults.defaclnamespace and namespace.nspname = 'public'
      ))
      and acl.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
        (select oid from pg_catalog.pg_roles where rolname = 'service_role')
      )
      and acl.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) then
    raise exception 'Migration-owner default schema or maintenance privilege remains for public tables';
  end if;

  -- Supabase-managed role defaults (including supabase_admin) are an
  -- operational prerequisite: public application tables must be created by
  -- the migration role whose defaults this migration hardened. Do not attempt
  -- to mutate defaults outside the migration executor's authority.
end;
$$;

-- Keep the entitlement calculation for trusted backend jobs, but isolate it
-- behind an EXECUTE grant available only to service_role.
create or replace function public.company_has_feature_internal(target_company uuid, feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  plan_name text;
  subscription_status text;
  override_enabled boolean;
  configured boolean;
begin
  select coalesce(s.plan, 'free'), s.status
    into plan_name, subscription_status
  from public.company_subscriptions s
  where s.company_id = target_company;
  plan_name := coalesce(plan_name, 'free');

  if subscription_status = 'trial'
     or subscription_status in ('expired', 'cancelled', 'suspended', 'past_due') then
    return false;
  end if;

  select o.enabled into override_enabled
  from public.company_feature_overrides o
  where o.company_id = target_company
    and o.feature = lower(trim($2));
  if override_enabled is not null then return override_enabled; end if;

  select pf.enabled into configured
  from public.plan_features pf
  join public.plans p on p.id = pf.plan_id
  where p.code = plan_name
    and p.active
    and pf.feature = lower(trim($2));
  if configured is not null then return configured; end if;

  return case lower(trim(feature))
    when 'intelligence' then plan_name in ('pro', 'business', 'premium')
    when 'automations' then plan_name in ('business', 'premium')
    when 'atendimento' then plan_name in ('business', 'premium')
    when 'advanced_reports' then plan_name in ('business', 'premium')
    when 'whatsapp' then plan_name in ('business', 'premium')
    when 'ai' then plan_name = 'premium'
    when 'ai_sales' then plan_name in ('pro', 'business', 'premium')
    when 'opportunity_radar' then plan_name in ('business', 'premium')
    when 'supplier_intelligence' then plan_name = 'premium'
    when 'external_product_intelligence' then plan_name in ('business', 'premium')
    else false
  end;
end;
$$;

revoke all on function public.company_has_feature_internal(uuid, text) from public, anon, authenticated;
grant execute on function public.company_has_feature_internal(uuid, text) to service_role;

-- The browser-facing RPC only answers for an active member of that company.
-- Preserve the public argument names expected by PostgREST clients.
create or replace function public.company_has_feature(target_company uuid, feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Keep already-deployed service-role Edge Functions working during the
  -- migration/function rollout. A service-role JWT is only held server-side;
  -- browser callers still need an authenticated user and tenant membership.
  if auth.role() = 'service_role' then
    return public.company_has_feature_internal(target_company, feature);
  end if;
  if auth.uid() is null or not public.is_company_member(target_company) then
    return false;
  end if;
  return public.company_has_feature_internal(target_company, feature);
end;
$$;

revoke all on function public.company_has_feature(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;

-- Direct CRUD for customers matches the app's role permissions. Sales and
-- inventory ledgers are readable by active tenant members but are written only
-- through validated, atomic RPCs or trusted service_role processes.
drop policy if exists company_isolation on public.customers;
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (public.current_company_role(company_id) in ('admin', 'gestor', 'comercial', 'vendedor', 'atendimento'));
create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.current_company_role(company_id) in ('admin', 'gestor', 'comercial', 'vendedor', 'atendimento'));
create policy customers_update on public.customers
  for update to authenticated
  using (public.current_company_role(company_id) in ('admin', 'gestor', 'comercial'))
  with check (public.current_company_role(company_id) in ('admin', 'gestor', 'comercial'));
create policy customers_delete on public.customers
  for delete to authenticated
  using (public.current_company_role(company_id) in ('admin', 'gestor', 'comercial'));
grant select, insert, update, delete on public.customers to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['sales', 'sale_items', 'stock_movements'] loop
    execute format('drop policy if exists company_isolation on public.%I', table_name);
    execute format('drop policy if exists tenant_member_select on public.%I', table_name);
    execute format('create policy tenant_member_select on public.%I for select to authenticated using (public.is_company_member(company_id))', table_name);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end;
$$;

-- These RPCs already validate the caller, tenant, role and business invariants.
-- SECURITY DEFINER lets those checks mediate ledger writes without granting
-- direct browser DML on sales, sale_items or stock_movements.
alter function public.finalize_sale(jsonb) security definer;
alter function public.finalize_sale(jsonb) set search_path = pg_catalog, public, pg_temp;
alter function public.finalize_sale_financial(jsonb) security definer;
alter function public.finalize_sale_financial(jsonb) set search_path = pg_catalog, public, pg_temp;
alter function public.cancel_sale(uuid) security definer;
alter function public.cancel_sale(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.complete_production_order(jsonb) security definer;
alter function public.complete_production_order(jsonb) set search_path = pg_catalog, public, pg_temp;

-- Receiving a purchase is a privileged stock/finance transition. Add the
-- backend role check that the earlier RPC lacked before running it as definer.
create or replace function public.receive_purchase(target_purchase uuid)
returns public.purchases
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  purchase_row public.purchases;
  item public.purchase_items;
  product_row public.products;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into purchase_row
  from public.purchases
  where id = target_purchase and public.is_company_member(company_id)
  for update;
  if purchase_row.id is null then raise exception 'Compra não encontrada'; end if;
  if public.current_company_role(purchase_row.company_id) not in ('admin', 'gestor', 'estoque') then
    raise exception 'Sem permissão para receber compra';
  end if;
  if purchase_row.status = 'received' then return purchase_row; end if;

  for item in
    select * from public.purchase_items
    where purchase_id = target_purchase and company_id = purchase_row.company_id
    for update
  loop
    if item.quantity <= 0 or item.cost < 0 then raise exception 'Item de compra inválido'; end if;
    select * into product_row
    from public.products
    where id = item.product_id and company_id = purchase_row.company_id
    for update;
    if product_row.id is null then raise exception 'Produto da compra não encontrado'; end if;
    update public.products set stock = stock + item.quantity, cost = item.cost
    where id = product_row.id and company_id = purchase_row.company_id;
    insert into public.stock_movements(company_id, product_id, purchase_id, type, quantity, reason)
    values (purchase_row.company_id, product_row.id, purchase_row.id, 'in', item.quantity, 'Recebimento de compra');
  end loop;

  insert into public.financial_entries(company_id, purchase_id, type, status, description, amount, due_date)
  select purchase_row.company_id, purchase_row.id, 'payable', 'pending', 'Compra recebida', purchase_row.total, coalesce(purchase_row.expected_date, current_date)
  where not exists (select 1 from public.financial_entries where purchase_id = purchase_row.id and company_id = purchase_row.company_id);
  update public.purchases set status = 'received'
  where id = target_purchase and company_id = purchase_row.company_id
  returning * into purchase_row;
  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data)
  values (purchase_row.company_id, auth.uid(), 'purchase.received', 'PurchaseOrder', purchase_row.id, to_jsonb(purchase_row));
  return purchase_row;
end;
$$;

revoke all on function public.receive_purchase(uuid) from public, anon;
grant execute on function public.receive_purchase(uuid) to authenticated;

-- Inventory adjustments are atomic and leave a ledger entry. The company is
-- derived from the target product, never trusted from a caller-supplied tenant id.
create or replace function public.adjust_inventory(target_product uuid, target_stock numeric, adjustment_reason text default null)
returns public.products
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  product_row public.products;
  stock_delta numeric(14,3);
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into product_row
  from public.products
  where id = target_product and public.is_company_member(company_id)
  for update;
  if product_row.id is null then raise exception 'Produto não encontrado'; end if;
  if public.current_company_role(product_row.company_id) not in ('admin', 'gestor', 'estoque') then
    raise exception 'Sem permissão para ajustar estoque';
  end if;
  if product_row.item_type = 'service' then raise exception 'Serviços não possuem estoque'; end if;
  if target_stock is null or target_stock < 0 then raise exception 'Estoque inválido'; end if;

  stock_delta := target_stock - product_row.stock;
  update public.products set stock = target_stock, updated_at = now()
  where id = target_product and company_id = product_row.company_id
  returning * into product_row;
  if stock_delta <> 0 then
    insert into public.stock_movements(company_id, product_id, type, quantity, reason)
    values (product_row.company_id, product_row.id, 'adjust', stock_delta, left(nullif(trim(adjustment_reason), ''), 500));
  end if;
  return product_row;
end;
$$;

revoke all on function public.adjust_inventory(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_inventory(uuid, numeric, text) to authenticated;

-- Business-logic rollback requires restoring the prior company_has_feature
-- implementation, role policies/grants and invoker properties, plus
-- receive_purchase; remove the new RPCs only after dependent consumers are
-- rolled back. Keep the schema/maintenance privilege revocations above. Since
-- reverting business guards can reopen direct writes, review before rollback.
