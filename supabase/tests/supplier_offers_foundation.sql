begin;

select plan(44);

insert into public.companies(id, name) values
  ('d9100000-0000-4000-8000-000000000001', 'Supplier Offer Test A'),
  ('d9100000-0000-4000-8000-000000000002', 'Supplier Offer Test B');
insert into public.company_users(company_id, user_id, role, active) values
  ('d9100000-0000-4000-8000-000000000001', 'd9110000-0000-4000-8000-000000000001', 'admin', true),
  ('d9100000-0000-4000-8000-000000000001', 'd9110000-0000-4000-8000-000000000002', 'vendedor', true),
  ('d9100000-0000-4000-8000-000000000001', 'd9110000-0000-4000-8000-000000000004', 'estoque', true),
  ('d9100000-0000-4000-8000-000000000001', 'd9110000-0000-4000-8000-000000000005', 'comercial', true),
  ('d9100000-0000-4000-8000-000000000001', 'd9110000-0000-4000-8000-000000000006', 'financeiro', true),
  ('d9100000-0000-4000-8000-000000000002', 'd9110000-0000-4000-8000-000000000003', 'admin', true);
insert into public.suppliers(id, company_id, name) values
  ('d9120000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000001', 'Supplier Offer A'),
  ('d9120000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000002', 'Supplier Offer B');
insert into public.products(id, company_id, name, sku, price, cost, stock) values
  ('d9130000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000001', 'Offer Test Product A', 'SO-A', 100, 40, 7),
  ('d9130000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000002', 'Offer Test Product B', 'SO-B', 100, 40, 3);

select ok((select relrowsecurity from pg_class where oid = 'public.supplier_offers'::regclass), 'Offers table has RLS enabled');
select ok(has_table_privilege('authenticated', 'public.supplier_offers', 'SELECT'), 'Authenticated members can attempt tenant-scoped reads');
select ok(not has_table_privilege('authenticated', 'public.supplier_offers', 'INSERT'), 'Direct authenticated INSERT is unavailable');
select ok(not has_table_privilege('authenticated', 'public.supplier_offers', 'UPDATE'), 'Direct authenticated UPDATE is unavailable');
select ok(not has_table_privilege('authenticated', 'public.supplier_offers', 'DELETE'), 'Direct authenticated DELETE is unavailable');
select ok(not has_table_privilege('authenticated', 'public.supplier_offers', 'TRUNCATE'), 'Authenticated TRUNCATE is unavailable');
select ok(not has_table_privilege('authenticated', 'public.supplier_offers', 'TRIGGER'), 'Authenticated trigger management is unavailable');
select ok(not has_function_privilege('anon', 'public.create_supplier_offer(uuid,uuid,uuid,numeric,text,numeric,numeric,integer,text,text,text,date,date)', 'EXECUTE'), 'Anonymous users cannot create offers');
select ok(has_function_privilege('authenticated', 'public.create_supplier_offer(uuid,uuid,uuid,numeric,text,numeric,numeric,integer,text,text,text,date,date)', 'EXECUTE'), 'Authenticated callers can reach the guarded creation RPC');
select ok(not has_function_privilege('service_role', 'public.create_supplier_offer(uuid,uuid,uuid,numeric,text,numeric,numeric,integer,text,text,text,date,date)', 'EXECUTE'), 'Service-role calls cannot impersonate the human approval flow');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd9110000-0000-4000-8000-000000000001', true);

select is((select count(*) from public.supplier_offers where company_id = 'd9100000-0000-4000-8000-000000000002'), 0::bigint, 'Company A cannot read Company B offers');
select throws_ok($$insert into public.supplier_offers(company_id,supplier_id,product_id,unit_cost) values ('d9100000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000001',1)$$, '42501', null, 'Direct Data API insert is denied');
select throws_ok($$update public.supplier_offers set unit_cost = 1 where company_id = 'd9100000-0000-4000-8000-000000000001'$$, '42501', null, 'Direct Data API update is denied');
select throws_ok($$delete from public.supplier_offers where company_id = 'd9100000-0000-4000-8000-000000000001'$$, '42501', null, 'Direct Data API delete is denied');
select throws_ok($$select public.create_supplier_offer('d9100000-0000-4000-8000-000000000002','d9120000-0000-4000-8000-000000000002','d9130000-0000-4000-8000-000000000002',5)$$, 'P0001', 'Sem permissão para gerenciar ofertas', 'A cannot create an offer in company B');
select throws_ok($$select public.create_supplier_offer('d9100000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000002',5)$$, 'P0001', 'Fornecedor ou produto não pertence à empresa', 'An offer cannot link a supplier and product across tenants');
select throws_ok($$select public.create_supplier_offer('d9100000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000001',5,'BRL',null,1,null,'manual','https://supplier.example/offer?token=private',null,current_date,current_date+2)$$, 'P0001', 'A origem deve ser uma URL HTTPS sem credenciais, query ou fragmento', 'Secret-bearing source URL parameters are rejected server-side');

do $$ declare result public.supplier_offers; begin
  result := public.create_supplier_offer(
    'd9100000-0000-4000-8000-000000000001',
    'd9120000-0000-4000-8000-000000000001',
    'd9130000-0000-4000-8000-000000000001',
    12.3456, 'BRL', 25, 5, 7, 'manual', 'https://supplier.example/offer/1',
    'Cotação fictícia validada em teste', current_date, current_date + 14
  );
  perform set_config('test.supplier_offer_id', result.id::text, true);
end $$;
select is((select status from public.supplier_offers where id = current_setting('test.supplier_offer_id')::uuid), 'draft', 'New offer begins as a draft');
select is((select stock from public.products where id = 'd9130000-0000-4000-8000-000000000001'), 7::numeric, 'Recording supplier quantity does not change own inventory');
select is((select count(*) from public.audit_logs where entity = 'SupplierOffer' and entity_id = current_setting('test.supplier_offer_id')::uuid and action = 'supplier_offer.created'), 1::bigint, 'Creation is audited in the same tenant');
select throws_ok($$select public.transition_supplier_offer(current_setting('test.supplier_offer_id')::uuid, 'approved', 'approval without verification')$$, 'P0001', 'Transição de oferta inválida ou sem evidência suficiente', 'Draft cannot skip human verification');

select is((public.transition_supplier_offer(current_setting('test.supplier_offer_id')::uuid, 'pending_verification')).status, 'pending_verification', 'Draft can be submitted for verification');
select is((public.transition_supplier_offer(current_setting('test.supplier_offer_id')::uuid, 'verified', 'Fornecedor confirmou preço e prazo')).status, 'verified', 'Verification records a human note and identity');
select is((public.transition_supplier_offer(current_setting('test.supplier_offer_id')::uuid, 'approved', 'Conferi a fonte e as condições')).status, 'approved', 'Current verified offer can be approved by a permitted human');
select is((select stock from public.products where id = 'd9130000-0000-4000-8000-000000000001'), 7::numeric, 'Verification and approval do not create inventory movements');

select is((public.update_supplier_offer(
  current_setting('test.supplier_offer_id')::uuid,
  'd9120000-0000-4000-8000-000000000001', 'd9130000-0000-4000-8000-000000000001',
  11.00, 'BRL', 20, 5, 6, 'manual', 'https://supplier.example/offer/1',
  'Nova cotação fictícia', current_date, current_date + 30
)).status, 'draft', 'Changing offer terms clears approval and requires a new verification');
select is((select verified_at from public.supplier_offers where id = current_setting('test.supplier_offer_id')::uuid), null::timestamptz, 'Term changes clear the prior verification timestamp');
select is((select count(*) from public.audit_logs where entity = 'SupplierOffer' and entity_id = current_setting('test.supplier_offer_id')::uuid), 5::bigint, 'Create, review transitions, and term changes all leave audit entries');

do $$ declare result public.supplier_offers; begin
  result := public.create_supplier_offer(
    'd9100000-0000-4000-8000-000000000001',
    'd9120000-0000-4000-8000-000000000001',
    'd9130000-0000-4000-8000-000000000001',
    15.00, 'BRL', null, 1, null, 'manual', null,
    'Cotação fictícia expirada', current_date - 10, current_date - 1
  );
  perform set_config('test.supplier_offer_expired_id', result.id::text, true);
end $$;
select is((public.transition_supplier_offer(current_setting('test.supplier_offer_expired_id')::uuid, 'pending_verification')).status, 'pending_verification', 'A recorded stale offer can be sent through review');
select is((public.transition_supplier_offer(current_setting('test.supplier_offer_expired_id')::uuid, 'verified', 'Fornecedor confirmou os dados históricos')).status, 'verified', 'Historical offer can be verified but remains date-bounded');
select throws_ok($$select public.transition_supplier_offer(current_setting('test.supplier_offer_expired_id')::uuid, 'approved', 'tentativa de aprovação')$$, 'P0001', 'Transição de oferta inválida ou sem evidência suficiente', 'Expired terms cannot be approved for current commercial use');
select is((public.transition_supplier_offer(current_setting('test.supplier_offer_expired_id')::uuid, 'expired')).status, 'expired', 'Expired state can be recorded for a stale verified offer');
select is((select stock from public.products where id = 'd9130000-0000-4000-8000-000000000001'), 7::numeric, 'Expired offers do not affect own inventory');
select is((select count(*) from public.audit_logs where entity = 'SupplierOffer' and entity_id = current_setting('test.supplier_offer_expired_id')::uuid), 4::bigint, 'Expiration and review state changes are audited');
select throws_ok($$delete from public.suppliers where id = 'd9120000-0000-4000-8000-000000000001'$$, '23503', null, 'Supplier with offers cannot be deleted and erase provenance');
select throws_ok($$delete from public.products where id = 'd9130000-0000-4000-8000-000000000001'$$, '23503', null, 'Product with offers cannot be deleted and orphan the offer');

select set_config('request.jwt.claim.sub', 'd9110000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.supplier_offers where company_id = 'd9100000-0000-4000-8000-000000000001'), 0::bigint, 'Seller role cannot read purchasing offers');
select throws_ok($$select public.create_supplier_offer('d9100000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000001',1)$$, 'P0001', 'Sem permissão para gerenciar ofertas', 'Seller role cannot create offers through the RPC');
select throws_ok($$select public.transition_supplier_offer(current_setting('test.supplier_offer_id')::uuid, 'pending_verification')$$, 'P0001', 'Sem permissão para gerenciar ofertas', 'Seller role cannot change offer workflow state');

select set_config('request.jwt.claim.sub', 'd9110000-0000-4000-8000-000000000005', true);
select is((select count(*) from public.supplier_offers where company_id = 'd9100000-0000-4000-8000-000000000001'), 0::bigint, 'Commercial role without purchases permission cannot read offers');
select throws_ok($$select public.create_supplier_offer('d9100000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000001',1)$$, 'P0001', 'Sem permissão para gerenciar ofertas', 'Commercial role cannot manage offers through the RPC');

select set_config('request.jwt.claim.sub', 'd9110000-0000-4000-8000-000000000006', true);
select is((select count(*) from public.supplier_offers where company_id = 'd9100000-0000-4000-8000-000000000001'), 0::bigint, 'Finance role without purchases permission cannot read offers');

select set_config('request.jwt.claim.sub', 'd9110000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.supplier_offers where company_id = 'd9100000-0000-4000-8000-000000000001'), 2::bigint, 'Inventory role with existing purchases permission can read offers');
select is((public.create_supplier_offer('d9100000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000001',9)).status, 'draft', 'Inventory role can create a draft through the guarded RPC');

select * from finish();
rollback;
