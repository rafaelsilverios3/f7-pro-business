-- Run with psql against an isolated database after the schema migrations.
-- Every fixture is rolled back; no provider, webhook, or external call is made.
begin;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002')
on conflict do nothing;
insert into public.companies(id) values
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002')
on conflict do nothing;
insert into public.plans(id,code)
values
  ('30000000-0000-4000-8000-000000000001','pro'),
  ('30000000-0000-4000-8000-000000000002','business')
on conflict (code) do nothing;
insert into public.plan_features(plan_id,feature,enabled)
select id,'ai_credits_generation',true from public.plans where code in ('pro','business')
on conflict (plan_id,feature) do update set enabled=true;
insert into public.company_subscriptions(company_id,plan,status,current_period_start,current_period_end)
values
  ('20000000-0000-4000-8000-000000000001','pro','active',now()-interval '1 day',now()+interval '29 days'),
  ('20000000-0000-4000-8000-000000000002','pro','active',now()-interval '1 day',now()+interval '29 days')
on conflict (company_id) do update set plan=excluded.plan,status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_users(company_id,user_id,role,active) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin',true),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','admin',true)
on conflict do nothing;

insert into public.ai_rate_cards(rate_kind,provider_key,model_key,rate_version,currency,input_cost_per_1k,
  output_cost_per_1k,enabled,effective_from,source_reference)
values ('model_tokens','openai','fixture-model','fixture-v1','USD',0.001,0.01,true,
  now()-interval '1 day','https://example.invalid/test');
insert into public.ai_credit_rate_pricing(rate_card_id,fx_to_brl,markup_bps)
select id,5,10000 from public.ai_rate_cards where provider_key='openai' and model_key='fixture-model' and rate_version='fixture-v1';
update public.ai_credit_pricing_config set usd_to_brl=5,confirmation_threshold_credits=20,
  confirmation_balance_bps=1000 where singleton;
select set_config('request.jwt.claim.role','service_role',true),
  set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

do $$
declare quote jsonb; result jsonb; snapshot jsonb; quote_id uuid; operation_id uuid; purchase_id uuid; i integer; request_key text; request_hash text;
begin
  quote:=public.ai_credit_quote_reserve_v1(
    '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000011',repeat('a',64),'openai','fixture-model',1000,16000,null,false);
  if quote->>'code'<>'AI_CREDITS_CONFIRMATION_REQUIRED'
    or (quote->>'max_credits')::integer<=20
    or (quote->>'minimum_balance_after')::integer<>200-(quote->>'max_credits')::integer then
    raise exception 'confirmation quote assertion failed: %',quote;
  end if;
  quote_id:=(quote->>'quote_id')::uuid;
  quote:=public.ai_credit_quote_reserve_v1(
    '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000011',repeat('a',64),'openai','fixture-model',1000,16000,quote_id,true);
  if quote->>'code'<>'AI_CREDITS_RESERVED' then raise exception 'reserve assertion failed: %',quote; end if;
  operation_id:=(quote->>'operation_id')::uuid;
  result:=public.settle_ai_credits_v1('20000000-0000-4000-8000-000000000001',operation_id,100,1000,true);
  if result->>'settled'<>'true' or (result->>'released_credits')::integer<=0 then
    raise exception 'settlement assertion failed: %',result;
  end if;
  result:=public.settle_ai_credits_v1('20000000-0000-4000-8000-000000000001',operation_id,100,1000,true);
  if result->>'duplicate'<>'true' then raise exception 'settlement idempotency failed: %',result; end if;

  -- Two independently quoted operations cannot reserve more than the wallet;
  -- the row lock serializes them and the third reservation is denied.
  for i in 1..2 loop
    request_key:='concurrent-'||i;
    request_hash:=repeat(chr(97+i),64);
    quote:=public.ai_credit_quote_reserve_v1(
      '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      request_key,request_hash,'openai','fixture-model',1000,16000,null,false);
    if quote->>'code'<>'AI_CREDITS_CONFIRMATION_REQUIRED' then raise exception 'expected large-operation confirmation: %',quote; end if;
    quote_id:=(quote->>'quote_id')::uuid;
    result:=public.ai_credit_quote_reserve_v1(
      '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      request_key,request_hash,'openai','fixture-model',1000,16000,quote_id,true);
    if result->>'code'<>'AI_CREDITS_RESERVED' then raise exception 'concurrent reservation denied unexpectedly: %',result; end if;
  end loop;
  quote:=public.ai_credit_quote_reserve_v1(
    '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    'over-reservation',repeat('f',64),'openai','fixture-model',1000,16000,null,false);
  if quote->>'code'<>'AI_CREDITS_INSUFFICIENT' then raise exception 'wallet allowed an over-reservation: %',quote; end if;
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'available')::integer<0 then raise exception 'wallet balance went negative'; end if;

  begin
    perform public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
    raise exception 'cross-tenant snapshot unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;

  result:=public.create_ai_credit_purchase_v1(
    '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    'credits_500','10000000-0000-4000-8000-000000000021');
  if result->>'code'<>'OK' or result->>'status'<>'created' then raise exception 'purchase create failed: %',result; end if;
  purchase_id:=(result->>'id')::uuid;
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'extra_balance')::integer<>0 then raise exception 'credits granted before payment'; end if;
  result:=public.settle_ai_credit_purchase_v1(purchase_id,'fixture-payment','approved',1,'BRL');
  if result->>'code'<>'AI_CREDIT_PURCHASE_PAYMENT_MISMATCH' then raise exception 'wrong payment amount accepted: %',result; end if;
  result:=public.settle_ai_credit_purchase_v1(purchase_id,'fixture-payment','pending',1990,'BRL');
  if result->>'credited'<>'false' then raise exception 'pending purchase credited'; end if;
  result:=public.settle_ai_credit_purchase_v1(purchase_id,'fixture-payment','approved',1990,'BRL');
  if result->>'credited'<>'true' then raise exception 'approved package did not credit: %',result; end if;
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'extra_balance')::integer<>500 then raise exception 'package amount incorrect: %',snapshot; end if;
  result:=public.settle_ai_credit_purchase_v1(purchase_id,'fixture-payment','approved',1990,'BRL');
  if result->>'duplicate'<>'true' then raise exception 'package idempotency failed: %',result; end if;
  result:=public.settle_ai_credit_purchase_v1(purchase_id,'fixture-payment','refunded',1990,'BRL');
  if result->>'status'<>'refunded' then raise exception 'refund failed: %',result; end if;
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'extra_balance')::integer<>0 then raise exception 'refund did not claw back available package credits'; end if;

  begin
    perform public.platform_admin_ai_credit_catalog_v1();
    raise exception 'ordinary company user accessed global admin catalogue';
  exception when insufficient_privilege then null;
  end;

  update public.company_subscriptions set plan='business' where company_id='20000000-0000-4000-8000-000000000001';
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'monthly_allowance')::integer<>500 then raise exception 'mid-cycle plan change allowance not applied: %',snapshot; end if;
  update public.company_subscriptions set status='cancelled' where company_id='20000000-0000-4000-8000-000000000001';
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'monthly_allowance')::integer<>0 or (snapshot->>'monthly_remaining')::integer<>0 then
    raise exception 'cancelled subscription retained included credits: %',snapshot;
  end if;
  for operation_id in
    select id from public.ai_credit_operations
    where ai_credit_operations.request_key in ('10000000-0000-4000-8000-000000000011','concurrent-1','concurrent-2')
      and status='reserved'
  loop
    perform public.settle_ai_credits_v1('20000000-0000-4000-8000-000000000001',operation_id,100,1000,true);
  end loop;
  snapshot:=public.ai_credits_snapshot_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
  if (snapshot->>'monthly_remaining')::integer<>0 then
    raise exception 'settlement after cancellation restored expired included credits: %',snapshot;
  end if;
end $$;

rollback;
