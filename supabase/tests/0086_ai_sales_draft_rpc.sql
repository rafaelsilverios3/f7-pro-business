begin;

select plan(15);

insert into public.companies(id, name) values
  ('d8600000-0000-4000-8000-000000000001', 'Draft RPC Test A'),
  ('d8600000-0000-4000-8000-000000000002', 'Draft RPC Test B');
insert into public.company_users(company_id, user_id, role, active) values
  ('d8600000-0000-4000-8000-000000000001', 'd8610000-0000-4000-8000-000000000001', 'admin', true),
  ('d8600000-0000-4000-8000-000000000002', 'd8610000-0000-4000-8000-000000000002', 'admin', true),
  ('d8600000-0000-4000-8000-000000000001', 'd8610000-0000-4000-8000-000000000003', 'atendimento', true);
insert into public.company_subscriptions(company_id, plan, status) values
  ('d8600000-0000-4000-8000-000000000001', 'pro', 'active'),
  ('d8600000-0000-4000-8000-000000000002', 'pro', 'active');
insert into public.company_feature_overrides(company_id, feature, enabled, reason) values
  ('d8600000-0000-4000-8000-000000000001', 'ai_sales', true, '0086 transactional test'),
  ('d8600000-0000-4000-8000-000000000002', 'ai_sales', true, '0086 transactional test');
insert into public.customers(id, company_id, name) values
  ('d8620000-0000-4000-8000-000000000001', 'd8600000-0000-4000-8000-000000000001', 'Synthetic Draft Customer A');
insert into public.products(id, company_id, name, price, cost, stock, active) values
  ('d8630000-0000-4000-8000-000000000001', 'd8600000-0000-4000-8000-000000000001', 'Synthetic Draft Product A', 12.50, 7.00, 10, true),
  ('d8630000-0000-4000-8000-000000000002', 'd8600000-0000-4000-8000-000000000002', 'Synthetic Draft Product B', 8.00, 4.00, 0, true);

select ok(has_function_privilege('authenticated', 'public.create_draft_sale(jsonb)', 'EXECUTE'), 'Authenticated users can call the guarded draft RPC');
select ok(not has_function_privilege('anon', 'public.create_draft_sale(jsonb)', 'EXECUTE'), 'Anonymous users cannot call the draft RPC');
select ok(not has_function_privilege('service_role', 'public.create_draft_sale(jsonb)', 'EXECUTE'), 'Service role cannot bypass the authenticated draft workflow');

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
do $$ declare denied boolean := false; begin
  begin
    perform public.create_draft_sale('{}'::jsonb);
  exception when insufficient_privilege then denied := true;
  end;
  perform set_config('test.draft_rpc_anon_denied', denied::text, true);
end $$;
select is(current_setting('test.draft_rpc_anon_denied'), 'true', 'Anonymous invocation is rejected by EXECUTE privilege');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$ declare denied boolean := false; begin
  begin
    perform public.create_draft_sale('{}'::jsonb);
  exception when insufficient_privilege then denied := true;
  end;
  perform set_config('test.draft_rpc_service_denied', denied::text, true);
end $$;
select is(current_setting('test.draft_rpc_service_denied'), 'true', 'Service-role invocation is rejected by EXECUTE privilege');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd8610000-0000-4000-8000-000000000001', true);

do $$ declare sale_row public.sales; begin
  sale_row := public.create_draft_sale(jsonb_build_object(
    'company_id', 'd8600000-0000-4000-8000-000000000001',
    'product_id', 'd8630000-0000-4000-8000-000000000001',
    'customer_id', 'd8620000-0000-4000-8000-000000000001',
    'quantity', 2,
    'confirmed', true,
    'idempotency_key', 'draft-rpc-test-a-001'
  ));
  perform set_config('test.draft_rpc_sale_id', sale_row.id::text, true);
end $$;
select is((select count(*) from public.sales where id = current_setting('test.draft_rpc_sale_id')::uuid and company_id = 'd8600000-0000-4000-8000-000000000001'), 1::bigint, 'Authorized company receives one persisted draft');
select is((select status from public.sales where id = current_setting('test.draft_rpc_sale_id')::uuid), 'draft', 'Created sale remains a draft');
select is((select total from public.sales where id = current_setting('test.draft_rpc_sale_id')::uuid), 25::numeric, 'Draft price is calculated from the company product');
select is((select stock from public.products where id = 'd8630000-0000-4000-8000-000000000001'), 10::numeric, 'Creating a draft does not decrement stock');

do $$ declare sale_row public.sales; begin
  sale_row := public.create_draft_sale(jsonb_build_object(
    'company_id', 'd8600000-0000-4000-8000-000000000001',
    'product_id', 'd8630000-0000-4000-8000-000000000001',
    'customer_id', 'd8620000-0000-4000-8000-000000000001',
    'quantity', 2,
    'confirmed', true,
    'idempotency_key', 'draft-rpc-test-a-001'
  ));
  perform set_config('test.draft_rpc_retry_id', sale_row.id::text, true);
end $$;
select is(current_setting('test.draft_rpc_retry_id'), current_setting('test.draft_rpc_sale_id'), 'Repeating the same idempotency key returns the existing draft');

do $$ declare denied boolean := false; begin
  begin
    perform public.create_draft_sale(jsonb_build_object(
      'company_id', 'd8600000-0000-4000-8000-000000000001',
      'product_id', 'd8630000-0000-4000-8000-000000000001',
      'customer_id', 'd8620000-0000-4000-8000-000000000001',
      'quantity', 3,
      'confirmed', true,
      'idempotency_key', 'draft-rpc-test-a-001'
    ));
  exception when others then
    if sqlerrm = 'Chave de idempotência já utilizada por outro pedido' then denied := true; else raise; end if;
  end;
  perform set_config('test.draft_rpc_idempotency_conflict_denied', denied::text, true);
end $$;
select is(current_setting('test.draft_rpc_idempotency_conflict_denied'), 'true', 'An idempotency key cannot be reused with a different payload');

select set_config('request.jwt.claim.sub', 'd8610000-0000-4000-8000-000000000002', true);
do $$ declare blocked boolean := false; begin
  begin
    perform public.create_draft_sale(jsonb_build_object('company_id', 'd8600000-0000-4000-8000-000000000001', 'product_id', 'd8630000-0000-4000-8000-000000000001', 'quantity', 1, 'confirmed', true));
  exception when others then
    if sqlerrm = 'Usuário não pertence à empresa' then blocked := true; else raise; end if;
  end;
  perform set_config('test.draft_rpc_cross_tenant_denied', blocked::text, true);
end $$;
select is(current_setting('test.draft_rpc_cross_tenant_denied'), 'true', 'Company B cannot create a draft for Company A');

select set_config('request.jwt.claim.sub', 'd8610000-0000-4000-8000-000000000003', true);
do $$ declare denied boolean := false; begin
  begin
    perform public.create_draft_sale(jsonb_build_object('company_id', 'd8600000-0000-4000-8000-000000000001', 'product_id', 'd8630000-0000-4000-8000-000000000001', 'quantity', 1, 'confirmed', true));
  exception when others then
    if sqlerrm = 'Sem permissão para criar rascunhos' then denied := true; else raise; end if;
  end;
  perform set_config('test.draft_rpc_role_denied', denied::text, true);
end $$;
select is(current_setting('test.draft_rpc_role_denied'), 'true', 'A tenant member without a sales role cannot create drafts');
select set_config('request.jwt.claim.sub', 'd8610000-0000-4000-8000-000000000001', true);

select set_config('request.jwt.claim.sub', 'd8610000-0000-4000-8000-000000000002', true);
do $$ declare blocked boolean := false; begin
  begin
    perform public.create_draft_sale(jsonb_build_object('company_id', 'd8600000-0000-4000-8000-000000000002', 'product_id', 'd8630000-0000-4000-8000-000000000002', 'quantity', 1, 'confirmed', false));
  exception when others then
    if sqlerrm = 'Confirmação humana obrigatória para criar o rascunho.' then blocked := true; else raise; end if;
  end;
  perform set_config('test.draft_rpc_confirmation_denied', blocked::text, true);
end $$;
select is(current_setting('test.draft_rpc_confirmation_denied'), 'true', 'Unconfirmed draft requests are denied');

do $$ declare blocked boolean := false; begin
  begin
    perform public.create_draft_sale(jsonb_build_object('company_id', 'd8600000-0000-4000-8000-000000000002', 'product_id', 'd8630000-0000-4000-8000-000000000002', 'quantity', 1, 'confirmed', true));
  exception when others then
    if sqlerrm = 'Estoque insuficiente para criar o rascunho.' then blocked := true; else raise; end if;
  end;
  perform set_config('test.draft_rpc_stock_denied', blocked::text, true);
end $$;
select is(current_setting('test.draft_rpc_stock_denied'), 'true', 'Draft requests exceeding available stock are rejected');

select * from finish();
rollback;
