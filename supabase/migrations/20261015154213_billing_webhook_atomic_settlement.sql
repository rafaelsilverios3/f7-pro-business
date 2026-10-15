-- Settle a validated provider payment and mark its webhook event in one
-- transaction. The caller must first validate the provider signature and
-- acquire a short processing lease in billing_webhook_events.metadata.
-- This RPC is server-only and deliberately uses invoker privileges.
begin;
grant select, insert, update on public.billing_payments,
  public.billing_checkout_sessions, public.billing_webhook_events,
  public.company_subscriptions, public.plans to service_role;
grant insert on public.audit_logs to service_role;
grant select, insert, update on public.billing_payments,
  public.billing_checkout_sessions, public.plans to service_role;

-- Serialize concurrent checkout submissions for the same tenant/user/plan.
-- Provider creation then reuses one stable checkout idempotency key.
create or replace function public.get_or_create_billing_checkout(
  p_company_id uuid,
  p_user_id uuid,
  p_plan_id uuid,
  p_method text
) returns table (
  id uuid,
  company_id uuid,
  user_id uuid,
  plan_id uuid,
  method text,
  amount_minor bigint,
  status text,
  expires_at timestamptz,
  provider_order_id text,
  provider_payment_id text,
  reused boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  plan_row public.plans%rowtype;
  checkout_row public.billing_checkout_sessions%rowtype;
begin
  if p_company_id is null or p_user_id is null or p_plan_id is null or p_method not in ('pix','card') then
    raise exception using errcode = '22023', message = 'INVALID_CHECKOUT_INPUT';
  end if;
  if not exists (
    select 1 from public.company_users m
    where m.company_id = p_company_id and m.user_id = p_user_id and m.active
      and m.role in ('admin','gestor')
  ) then
    raise exception using errcode = '42501', message = 'CHECKOUT_FORBIDDEN';
  end if;
  select p.* into plan_row from public.plans p where p.id = p_plan_id and p.active for share;
  if not found or plan_row.code = 'free' or plan_row.price_minor is null then
    raise exception using errcode = '22023', message = 'CHECKOUT_PLAN_UNAVAILABLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_user_id::text || ':' || p_plan_id::text || ':' || p_method, 0));

  select s.* into checkout_row
  from public.billing_checkout_sessions s
  where s.company_id = p_company_id and s.user_id = p_user_id
    and s.plan_id = p_plan_id and s.method = p_method
    and s.status in ('created','pending') and s.expires_at > now()
  order by s.created_at desc
  limit 1
  for update;

  if checkout_row.id is not null then
    return query select checkout_row.id, checkout_row.company_id, checkout_row.user_id,
      checkout_row.plan_id, checkout_row.method, checkout_row.amount_minor,
      checkout_row.status, checkout_row.expires_at, checkout_row.provider_order_id,
      checkout_row.provider_payment_id, true;
    return;
  end if;

  insert into public.billing_checkout_sessions(company_id,user_id,plan_id,provider,method,
    amount_minor,status,expires_at)
  values(p_company_id,p_user_id,p_plan_id,'mercado_pago',p_method,plan_row.price_minor,
    'created',now() + interval '30 minutes')
  returning * into checkout_row;

  return query select checkout_row.id, checkout_row.company_id, checkout_row.user_id,
    checkout_row.plan_id, checkout_row.method, checkout_row.amount_minor,
    checkout_row.status, checkout_row.expires_at, checkout_row.provider_order_id,
    checkout_row.provider_payment_id, false;
end;
$$;
revoke all on function public.get_or_create_billing_checkout(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.get_or_create_billing_checkout(uuid,uuid,uuid,text) to service_role;

-- Persist the provider order and its pending payment together. A partial
-- checkout/payment write would otherwise make an idempotent retry look done
-- while leaving the customer without a visible payment record.
create or replace function public.persist_billing_checkout_order(
  p_checkout_id uuid,
  p_company_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_currency text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  checkout_row public.billing_checkout_sessions%rowtype;
  payment_row public.billing_payments%rowtype;
  plan_row public.plans%rowtype;
begin
  if p_checkout_id is null or p_company_id is null
     or length(coalesce(p_provider_order_id,'')) = 0
     or length(coalesce(p_provider_payment_id,'')) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_ORDER';
  end if;
  select * into checkout_row from public.billing_checkout_sessions
    where id=p_checkout_id and company_id=p_company_id and provider='mercado_pago'
    for update;
  if not found then raise exception using errcode='P0002', message='CHECKOUT_NOT_FOUND'; end if;
  if checkout_row.status not in ('created','pending') then
    raise exception using errcode='23514', message='CHECKOUT_NOT_OPEN';
  end if;
  select * into plan_row from public.plans where id=checkout_row.plan_id and active for share;
  if not found or upper(coalesce(p_currency,'')) <> upper(coalesce(plan_row.currency,'')) then
    raise exception using errcode='23514', message='CHECKOUT_CURRENCY_MISMATCH';
  end if;
  if checkout_row.provider_order_id is not null and checkout_row.provider_order_id <> p_provider_order_id
     or checkout_row.provider_payment_id is not null and checkout_row.provider_payment_id <> p_provider_payment_id then
    raise exception using errcode='23514', message='CHECKOUT_PROVIDER_REFERENCE_CONFLICT';
  end if;
  select * into payment_row from public.billing_payments
    where provider='mercado_pago' and provider_payment_id=p_provider_payment_id
    for update;
  if found then
    if payment_row.company_id is distinct from p_company_id
       or payment_row.amount_minor is distinct from checkout_row.amount_minor
       or payment_row.currency is distinct from plan_row.currency
       or payment_row.metadata->>'checkout_id' is distinct from checkout_row.id::text then
      raise exception using errcode='23514', message='PROVIDER_PAYMENT_REFERENCE_CONFLICT';
    end if;
    update public.billing_payments set provider_status=p_provider_status,
      status=case when status in ('approved','refunded','charged_back') then status else 'pending' end,
      metadata=metadata || jsonb_build_object('provider_order_id',p_provider_order_id), updated_at=now()
    where id=payment_row.id and company_id=p_company_id;
  else
    insert into public.billing_payments(company_id,provider,provider_payment_id,provider_status,
      amount_minor,currency,status,metadata)
    values(p_company_id,'mercado_pago',p_provider_payment_id,p_provider_status,
      checkout_row.amount_minor,plan_row.currency,'pending',
      jsonb_build_object('checkout_id',checkout_row.id,'plan_code',plan_row.code,
        'provider_order_id',p_provider_order_id));
  end if;
  update public.billing_checkout_sessions set status='pending',
    provider_order_id=p_provider_order_id, provider_payment_id=p_provider_payment_id, updated_at=now()
  where id=checkout_row.id and company_id=p_company_id;
  return jsonb_build_object('code','OK','checkout_id',checkout_row.id);
end;
$$;
revoke all on function public.persist_billing_checkout_order(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.persist_billing_checkout_order(uuid,uuid,text,text,text,text) to service_role;

create or replace function public.settle_billing_webhook_event(
  p_event_id uuid,
  p_processing_token text,
  p_provider_payment_id text,
  p_provider_order_id text,
  p_external_reference text,
  p_provider_status text,
  p_normalized_status text,
  p_provider_amount_minor bigint,
  p_provider_currency text,
  p_evidence jsonb,
  p_paid_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  event_row public.billing_webhook_events%rowtype;
  checkout_row public.billing_checkout_sessions%rowtype;
  payment_row public.billing_payments%rowtype;
  plan_row public.plans%rowtype;
  checkout_id uuid;
  v_company_id uuid;
  expected_amount bigint;
  expected_currency text;
  payment_status text;
  checkout_status text;
  period_start timestamptz;
  period_end timestamptz;
  failure_code text;
begin
  if p_event_id is null or length(coalesce(p_processing_token, '')) < 20
     or length(coalesce(p_provider_payment_id, '')) = 0
     or p_normalized_status not in ('approved','pending','rejected','cancelled','refunded','charged_back') then
    raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_INPUT';
  end if;

  select * into event_row
  from public.billing_webhook_events
  where id = p_event_id and provider = 'mercado_pago'
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'WEBHOOK_EVENT_NOT_FOUND'; end if;
  if event_row.processed or event_row.status in ('processed','ignored') then
    return jsonb_build_object('code','OK','duplicate',true);
  end if;
  if event_row.metadata->>'processing_token' is distinct from p_processing_token then
    raise exception using errcode = '42501', message = 'WEBHOOK_LEASE_NOT_OWNED';
  end if;

  select * into payment_row
  from public.billing_payments
  where provider = 'mercado_pago' and provider_payment_id = p_provider_payment_id
  for update;
  if found then
    v_company_id := payment_row.company_id;
    begin checkout_id := nullif(payment_row.metadata->>'checkout_id','')::uuid;
    exception when invalid_text_representation then checkout_id := null; end;
  end if;

  if checkout_id is null and length(coalesce(p_provider_order_id,'')) > 0 then
    select * into checkout_row
    from public.billing_checkout_sessions
    where provider = 'mercado_pago' and provider_order_id = p_provider_order_id
    for update;
    if found then checkout_id := checkout_row.id; v_company_id := checkout_row.company_id; end if;
  else
    select s.* into checkout_row
    from public.billing_checkout_sessions s
    where s.id = checkout_id and s.company_id = v_company_id
    for update;
  end if;

  if checkout_id is null or checkout_row.id is null then
    update public.billing_webhook_events
      set status = 'ignored', processed = true, processed_at = now(),
          metadata = (metadata - 'processing_token' - 'processing_started_at') ||
                     jsonb_build_object('ignored_reason','checkout_not_found')
      where id = event_row.id;
    return jsonb_build_object('code','OK','ignored',true);
  end if;

  -- Another event for the same order may have inserted the payment while this
  -- transaction waited for the checkout row lock. Re-read after that lock so
  -- concurrent notifications converge on the same payment row.
  if payment_row.id is null then
    select * into payment_row
    from public.billing_payments
    where provider = 'mercado_pago' and provider_payment_id = p_provider_payment_id
    for update;
    if found then v_company_id := payment_row.company_id; end if;
  end if;

  if checkout_row.company_id is distinct from v_company_id then
    failure_code := 'PAYMENT_COMPANY_MISMATCH';
  elsif p_provider_order_id is not null and checkout_row.provider_order_id is distinct from p_provider_order_id then
    failure_code := 'PROVIDER_ORDER_MISMATCH';
  elsif p_provider_order_id is not null and p_external_reference is distinct from checkout_row.id::text then
    failure_code := 'PAYMENT_REFERENCE_MISMATCH';
  end if;

  select * into plan_row from public.plans where id = checkout_row.plan_id;
  if not found or not plan_row.active or plan_row.price_minor is null then
    failure_code := coalesce(failure_code,'PLAN_REFERENCE_MISMATCH');
  end if;
  expected_amount := checkout_row.amount_minor;
  expected_currency := upper(coalesce(plan_row.currency, ''));

  if p_provider_amount_minor is null or p_provider_amount_minor <> expected_amount
     or (payment_row.id is not null and p_provider_amount_minor <> payment_row.amount_minor)
     or plan_row.price_minor is distinct from expected_amount then
    failure_code := coalesce(failure_code,'PAYMENT_AMOUNT_MISMATCH');
  elsif upper(coalesce(p_provider_currency,'')) <> expected_currency then
    failure_code := coalesce(failure_code,'PAYMENT_CURRENCY_MISMATCH');
  end if;

  if failure_code is not null then
    if payment_row.id is not null then
      update public.billing_payments
      set provider_status = p_provider_status, status = 'rejected', updated_at = now(),
          metadata = metadata || coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object('rejection_code',failure_code)
      where id = payment_row.id and company_id = v_company_id;
    end if;
    update public.billing_checkout_sessions
      set status = 'failed', updated_at = now()
      where id = checkout_row.id and company_id = checkout_row.company_id;
    update public.billing_webhook_events
      set status = 'failed', processed = false, processed_at = now(), error_message = failure_code,
          metadata = (metadata - 'processing_token' - 'processing_started_at') ||
                     coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object('rejection_code',failure_code)
      where id = event_row.id;
    return jsonb_build_object('code',failure_code);
  end if;

  -- A provider may send different event IDs for the same already-settled
  -- payment. Converge them without reactivating the subscription or writing
  -- a second audit entry.
  if payment_row.id is not null and payment_row.status = 'approved'
     and p_normalized_status = 'approved' then
    update public.billing_webhook_events
    set status = 'processed', processed = true, processed_at = now(), error_message = null,
        metadata = (metadata - 'processing_token' - 'processing_started_at') ||
                   coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object('normalized_payment_status','approved')
    where id = event_row.id;
    return jsonb_build_object('code','OK','status','approved','duplicate',true,'payment_id',payment_row.id);
  end if;

  payment_status := p_normalized_status;
  checkout_status := case
    when payment_status = 'approved' then 'approved'
    when payment_status in ('pending','refunded') then 'pending'
    else 'failed'
  end;

  if payment_row.id is null then
    insert into public.billing_payments(company_id,provider,provider_payment_id,provider_status,
      amount_minor,currency,status,paid_at,metadata)
    values(checkout_row.company_id,'mercado_pago',p_provider_payment_id,p_provider_status,
      expected_amount,expected_currency,payment_status,
      case when payment_status = 'approved' then coalesce(p_paid_at,now()) else null end,
      jsonb_build_object('checkout_id',checkout_row.id,'plan_code',plan_row.code,
        'provider_order_id',p_provider_order_id) || coalesce(p_evidence,'{}'::jsonb))
    returning * into payment_row;
  else
    if payment_row.company_id is distinct from checkout_row.company_id
       or payment_row.currency is distinct from expected_currency
       or payment_row.amount_minor is distinct from expected_amount
       or (payment_row.metadata ? 'checkout_id' and payment_row.metadata->>'checkout_id' <> checkout_row.id::text) then
      raise exception using errcode = '23514', message = 'PAYMENT_CHECKOUT_CONSISTENCY_FAILED';
    end if;
    update public.billing_payments
    set provider_status = p_provider_status, status = payment_status,
        paid_at = case when payment_status = 'approved' then coalesce(p_paid_at,now()) else null end,
        updated_at = now(), metadata = metadata || coalesce(p_evidence,'{}'::jsonb)
    where id = payment_row.id and company_id = checkout_row.company_id;
  end if;

  update public.billing_checkout_sessions
  set status = checkout_status, updated_at = now()
  where id = checkout_row.id and company_id = checkout_row.company_id;

  if payment_status = 'approved' then
    period_start := now();
    if plan_row.billing_period = 'year' then period_end := period_start + interval '1 year';
    else period_end := period_start + interval '1 month'; end if;
    insert into public.company_subscriptions(company_id,plan,status,trial_used,
      current_period_start,current_period_end,updated_at)
    values(checkout_row.company_id,plan_row.code,'active',true,period_start,period_end,now())
    on conflict (company_id) do update set plan = excluded.plan, status = 'active',
      trial_used = true, current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end, updated_at = now();

    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(checkout_row.company_id,'billing.subscription_activated','company_subscriptions',
      checkout_row.company_id,jsonb_build_object('plan',plan_row.code,
        'payment_id',payment_row.id,'provider_order_id',p_provider_order_id));
  end if;

  update public.billing_webhook_events
  set status = 'processed', processed = true, processed_at = now(), error_message = null,
      metadata = (metadata - 'processing_token' - 'processing_started_at') ||
                 coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object('normalized_payment_status',payment_status)
  where id = event_row.id;

  return jsonb_build_object('code','OK','status',payment_status,'payment_id',payment_row.id);
end;
$$;

revoke all on function public.settle_billing_webhook_event(uuid,text,text,text,text,text,text,bigint,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_billing_webhook_event(uuid,text,text,text,text,text,text,bigint,text,jsonb,timestamptz) to service_role;

comment on function public.settle_billing_webhook_event(uuid,text,text,text,text,text,text,bigint,text,jsonb,timestamptz)
  is 'Atomically settles an already signature-validated Mercado Pago event; callable only by service_role.';
comment on function public.get_or_create_billing_checkout(uuid,uuid,uuid,text)
  is 'Creates or reuses one tenant-scoped checkout under an advisory transaction lock; callable only by service_role.';
comment on function public.persist_billing_checkout_order(uuid,uuid,text,text,text,text)
  is 'Atomically records a Mercado Pago order/payment pair for a tenant-owned checkout; callable only by service_role.';

commit;
