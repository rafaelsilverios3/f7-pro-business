-- Run only on an isolated PostgreSQL database after all prerequisite migrations.
-- Fixtures are rolled back; this test never contacts an AI provider.
begin;
insert into auth.users(id) values
 ('11000000-0000-4000-8000-000000000001'),
 ('11000000-0000-4000-8000-000000000002'),
 ('11000000-0000-4000-8000-000000000003') on conflict do nothing;
insert into public.companies(id) values
 ('21000000-0000-4000-8000-000000000001'),
 ('21000000-0000-4000-8000-000000000002') on conflict do nothing;
insert into public.company_users(company_id,user_id,role,active) values
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','admin',true),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','admin',true),
 ('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','gestor',true)
 on conflict do nothing;
insert into public.platform_admins(user_id,role,status,expires_at) values
 ('11000000-0000-4000-8000-000000000001','owner','active',null),
 ('11000000-0000-4000-8000-000000000003','admin','active',null);
insert into public.ai_rate_cards(rate_kind,provider_key,model_key,rate_version,currency,input_cost_per_1k,
  output_cost_per_1k,enabled,effective_from,source_reference)
values
 ('model_tokens','openai','owner-fixture','owner-v1','USD',0.001,0.005,true,now()-interval '1 day','https://example.invalid/rate'),
 ('model_tokens','openai','owner-expensive-fixture','owner-v1','USD',2,2,true,now()-interval '1 day','https://example.invalid/rate-expensive');
insert into public.ai_credit_rate_pricing(rate_card_id,fx_to_brl,markup_bps)
select id,5,10000 from public.ai_rate_cards where model_key in ('owner-fixture','owner-expensive-fixture');
update public.ai_credit_pricing_config set usd_to_brl=5 where singleton;
do $$ begin
  if has_table_privilege('anon','public.platform_owner_ai_usage_operations','select')
    or has_table_privilege('authenticated','public.platform_owner_ai_usage_operations','select')
    or has_table_privilege('service_role','public.platform_owner_ai_usage_operations','select') then
    raise exception 'private owner usage ledger has direct table access grants';
  end if;
end $$;

select set_config('request.jwt.claim.role','authenticated',true),
       set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
  result:=public.platform_owner_ai_usage_policy_v1();
  if result->>'owner_exempt'<>'true' or result#>>'{policy,daily_call_limit}'<>'5'
    or result#>>'{policy,daily_web_query_limit}'<>'0' or (result#>>'{policy,daily_budget_brl}')::numeric<>5 then
    raise exception 'owner pilot defaults incorrect: %',result;
  end if;
end $$;

select set_config('request.jwt.claim.role','authenticated',true),
       set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin
    perform public.platform_owner_ai_usage_policy_v1();
    raise exception 'ordinary platform admin read owner policy';
  exception when insufficient_privilege then null; end;
  begin
    perform public.platform_owner_ai_usage_policy_update_v1(false,5,5,'unauthorized test attempt');
    raise exception 'ordinary platform admin updated owner policy';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.role','authenticated',true),
       set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select public.platform_owner_ai_usage_policy_update_v1(true,5,5,'isolated owner pilot defaults');
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; operation uuid; release_operation uuid; i integer; hash text; begin
  -- The owner is active in a company with no commercial credit entitlement or
  -- subscription setup; owner verification is independent of company plan.
  for i in 1..5 loop
    hash:=repeat(chr(97+i),64);
    result:=public.reserve_platform_owner_ai_usage_v1(
      '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
      'owner-pilot-'||i,hash,'openai','owner-fixture',1000,1000);
    if result->>'allowed'<>'true' or result->>'is_owner'<>'true' then raise exception 'owner should reserve without commercial credits: %',result; end if;
    if i=1 then
      operation:=(result->>'operation_id')::uuid;
      result:=public.settle_platform_owner_ai_usage_v1(operation,'11000000-0000-4000-8000-000000000001',500,500,true);
      if result->>'settled'<>'true' or (result->>'actual_cost_brl')::numeric<=0 then raise exception 'owner actual usage was not settled: %',result; end if;
      result:=public.settle_platform_owner_ai_usage_v1(operation,'11000000-0000-4000-8000-000000000001',500,500,true);
      if result->>'duplicate'<>'true' then raise exception 'owner settlement was not idempotent: %',result; end if;
      result:=public.reserve_platform_owner_ai_usage_v1(
        '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
        'owner-expensive',repeat('e',64),'openai','owner-expensive-fixture',1000,1000);
      if result->>'allowed'<>'false' or result->>'code'<>'OWNER_AI_DAILY_BUDGET_EXCEEDED' then raise exception 'daily BRL cap was not enforced: %',result; end if;
    end if;
    if i=5 then release_operation:=(result->>'operation_id')::uuid; end if;
  end loop;
  result:=public.reserve_platform_owner_ai_usage_v1(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    'owner-pilot-over-limit',repeat('f',64),'openai','owner-fixture',1000,1000);
  if result->>'allowed'<>'false' or result->>'code'<>'OWNER_AI_DAILY_CALL_LIMIT' then raise exception 'sixth daily call was not blocked: %',result; end if;
  if not public.release_platform_owner_ai_usage_v1(release_operation,'11000000-0000-4000-8000-000000000001') then raise exception 'pre-provider reservation was not released'; end if;
  result:=public.reserve_platform_owner_ai_usage_v1(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    'owner-after-release',repeat('9',64),'openai','owner-fixture',1000,1000);
  if result->>'allowed'<>'true' then raise exception 'released reservation did not return its call/budget capacity: %',result; end if;
  if not public.release_platform_owner_ai_usage_v1((result->>'operation_id')::uuid,'11000000-0000-4000-8000-000000000001') then raise exception 'replacement reservation was not released'; end if;
  result:=public.check_platform_owner_web_policy_v1('11000000-0000-4000-8000-000000000001');
  if result->>'allowed'<>'false' then raise exception 'Owner web research should be disabled in pilot: %',result; end if;
  result:=public.reserve_platform_owner_ai_usage_v1(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000099',
    'owner-no-company-membership',repeat('d',64),'openai','owner-fixture',1000,1000);
  if result->>'code'<>'AI_COMPANY_ACCESS_REQUIRED' then raise exception 'owner bypassed company membership: %',result; end if;
  result:=public.reserve_platform_owner_ai_usage_v1(
    '11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001',
    'ordinary-user-not-owner',repeat('c',64),'openai','owner-fixture',1000,1000);
  if result->>'is_owner'<>'false' then raise exception 'ordinary company admin received owner exemption: %',result; end if;
  result:=public.platform_owner_ai_usage_policy_v1();
  if result#>>'{usage,calls}'<>'4' or (result#>>'{usage,actual_cost_brl}')::numeric<=0 then raise exception 'separate actual usage audit incorrect: %',result; end if;
end $$;
select set_config('request.jwt.claim.role','authenticated',true),
       set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select public.platform_owner_ai_usage_policy_update_v1(false,5,5,'disable temporary call and web limits');
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
  result:=public.reserve_platform_owner_ai_usage_v1(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    'owner-hard-ceiling-remains',repeat('b',64),'openai','owner-expensive-fixture',1000,1000);
  if result->>'allowed'<>'false' or result->>'code'<>'OWNER_AI_DAILY_BUDGET_EXCEEDED' then
    raise exception 'disabling temporary quotas bypassed global financial ceiling: %',result;
  end if;
end $$;
rollback;
