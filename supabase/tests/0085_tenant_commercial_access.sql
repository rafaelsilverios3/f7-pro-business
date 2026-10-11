begin;

select plan(70);

insert into public.companies(id, name) values
  ('d1500000-0000-4000-8000-000000000001', 'Tenant Isolation Test A'),
  ('d1500000-0000-4000-8000-000000000002', 'Tenant Isolation Test B');
insert into public.company_users(company_id, user_id, role, active) values
  ('d1500000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001', 'admin', true),
  ('d1500000-0000-4000-8000-000000000002', 'd1600000-0000-4000-8000-000000000002', 'admin', true),
  ('d1500000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000003', 'vendedor', true);
insert into public.company_subscriptions(company_id, plan, status) values
  ('d1500000-0000-4000-8000-000000000001', 'pro', 'active'),
  ('d1500000-0000-4000-8000-000000000002', 'pro', 'active')
on conflict (company_id) do update set plan = excluded.plan, status = excluded.status;
insert into public.company_feature_overrides(company_id, feature, enabled, reason) values
  ('d1500000-0000-4000-8000-000000000001', 'ai_sales', true, 'transactional SQL test'),
  ('d1500000-0000-4000-8000-000000000002', 'ai_sales', true, 'transactional SQL test');
insert into public.customers(id, company_id, name) values
  ('d1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'Synthetic Customer A'),
  ('d1700000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000002', 'Synthetic Customer B');
insert into public.products(id, company_id, name) values
  ('d1800000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'Synthetic Product A'),
  ('d1800000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000002', 'Synthetic Product B');
insert into public.products(id, company_id, name, stock)
values ('d1d00000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'Synthetic Production Output', 0);
update public.products set stock = 10, price = 10, cost = 5 where id = 'd1800000-0000-4000-8000-000000000001';
insert into public.production_recipes(id, company_id, product_id, yield_quantity)
values ('d1e00000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'd1d00000-0000-4000-8000-000000000001', 1);
insert into public.production_recipe_items(company_id, recipe_id, material_product_id, quantity, unit, conversion_factor, cost_snapshot, line_cost, position)
values ('d1500000-0000-4000-8000-000000000001', 'd1e00000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 1, 'un', 1, 5, 5, 0);
insert into public.purchases(id, company_id, status, total, expected_date)
values ('d1c00000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'pending', 6, current_date);
insert into public.purchase_items(company_id, purchase_id, product_id, quantity, cost)
values ('d1500000-0000-4000-8000-000000000001', 'd1c00000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 2, 3);
insert into public.sales(id, company_id, customer_id, status, total) values
  ('d1900000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'completed', 10),
  ('d1900000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000002', 'd1700000-0000-4000-8000-000000000002', 'completed', 20);
insert into public.sale_items(id, company_id, sale_id, product_id, quantity, price, cost) values
  ('d1a00000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'd1900000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 1, 10, 2),
  ('d1a00000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000002', 'd1900000-0000-4000-8000-000000000002', 'd1800000-0000-4000-8000-000000000002', 1, 20, 3);
insert into public.stock_movements(id, company_id, product_id, type, quantity) values
  ('d1b00000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 'adjust', 1),
  ('d1b00000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000002', 'd1800000-0000-4000-8000-000000000002', 'adjust', 2);

create or replace function public.codex_0085_privilege_probe()
returns trigger language plpgsql as $$ begin return new; end $$;
grant execute on function public.codex_0085_privilege_probe() to authenticated;
grant create on schema public to authenticated;

select is((select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relkind in ('r','p','v','m','f') and (has_table_privilege('authenticated', relation.oid, 'TRUNCATE') or has_table_privilege('authenticated', relation.oid, 'TRIGGER') or has_table_privilege('authenticated', relation.oid, 'REFERENCES') or has_table_privilege('authenticated', relation.oid, 'MAINTAIN'))), 0::bigint, 'Authenticated and inherited roles have no schema or maintenance privileges on public relations');
select is((select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relkind in ('r','p','v','m','f') and (has_table_privilege('anon', relation.oid, 'TRUNCATE') or has_table_privilege('anon', relation.oid, 'TRIGGER') or has_table_privilege('anon', relation.oid, 'REFERENCES') or has_table_privilege('anon', relation.oid, 'MAINTAIN'))), 0::bigint, 'Anonymous role has no schema or maintenance privileges on public relations');
select is((select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relkind in ('r','p','v','m','f') and (has_table_privilege('service_role', relation.oid, 'TRUNCATE') or has_table_privilege('service_role', relation.oid, 'TRIGGER') or has_table_privilege('service_role', relation.oid, 'REFERENCES') or has_table_privilege('service_role', relation.oid, 'MAINTAIN'))), 0::bigint, 'Service role has no schema or maintenance privileges on public relations');
select is((select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r'::"char", relation.relowner))) acl where namespace.nspname = 'public' and relation.relkind in ('r','p','v','m','f') and acl.grantee = 0 and acl.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')), 0::bigint, 'No schema or maintenance table privilege is granted to PUBLIC');
select is((select count(*) from pg_catalog.pg_default_acl defaults join pg_catalog.pg_roles owner_role on owner_role.oid=defaults.defaclrole cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl where owner_role.rolname=current_user and (defaults.defaclnamespace=0 or exists (select 1 from pg_catalog.pg_namespace namespace where namespace.oid=defaults.defaclnamespace and namespace.nspname='public')) and acl.grantee in (0, (select oid from pg_catalog.pg_roles where rolname='anon'), (select oid from pg_catalog.pg_roles where rolname='authenticated'), (select oid from pg_catalog.pg_roles where rolname='service_role')) and acl.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')), 0::bigint, 'Migration-owner global and public defaults do not restore schema or maintenance privileges');
create table public.codex_0085_future_acl_test(id integer);
select ok(not has_table_privilege('authenticated', 'public.codex_0085_future_acl_test', 'TRUNCATE') and not has_table_privilege('authenticated', 'public.codex_0085_future_acl_test', 'TRIGGER') and not has_table_privilege('authenticated', 'public.codex_0085_future_acl_test', 'REFERENCES') and not has_table_privilege('authenticated', 'public.codex_0085_future_acl_test', 'MAINTAIN'), 'A new migration-owned public table does not inherit extra schema or maintenance privileges');
drop table public.codex_0085_future_acl_test;
select ok(
  has_table_privilege('service_role', 'public.sales', 'SELECT')
  and has_table_privilege('service_role', 'public.sale_items', 'SELECT')
  and has_table_privilege('service_role', 'public.stock_movements', 'SELECT')
  and not has_table_privilege('service_role', 'public.sales', 'INSERT')
  and not has_table_privilege('service_role', 'public.sales', 'UPDATE')
  and not has_table_privilege('service_role', 'public.sales', 'DELETE')
  and not has_table_privilege('service_role', 'public.sale_items', 'INSERT')
  and not has_table_privilege('service_role', 'public.sale_items', 'UPDATE')
  and not has_table_privilege('service_role', 'public.sale_items', 'DELETE')
  and not has_table_privilege('service_role', 'public.stock_movements', 'INSERT')
  and not has_table_privilege('service_role', 'public.stock_movements', 'UPDATE')
  and not has_table_privilege('service_role', 'public.stock_movements', 'DELETE'),
  'Service role retains ledger reads but cannot bypass transactional RPCs with direct DML'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1600000-0000-4000-8000-000000000001', true);
select is(public.company_has_feature('d1500000-0000-4000-8000-000000000001', 'ai_sales'), true, 'Tenant A can query its own feature');
select is(public.company_has_feature('d1500000-0000-4000-8000-000000000002', 'ai_sales'), false, 'Tenant A cannot query Tenant B feature');
select is((select count(*) from public.customers where company_id = 'd1500000-0000-4000-8000-000000000001'), 1::bigint, 'Tenant A reads its customer');
select is((select count(*) from public.customers where company_id = 'd1500000-0000-4000-8000-000000000002'), 0::bigint, 'Tenant A cannot read Tenant B customers');
select is((select count(*) from public.sales where company_id = 'd1500000-0000-4000-8000-000000000001'), 1::bigint, 'Tenant A reads its sales');
select is((select count(*) from public.sales where company_id = 'd1500000-0000-4000-8000-000000000002'), 0::bigint, 'Tenant A cannot read Tenant B sales');
select is((select count(*) from public.sale_items where company_id = 'd1500000-0000-4000-8000-000000000002'), 0::bigint, 'Tenant A cannot read Tenant B sale items');
select is((select count(*) from public.stock_movements where company_id = 'd1500000-0000-4000-8000-000000000002'), 0::bigint, 'Tenant A cannot read Tenant B stock movements');
select ok(not has_function_privilege('authenticated', 'public.company_has_feature_internal(uuid,text)', 'EXECUTE'), 'Authenticated cannot call the internal entitlement resolver');
select ok(has_table_privilege('authenticated', 'public.customers', 'INSERT'), 'Customer creation remains available');
select ok(has_table_privilege('authenticated', 'public.customers', 'UPDATE'), 'Customer update grant is present and RLS controls eligible roles');
select ok(has_table_privilege('authenticated', 'public.customers', 'DELETE'), 'Customer deletion grant is present and RLS controls eligible roles');
select ok(has_table_privilege('authenticated', 'public.sales', 'SELECT'), 'Sales remain readable through tenant RLS');
select ok(not (has_table_privilege('authenticated', 'public.sales', 'INSERT') or has_table_privilege('authenticated', 'public.sales', 'UPDATE') or has_table_privilege('authenticated', 'public.sales', 'DELETE')), 'Direct sales writes are denied');
select ok(not (has_table_privilege('authenticated', 'public.sale_items', 'INSERT') or has_table_privilege('authenticated', 'public.sale_items', 'UPDATE') or has_table_privilege('authenticated', 'public.sale_items', 'DELETE')), 'Direct sale item writes are denied');
select ok(not (has_table_privilege('authenticated', 'public.stock_movements', 'INSERT') or has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE') or has_table_privilege('authenticated', 'public.stock_movements', 'DELETE')), 'Direct stock ledger writes are denied');
do $$
declare table_name text; outcome text;
begin
  foreach table_name in array array['customers','sales','sale_items','stock_movements'] loop
    begin
      execute format('truncate table public.%I', table_name);
      raise exception using errcode = 'P0001', message = 'codex_0085_probe_succeeded';
    exception
      when insufficient_privilege then outcome := 'denied';
      when others then
        if sqlstate = 'P0001' and sqlerrm = 'codex_0085_probe_succeeded' then
          outcome := 'allowed';
        else
          outcome := 'unexpected:' || sqlstate;
        end if;
    end;
    perform set_config('test.truncate.' || table_name, outcome, true);
  end loop;
end $$;
select is(current_setting('test.truncate.customers'), 'denied', 'Authenticated TRUNCATE on customers is denied');
select is(current_setting('test.truncate.sales'), 'denied', 'Authenticated TRUNCATE on sales is denied');
select is(current_setting('test.truncate.sale_items'), 'denied', 'Authenticated TRUNCATE on sale_items is denied');
select is(current_setting('test.truncate.stock_movements'), 'denied', 'Authenticated TRUNCATE on stock_movements is denied');
do $$
declare table_name text; outcome text;
begin
  foreach table_name in array array['customers','sales','sale_items','stock_movements'] loop
    begin
      execute format('create trigger codex_0085_probe_%I before insert on public.%I for each row execute function public.codex_0085_privilege_probe()', table_name, table_name);
      raise exception using errcode = 'P0001', message = 'codex_0085_probe_succeeded';
    exception
      when insufficient_privilege then outcome := 'denied';
      when others then
        if sqlstate = 'P0001' and sqlerrm = 'codex_0085_probe_succeeded' then
          outcome := 'allowed';
        else
          outcome := 'unexpected:' || sqlstate;
        end if;
    end;
    perform set_config('test.trigger.' || table_name, outcome, true);
  end loop;
end $$;
select is(current_setting('test.trigger.customers'), 'denied', 'Authenticated cannot create triggers on customers');
select is(current_setting('test.trigger.sales'), 'denied', 'Authenticated cannot create triggers on sales');
select is(current_setting('test.trigger.sale_items'), 'denied', 'Authenticated cannot create triggers on sale_items');
select is(current_setting('test.trigger.stock_movements'), 'denied', 'Authenticated cannot create triggers on stock_movements');
do $$ declare outcome text;
begin
  begin
    execute 'create table public.codex_0085_reference_probe (customer_id uuid references public.customers(id))';
    raise exception using errcode = 'P0001', message = 'codex_0085_probe_succeeded';
  exception
    when insufficient_privilege then outcome := 'denied';
    when others then
      if sqlstate = 'P0001' and sqlerrm = 'codex_0085_probe_succeeded' then outcome := 'allowed';
      else outcome := 'unexpected:' || sqlstate;
      end if;
  end;
  perform set_config('test.references.customers', outcome, true);
end $$;
select is(current_setting('test.references.customers'), 'denied', 'Authenticated cannot add foreign keys referencing customer data');
do $$ declare outcome text;
begin
  begin
    execute 'lock table public.sales in access exclusive mode';
    raise exception using errcode = 'P0001', message = 'codex_0085_probe_succeeded';
  exception
    when insufficient_privilege then outcome := 'denied';
    when others then
      if sqlstate = 'P0001' and sqlerrm = 'codex_0085_probe_succeeded' then outcome := 'allowed';
      else outcome := 'unexpected:' || sqlstate;
      end if;
  end;
  perform set_config('test.maintain.sales', outcome, true);
end $$;
select is(current_setting('test.maintain.sales'), 'denied', 'Authenticated cannot acquire maintenance-level exclusive locks on sales');
reset role;
revoke create on schema public from authenticated;
revoke execute on function public.codex_0085_privilege_probe() from authenticated;
set local role authenticated;
select ok(has_function_privilege('authenticated', 'public.finalize_sale_financial(jsonb)', 'EXECUTE'), 'Sale finalization remains available through its guarded RPC');
select ok(has_function_privilege('authenticated', 'public.cancel_sale(uuid)', 'EXECUTE'), 'Sale cancellation remains available through its guarded RPC');
select ok(has_function_privilege('authenticated', 'public.receive_purchase(uuid)', 'EXECUTE'), 'Purchase receiving remains available through its guarded RPC');
select ok(has_function_privilege('authenticated', 'public.adjust_inventory(uuid,numeric,text)', 'EXECUTE'), 'Inventory adjustment remains available through its guarded RPC');
select ok(has_function_privilege('authenticated', 'public.complete_production_order(jsonb)', 'EXECUTE'), 'Production remains available through its guarded RPC');
select ok(has_function_privilege('service_role', 'public.company_has_feature_internal(uuid,text)', 'EXECUTE'), 'Trusted service-role jobs can resolve entitlements');
select ok(has_function_privilege('service_role', 'public.company_has_feature(uuid,text)', 'EXECUTE'), 'Existing service-role jobs retain compatibility during function rollout');
do $$ begin
  perform public.company_has_feature_internal('d1500000-0000-4000-8000-000000000001', 'ai_sales');
  perform set_config('test.internal_resolver_denied', 'false', true);
exception when insufficient_privilege then
  perform set_config('test.internal_resolver_denied', 'true', true);
end $$;
select is(current_setting('test.internal_resolver_denied'), 'true', 'Authenticated cannot invoke the internal resolver directly');
reset role;
set local role service_role;
select is(public.company_has_feature_internal('d1500000-0000-4000-8000-000000000001', 'ai_sales'), true, 'Service-role internal entitlement lookup remains functional');
select set_config('request.jwt.claim.role', 'service_role', true);
select is(public.company_has_feature('d1500000-0000-4000-8000-000000000001', 'ai_sales'), true, 'Existing service-role callers can use the public RPC during rollout');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$ declare sale_row public.sales; begin
  perform public.adjust_inventory('d1800000-0000-4000-8000-000000000001', 11, 'transactional test');
  perform public.finalize_sale_financial(jsonb_build_object('company_id', 'd1500000-0000-4000-8000-000000000001', 'items', jsonb_build_array(jsonb_build_object('product_id', 'd1800000-0000-4000-8000-000000000001', 'qty', 1)), 'idempotency_key', 'isolation-test-finalize'));
  select * into sale_row from public.sales where company_id = 'd1500000-0000-4000-8000-000000000001' and idempotency_key = 'isolation-test-finalize';
  perform public.cancel_sale(sale_row.id);
  perform public.receive_purchase('d1c00000-0000-4000-8000-000000000001');
  perform public.complete_production_order(jsonb_build_object('company_id', 'd1500000-0000-4000-8000-000000000001', 'recipe_id', 'd1e00000-0000-4000-8000-000000000001', 'quantity', 1));
  perform set_config('test.commercial_transaction_flow', 'true', true);
exception when others then
  perform set_config('test.commercial_transaction_flow', 'false', true);
end $$;
select is(current_setting('test.commercial_transaction_flow'), 'true', 'Guarded sale, inventory and purchase RPCs work for an authorized admin');
reset role;
select is((select stock from public.products where id = 'd1800000-0000-4000-8000-000000000001'), 12::numeric, 'Sale, purchase and production RPCs preserve the expected stock balance');
select is((select status from public.sales where company_id = 'd1500000-0000-4000-8000-000000000001' and idempotency_key = 'isolation-test-finalize'), 'cancelled', 'Sale finalization and cancellation complete through guarded RPCs');
select is((select count(*) from public.stock_movements where company_id = 'd1500000-0000-4000-8000-000000000001'), 7::bigint, 'Inventory changes retain stock movement records');
select is((select count(*) from public.financial_entries where company_id = 'd1500000-0000-4000-8000-000000000001' and type in ('receivable', 'payable')), 2::bigint, 'Sale and purchase flows retain their financial entries');
select is((select count(*) from public.production_orders where company_id = 'd1500000-0000-4000-8000-000000000001'), 1::bigint, 'Authorized production RPC records a production order');
set local role authenticated;

do $$ begin
  insert into public.customers(company_id, name) values ('d1500000-0000-4000-8000-000000000002', 'Unauthorized cross-tenant insert');
  perform set_config('test.cross_insert_denied', 'false', true);
exception when insufficient_privilege then
  perform set_config('test.cross_insert_denied', 'true', true);
end $$;
select is(current_setting('test.cross_insert_denied'), 'true', 'A direct insert cannot claim another tenant');
do $$ declare affected integer; begin
  update public.customers set name = 'Tampered by A' where id = 'd1700000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  perform set_config('test.cross_update_count', affected::text, true);
end $$;
select is(current_setting('test.cross_update_count'), '0', 'Tenant A update of Tenant B row is filtered');
do $$ declare affected integer; begin
  delete from public.customers where id = 'd1700000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  perform set_config('test.cross_delete_count', affected::text, true);
end $$;
select is(current_setting('test.cross_delete_count'), '0', 'Tenant A delete of Tenant B row is filtered');
reset role;
select is((select name from public.customers where id = 'd1700000-0000-4000-8000-000000000002'), 'Synthetic Customer B', 'Tenant B customer remains unchanged after Tenant A writes');
set local role authenticated;

select set_config('request.jwt.claim.sub', 'd1600000-0000-4000-8000-000000000002', true);
select is(public.company_has_feature('d1500000-0000-4000-8000-000000000002', 'ai_sales'), true, 'Tenant B can query its own feature');
select is(public.company_has_feature('d1500000-0000-4000-8000-000000000001', 'ai_sales'), false, 'Tenant B cannot query Tenant A feature');
select is((select count(*) from public.customers where company_id = 'd1500000-0000-4000-8000-000000000001'), 0::bigint, 'Tenant B cannot read Tenant A customers');
select is((select count(*) from public.sales where company_id = 'd1500000-0000-4000-8000-000000000001'), 0::bigint, 'Tenant B cannot read Tenant A sales');
do $$ declare affected integer; begin
  update public.customers set name = 'Tampered by B' where id = 'd1700000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  perform set_config('test.cross_update_count', affected::text, true);
end $$;
select is(current_setting('test.cross_update_count'), '0', 'Tenant B update of Tenant A row is filtered');
do $$ declare affected integer; begin
  delete from public.customers where id = 'd1700000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  perform set_config('test.cross_delete_count', affected::text, true);
end $$;
select is(current_setting('test.cross_delete_count'), '0', 'Tenant B delete of Tenant A row is filtered');
reset role;
select is((select name from public.customers where id = 'd1700000-0000-4000-8000-000000000001'), 'Synthetic Customer A', 'Tenant A customer remains unchanged after Tenant B writes');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1600000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.customers where company_id = 'd1500000-0000-4000-8000-000000000001'), 1::bigint, 'Seller can read customer rows in its company');
do $$ begin
  insert into public.customers(company_id, name) values ('d1500000-0000-4000-8000-000000000001', 'Seller-created synthetic customer');
  perform set_config('test.seller_insert_allowed', 'true', true);
exception when others then
  perform set_config('test.seller_insert_allowed', 'false', true);
end $$;
select is(current_setting('test.seller_insert_allowed'), 'true', 'Seller can create a customer as allowed by the app role');
do $$ declare affected integer; begin
  update public.customers set name = 'Seller update should be denied' where id = 'd1700000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  perform set_config('test.seller_update_count', affected::text, true);
end $$;
select is(current_setting('test.seller_update_count'), '0', 'Seller cannot update customer records');
do $$ declare affected integer; begin
  delete from public.customers where id = 'd1700000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  perform set_config('test.seller_delete_count', affected::text, true);
end $$;
select is(current_setting('test.seller_delete_count'), '0', 'Seller cannot delete customer records');
do $$ begin
  perform public.adjust_inventory('d1800000-0000-4000-8000-000000000001', 99, 'role test');
  perform set_config('test.seller_adjust_error', 'not denied', true);
exception when others then
  perform set_config('test.seller_adjust_error', sqlerrm, true);
end $$;
select is(current_setting('test.seller_adjust_error'), 'Sem permissão para ajustar estoque', 'Seller cannot adjust inventory');
do $$ begin
  perform public.receive_purchase('d1c00000-0000-4000-8000-000000000001');
  perform set_config('test.seller_receive_error', 'not denied', true);
exception when others then
  perform set_config('test.seller_receive_error', sqlerrm, true);
end $$;
select is(current_setting('test.seller_receive_error'), 'Sem permissão para receber compra', 'Seller cannot receive purchases');
do $$ begin
  perform public.complete_production_order(jsonb_build_object('company_id', 'd1500000-0000-4000-8000-000000000001', 'recipe_id', 'd1e00000-0000-4000-8000-000000000001', 'quantity', 1));
  perform set_config('test.seller_production_error', 'not denied', true);
exception when others then
  perform set_config('test.seller_production_error', sqlerrm, true);
end $$;
select is(current_setting('test.seller_production_error'), 'Sem permissão para produzir', 'Seller cannot produce without the stock role');
reset role;

set local role service_role;
do $$ declare denied boolean := false; begin
  begin
    insert into public.sales(company_id, status, total)
    values ('d1500000-0000-4000-8000-000000000001', 'draft', 1);
  exception when insufficient_privilege then denied := true;
  end;
  perform set_config('test.service_sales_insert_denied', denied::text, true);
end $$;
select is(current_setting('test.service_sales_insert_denied'), 'true', 'Service role cannot insert sales outside transactional RPCs');
do $$ declare denied boolean := false; begin
  begin
    insert into public.sale_items(company_id, sale_id, product_id, quantity, price, cost)
    values ('d1500000-0000-4000-8000-000000000001', 'd1900000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 1, 10, 5);
  exception when insufficient_privilege then denied := true;
  end;
  perform set_config('test.service_sale_items_insert_denied', denied::text, true);
end $$;
select is(current_setting('test.service_sale_items_insert_denied'), 'true', 'Service role cannot insert sale items outside transactional RPCs');
do $$ declare denied boolean := false; begin
  begin
    insert into public.stock_movements(company_id, product_id, type, quantity)
    values ('d1500000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 'adjust', 1);
  exception when insufficient_privilege then denied := true;
  end;
  perform set_config('test.service_stock_insert_denied', denied::text, true);
end $$;
select is(current_setting('test.service_stock_insert_denied'), 'true', 'Service role cannot insert stock movements outside transactional RPCs');
reset role;

select * from finish();
rollback;
