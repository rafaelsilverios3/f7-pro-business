-- Dual billing models: recurring card subscriptions and one-time period purchases.
-- Local candidate only until separately reviewed and authorized for remote application.
-- Existing server-owned plan price is monthly; annual is exactly 12 x monthly (no discount).
-- Each checkout snapshots its model, period and total; history migrations remain immutable.
-- Conceptual rollback: first stop new checkout/webhook processing and reconcile all pending
-- payments and recurring contracts. Restore the pre-migration RPC definitions from the
-- reviewed parent revision, then remove the v2 settlement/control RPCs and added model,
-- period and checkout-reference columns in reverse dependency order. Preserve billing
-- payment/webhook/audit rows and any already-settled access periods; do not drop snapshots
-- or rewrite subscription history until it is reconciled against provider records and a
-- verified backup. If settlement has occurred, prefer a forward fix over schema rollback.
begin;
alter table public.billing_checkout_sessions add column if not exists billing_model text not null default 'one_time' check (billing_model in ('one_time','recurring')), add column if not exists billing_period_snapshot text;
update public.billing_checkout_sessions c set billing_model='recurring'
from public.billing_subscriptions s where s.checkout_id=c.id;
update public.billing_checkout_sessions c set billing_period_snapshot=s.billing_period_snapshot
from public.billing_subscriptions s where s.checkout_id=c.id and c.billing_period_snapshot is null;
update public.billing_checkout_sessions c set billing_period_snapshot=coalesce(c.billing_period_snapshot,p.billing_period,'month') from public.plans p where p.id=c.plan_id and c.billing_period_snapshot is null;
alter table public.billing_checkout_sessions alter column billing_period_snapshot set not null;
do $$ begin if not exists(select 1 from pg_constraint where conname='billing_checkout_sessions_period_snapshot_check' and conrelid='public.billing_checkout_sessions'::regclass) then alter table public.billing_checkout_sessions add constraint billing_checkout_sessions_period_snapshot_check check (billing_period_snapshot in ('month','year')); end if; end $$;
alter table public.company_subscriptions add column if not exists billing_model text check (billing_model in ('one_time','recurring')), add column if not exists billing_checkout_id uuid references public.billing_checkout_sessions(id) on delete set null;
update public.company_subscriptions cs set billing_model='recurring',billing_checkout_id=(
  select bs.checkout_id from public.billing_subscriptions bs where bs.company_id=cs.company_id
    and bs.status in ('authorized','past_due') and bs.current_period_end>now()
  order by bs.current_period_end desc,bs.updated_at desc limit 1)
where cs.status='active' and exists(select 1 from public.billing_subscriptions bs where bs.company_id=cs.company_id
  and bs.status in ('authorized','past_due') and bs.current_period_end>now()) and cs.billing_model is null;
update public.company_subscriptions cs set billing_model='one_time',billing_checkout_id=(
  select c.id from public.billing_payments bp
  join public.billing_checkout_sessions c on c.id::text=bp.metadata->>'checkout_id'
  where bp.company_id=cs.company_id and bp.status='approved' and c.billing_model='one_time'
    and c.plan_id=(select p.id from public.plans p where p.code=cs.plan)
  order by bp.paid_at desc nulls last,bp.created_at desc limit 1)
where cs.status='active' and cs.billing_model is null and exists(
  select 1 from public.billing_payments bp join public.billing_checkout_sessions c
    on c.id::text=bp.metadata->>'checkout_id'
  where bp.company_id=cs.company_id and bp.status='approved' and c.billing_model='one_time');

create or replace function public.get_or_create_billing_checkout_v2(p_company_id uuid,p_user_id uuid,p_plan_id uuid,p_method text,p_billing_model text,p_billing_period text)
returns table(id uuid,company_id uuid,user_id uuid,plan_id uuid,method text,billing_model text,billing_period_snapshot text,amount_minor bigint,status text,expires_at timestamptz,provider_order_id text,provider_payment_id text,reused boolean)
language plpgsql security invoker set search_path=public,pg_temp as $$
declare plan_row public.plans%rowtype; checkout_row public.billing_checkout_sessions%rowtype; base_price numeric; calculated_price bigint; current_contract record;
begin
 if p_company_id is null or p_user_id is null or p_plan_id is null or p_method is null or p_billing_model is null or p_billing_period is null or p_method not in ('pix','card') or p_billing_model not in ('one_time','recurring') or p_billing_period not in ('month','year') or (p_billing_model='recurring' and p_method<>'card') then raise exception using errcode='22023',message='INVALID_CHECKOUT_INPUT'; end if;
 if not exists(select 1 from public.company_users m where m.company_id=p_company_id and m.user_id=p_user_id and m.active and m.role in ('admin','gestor')) then raise exception using errcode='42501',message='CHECKOUT_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-checkout',0));
 select * into plan_row from public.plans p where p.id=p_plan_id and p.active for share;
 if not found or plan_row.code='free' or plan_row.price_minor is null or plan_row.price_minor<=0 or plan_row.currency<>'BRL' then raise exception using errcode='22023',message='CHECKOUT_PLAN_UNAVAILABLE'; end if;
 base_price:=plan_row.price_minor;
 if p_billing_period=plan_row.billing_period then calculated_price:=plan_row.price_minor;
 elsif p_billing_period='year' and plan_row.billing_period='month' then if base_price*12>9007199254740991 then raise exception using errcode='22003',message='CHECKOUT_PRICE_OVERFLOW'; end if; calculated_price:=(base_price*12)::bigint;
 else raise exception using errcode='22023',message='CHECKOUT_PERIOD_PRICE_UNAVAILABLE'; end if;
 select s.status,s.plan,s.current_period_end,s.billing_model,s.billing_checkout_id into current_contract from public.company_subscriptions s where s.company_id=p_company_id for update;
 if found and current_contract.status='active' and current_contract.current_period_end>now() then
   if current_contract.billing_model is distinct from p_billing_model or current_contract.plan is distinct from plan_row.code or current_contract.billing_checkout_id is null then raise exception using errcode='23514',message='ACTIVE_CONTRACT_MUST_END_OR_CANCEL_BEFORE_SWITCH'; end if;
   if p_billing_model='recurring' then raise exception using errcode='23514',message='ACTIVE_RECURRING_CONTRACT_ALREADY_EXISTS'; end if;
 end if;
 if p_billing_model='recurring' and exists(select 1 from public.billing_subscriptions s where s.company_id=p_company_id and s.status in ('pending','authorized','paused','past_due')) then raise exception using errcode='23514',message='ACTIVE_RECURRING_CONTRACT_ALREADY_EXISTS'; end if;
 select s.* into checkout_row from public.billing_checkout_sessions s where s.company_id=p_company_id and s.user_id=p_user_id and s.plan_id=p_plan_id and s.method=p_method and s.billing_model=p_billing_model and s.billing_period_snapshot=p_billing_period and s.status in ('created','pending') and s.expires_at>now() order by s.created_at desc limit 1 for update;
 if checkout_row.id is not null then return query select checkout_row.id,checkout_row.company_id,checkout_row.user_id,checkout_row.plan_id,checkout_row.method,checkout_row.billing_model,checkout_row.billing_period_snapshot,checkout_row.amount_minor,checkout_row.status,checkout_row.expires_at,checkout_row.provider_order_id,checkout_row.provider_payment_id,true; return; end if;
 if exists(select 1 from public.billing_checkout_sessions s where s.company_id=p_company_id and s.status in ('created','pending') and s.expires_at>now()) then raise exception using errcode='23514',message='ANOTHER_CHECKOUT_IS_STILL_OPEN'; end if;
 insert into public.billing_checkout_sessions(company_id,user_id,plan_id,provider,method,billing_model,billing_period_snapshot,amount_minor,status,expires_at) values(p_company_id,p_user_id,p_plan_id,'mercado_pago',p_method,p_billing_model,p_billing_period,calculated_price,'created',now()+interval '30 minutes') returning * into checkout_row;
 return query select checkout_row.id,checkout_row.company_id,checkout_row.user_id,checkout_row.plan_id,checkout_row.method,checkout_row.billing_model,checkout_row.billing_period_snapshot,checkout_row.amount_minor,checkout_row.status,checkout_row.expires_at,checkout_row.provider_order_id,checkout_row.provider_payment_id,false;
end; $$;
revoke all on function public.get_or_create_billing_checkout_v2(uuid,uuid,uuid,text,text,text) from public,anon,authenticated; grant execute on function public.get_or_create_billing_checkout_v2(uuid,uuid,uuid,text,text,text) to service_role;
create or replace function public.persist_billing_checkout_payment(p_checkout_id uuid,p_company_id uuid,p_provider_payment_id text,p_provider_status text,p_currency text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare checkout_row public.billing_checkout_sessions%rowtype; payment_row public.billing_payments%rowtype;
begin
 if p_checkout_id is null or p_company_id is null or length(coalesce(p_provider_payment_id,'')) not between 1 and 120 or p_provider_status is null or p_currency is null then raise exception using errcode='22023',message='INVALID_PROVIDER_PAYMENT'; end if;
 select * into checkout_row from public.billing_checkout_sessions where id=p_checkout_id and company_id=p_company_id and provider='mercado_pago' and billing_model='one_time' and method='card' for update;
 if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
 if checkout_row.status not in ('created','pending') then raise exception using errcode='23514',message='CHECKOUT_NOT_OPEN'; end if;
 if checkout_row.provider_payment_id is not null and checkout_row.provider_payment_id<>p_provider_payment_id then raise exception using errcode='23514',message='PAYMENT_REFERENCE_CONFLICT'; end if;
 select * into payment_row from public.billing_payments where provider='mercado_pago' and provider_payment_id=p_provider_payment_id for update;
 if found and (payment_row.company_id<>p_company_id or payment_row.amount_minor<>checkout_row.amount_minor or payment_row.currency<>upper(coalesce(p_currency,'')) or payment_row.metadata->>'checkout_id'<>checkout_row.id::text) then raise exception using errcode='23514',message='PAYMENT_CHECKOUT_CONSISTENCY_FAILED'; end if;
 if not found then insert into public.billing_payments(company_id,provider,provider_payment_id,provider_status,amount_minor,currency,status,metadata) values(p_company_id,'mercado_pago',p_provider_payment_id,p_provider_status,checkout_row.amount_minor,upper(p_currency),'pending',jsonb_build_object('checkout_id',checkout_row.id,'billing_model','one_time','billing_period',checkout_row.billing_period_snapshot)) returning * into payment_row; end if;
 update public.billing_checkout_sessions set provider_payment_id=p_provider_payment_id,status='pending',updated_at=now() where id=checkout_row.id and company_id=p_company_id;
 return jsonb_build_object('code','OK','payment_id',payment_row.id,'status',payment_row.status);
end; $$;
revoke all on function public.persist_billing_checkout_payment(uuid,uuid,text,text,text) from public,anon,authenticated; grant execute on function public.persist_billing_checkout_payment(uuid,uuid,text,text,text) to service_role;
create or replace function public.persist_billing_subscription(
  p_checkout_id uuid,
  p_company_id uuid,
  p_provider_subscription_id text,
  p_provider_status text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  checkout_row public.billing_checkout_sessions%rowtype;
  subscription_row public.billing_subscriptions%rowtype;
  plan_row public.plans%rowtype;
  status_value text;
begin
  if p_checkout_id is null or p_company_id is null
     or length(coalesce(p_provider_subscription_id,'')) not between 1 and 120 then
    raise exception using errcode='22023', message='INVALID_SUBSCRIPTION_REFERENCE';
  end if;
  select * into checkout_row from public.billing_checkout_sessions
    where id=p_checkout_id and company_id=p_company_id and provider='mercado_pago'
      and method='card' and billing_model='recurring' for update;
  if not found then raise exception using errcode='P0002', message='CHECKOUT_NOT_FOUND'; end if;
  select * into plan_row from public.plans where id=checkout_row.plan_id and active for share;
  if not found or checkout_row.amount_minor <= 0 or plan_row.currency <> 'BRL'
     or checkout_row.billing_period_snapshot not in ('month','year') then
    raise exception using errcode='23514', message='SUBSCRIPTION_TERMS_INVALID';
  end if;
  if checkout_row.provider_subscription_id is not null
     and checkout_row.provider_subscription_id <> p_provider_subscription_id then
    raise exception using errcode='23514', message='SUBSCRIPTION_REFERENCE_CONFLICT';
  end if;
  status_value := case lower(coalesce(p_provider_status,''))
    when 'authorized' then 'authorized'
    when 'paused' then 'paused'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'rejected' then 'rejected'
    else 'pending' end;
  insert into public.billing_subscriptions(company_id,checkout_id,plan_id,provider_subscription_id,amount_minor,currency,billing_period_snapshot,status,provider_status)
  values(checkout_row.company_id,checkout_row.id,checkout_row.plan_id,p_provider_subscription_id,checkout_row.amount_minor,plan_row.currency,checkout_row.billing_period_snapshot,status_value,p_provider_status)
  on conflict (checkout_id) do update set
    provider_subscription_id=coalesce(public.billing_subscriptions.provider_subscription_id,excluded.provider_subscription_id),
    status=case when public.billing_subscriptions.status='authorized' and excluded.status='pending'
      then public.billing_subscriptions.status else excluded.status end,
    provider_status=excluded.provider_status, updated_at=now()
  returning * into subscription_row;
  if subscription_row.provider_subscription_id <> p_provider_subscription_id then
    raise exception using errcode='23514', message='SUBSCRIPTION_REFERENCE_CONFLICT';
  end if;
  update public.billing_checkout_sessions set status='pending',
    provider_subscription_id=p_provider_subscription_id, updated_at=now()
  where id=checkout_row.id and company_id=p_company_id;
  return jsonb_build_object('code','OK','subscription_id',subscription_row.id,'status',subscription_row.status);
end;
$$;
create or replace function public.record_billing_subscription_control(
  p_subscription_id uuid,p_company_id uuid,p_action text,p_expected_status text,p_provider_status text,p_control_token text
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare sub_row public.billing_subscriptions%rowtype; access_row public.company_subscriptions%rowtype; next_status text;
begin
  if p_action is null or p_action not in ('pause','resume','cancel') or p_subscription_id is null or p_company_id is null
     or length(coalesce(p_control_token,'')) not between 1 and 120 then raise exception using errcode='22023',message='INVALID_SUBSCRIPTION_CONTROL'; end if;
  select * into sub_row from public.billing_subscriptions where id=p_subscription_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='SUBSCRIPTION_NOT_FOUND'; end if;
  if sub_row.control_lease_token is distinct from p_control_token then raise exception using errcode='42501',message='SUBSCRIPTION_CONTROL_LEASE_NOT_OWNED'; end if;
  if sub_row.status='cancelled' and p_action='cancel' then
    update public.billing_subscriptions set control_lease_token=null,control_lease_expires_at=null where id=sub_row.id;
    return jsonb_build_object('code','OK','status','cancelled','duplicate',true);
  end if;
  if sub_row.status is distinct from p_expected_status then return jsonb_build_object('code','SUBSCRIPTION_STATUS_CONFLICT','status',sub_row.status); end if;
  if p_action='pause' and sub_row.status<>'authorized' or p_action='resume' and sub_row.status<>'paused'
     or p_action='cancel' and sub_row.status not in ('pending','authorized','paused','past_due','rejected','expired') then
    return jsonb_build_object('code','SUBSCRIPTION_ACTION_NOT_ALLOWED','status',sub_row.status);
  end if;
  next_status:=case p_action when 'pause' then 'paused' when 'resume' then 'authorized' else 'cancelled' end;
  if p_action='pause' then
    select * into access_row from public.company_subscriptions where company_id=p_company_id for update;
    update public.billing_subscriptions set status=next_status,provider_status=p_provider_status,
      access_status_before_pause=case when access_row.status in ('trial','active','past_due','suspended','cancelled','expired') then access_row.status else 'past_due' end,
      control_lease_token=null,control_lease_expires_at=null,updated_at=now() where id=sub_row.id;
  elsif p_action='resume' then
    update public.billing_subscriptions set status=next_status,provider_status=p_provider_status,
      access_status_before_pause=null,control_lease_token=null,control_lease_expires_at=null,updated_at=now() where id=sub_row.id;
  else
    select * into access_row from public.company_subscriptions where company_id=p_company_id for update;
    update public.billing_subscriptions set status=next_status,provider_status=p_provider_status,
      cancelled_at=coalesce(cancelled_at,now()),control_lease_token=null,control_lease_expires_at=null,updated_at=now() where id=sub_row.id;
    update public.company_subscriptions set status=case when access_row.status='active' and access_row.current_period_end>now() then 'active' else 'cancelled' end,updated_at=now()
      where company_id=p_company_id;
  end if;
  insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
  values(p_company_id,'billing.recurring_'||p_action,'billing_subscriptions',sub_row.id,jsonb_build_object('status',next_status));
  return jsonb_build_object('code','OK','status',next_status,'duplicate',false);
end; $$;
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
  lock_company_id uuid;
begin
  if p_event_id is null or length(coalesce(p_processing_token, '')) < 20
     or length(coalesce(p_provider_payment_id, '')) = 0
     or p_normalized_status is null or p_normalized_status not in ('approved','pending','rejected','cancelled','refunded','charged_back') then
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

  -- Reserve and settle for one company under the same advisory lock, always
  -- before locking checkout rows, so late/concurrent renewals cannot shorten
  -- or overwrite a paid period and do not invert checkout lock ordering.
  select company_id into lock_company_id from public.billing_payments
    where provider='mercado_pago' and provider_payment_id=p_provider_payment_id;
  if not found and p_provider_order_id is not null then
    select company_id,id into lock_company_id,checkout_id from public.billing_checkout_sessions
      where provider='mercado_pago' and provider_order_id=p_provider_order_id;
  end if;
  if lock_company_id is null and checkout_id is null and p_external_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select company_id,id into lock_company_id,checkout_id from public.billing_checkout_sessions
      where id=p_external_reference::uuid and provider='mercado_pago' and billing_model='one_time';
  end if;
  if lock_company_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(lock_company_id::text||':billing-checkout',0));
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

  if checkout_id is null and p_provider_order_id is null and p_external_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    checkout_id := p_external_reference::uuid;
    select * into checkout_row from public.billing_checkout_sessions
      where id=checkout_id and provider='mercado_pago' and billing_model='one_time' for update;
    if found then v_company_id := checkout_row.company_id; end if;
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

  if checkout_row.billing_model is distinct from 'one_time' then
    failure_code := 'BILLING_MODEL_MISMATCH';
  elsif checkout_row.company_id is distinct from v_company_id then
    failure_code := 'PAYMENT_COMPANY_MISMATCH';
  elsif p_provider_order_id is not null and checkout_row.provider_order_id is distinct from p_provider_order_id then
    failure_code := 'PROVIDER_ORDER_MISMATCH';
  elsif p_external_reference is distinct from checkout_row.id::text then
    failure_code := 'PAYMENT_REFERENCE_MISMATCH';
  end if;

  select * into plan_row from public.plans where id = checkout_row.plan_id;
  if not found or not plan_row.active then
    failure_code := coalesce(failure_code,'PLAN_REFERENCE_MISMATCH');
  end if;
  expected_amount := checkout_row.amount_minor;
  expected_currency := upper(coalesce(plan_row.currency, ''));

  if p_provider_amount_minor is null or p_provider_amount_minor <> expected_amount
     or (payment_row.id is not null and p_provider_amount_minor <> payment_row.amount_minor)
     then
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
    when payment_status = 'pending' then 'pending'
    when payment_status in ('refunded','charged_back') then 'failed'
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

  if payment_status='approved' and exists(
    select 1 from public.company_subscriptions s
    where s.company_id=checkout_row.company_id and s.status='active' and s.current_period_end>now()
      and s.billing_checkout_id is not null and s.billing_checkout_id<>checkout_row.id
      and (s.billing_model is distinct from 'one_time' or s.plan is distinct from plan_row.code)
  ) then
    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(checkout_row.company_id,'billing.payment_requires_reconciliation','billing_payments',payment_row.id,
      jsonb_build_object('checkout_id',checkout_row.id,'payment_id',payment_row.id,'reason','A_DIFFERENT_ACTIVE_CONTRACT_EXISTS','access_granted',false));
    update public.billing_webhook_events set status='processed',processed=true,processed_at=now(),error_message=null,
      metadata=(metadata-'processing_token'-'processing_started_at')||coalesce(p_evidence,'{}'::jsonb)||
        jsonb_build_object('normalized_payment_status','approved','access_granted',false,'reconciliation_required',true)
      where id=event_row.id;
    return jsonb_build_object('code','OK','status','approved','access_granted',false,'reconciliation_required',true,'payment_id',payment_row.id);
  end if;

  if payment_status = 'approved' then
    period_start := now();
    if checkout_row.billing_model='one_time' then
      select greatest(now(), coalesce(s.current_period_end, now())) into period_start
      from public.company_subscriptions s
      where s.company_id=checkout_row.company_id and s.status='active'
        and s.billing_model='one_time' and s.current_period_end > now() and s.plan=plan_row.code;
      period_start := coalesce(period_start, now());
    end if;
    if checkout_row.billing_period_snapshot = 'year' then period_end := period_start + interval '1 year';
    else period_end := period_start + interval '1 month'; end if;
    insert into public.company_subscriptions(company_id,plan,status,trial_used,billing_model,billing_checkout_id,current_period_start,current_period_end,updated_at)
    values(checkout_row.company_id,plan_row.code,'active',true,'one_time',checkout_row.id,period_start,period_end,now())
    on conflict (company_id) do update set plan=excluded.plan,status='active',trial_used=true,
      billing_model=excluded.billing_model,billing_checkout_id=excluded.billing_checkout_id,
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now();
    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(checkout_row.company_id,'billing.subscription_activated','company_subscriptions',checkout_row.company_id,
      jsonb_build_object('plan',plan_row.code,'billing_model',checkout_row.billing_model,'billing_period',checkout_row.billing_period_snapshot,
        'billing_checkout_id',checkout_row.id,'payment_id',payment_row.id,'provider_order_id',p_provider_order_id));
  elsif payment_status in ('refunded','charged_back') then
    update public.company_subscriptions set status='suspended',updated_at=now()
      where company_id=checkout_row.company_id and billing_checkout_id=checkout_row.id;
    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(checkout_row.company_id,'billing.subscription_reversed','company_subscriptions',checkout_row.company_id,
      jsonb_build_object('billing_checkout_id',checkout_row.id,'payment_id',payment_row.id,'status',payment_status));
  end if;

  update public.billing_webhook_events
  set status = 'processed', processed = true, processed_at = now(), error_message = null,
      metadata = (metadata - 'processing_token' - 'processing_started_at') ||
                 coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object('normalized_payment_status',payment_status)
  where id = event_row.id;

  return jsonb_build_object('code','OK','status',payment_status,'payment_id',payment_row.id);
end;
$$;
create or replace function public.settle_billing_recurring_event(
  p_event_id uuid,
  p_processing_token text,
  p_event_kind text,
  p_checkout_id uuid,
  p_provider_subscription_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_payment_status text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  event_row public.billing_webhook_events%rowtype;
  sub_row public.billing_subscriptions%rowtype;
  checkout_row public.billing_checkout_sessions%rowtype;
  plan_row public.plans%rowtype;
  payment_row public.billing_payments%rowtype;
  status_value text;
  period_start timestamptz;
  period_end timestamptz;
  previous_subscription_status text;
begin
  if p_event_kind not in ('preapproval','authorized_payment')
     or length(coalesce(p_provider_subscription_id,'')) not between 1 and 120 then
    raise exception using errcode='22023', message='INVALID_RECURRING_EVENT';
  end if;
  select * into event_row from public.billing_webhook_events
    where id=p_event_id and provider='mercado_pago' for update;
  if not found then raise exception using errcode='P0002', message='WEBHOOK_EVENT_NOT_FOUND'; end if;
  if event_row.processed or event_row.status in ('processed','ignored') then
    return jsonb_build_object('code','OK','duplicate',true);
  end if;
  if event_row.metadata->>'processing_token' is distinct from p_processing_token then
    raise exception using errcode='42501', message='WEBHOOK_LEASE_NOT_OWNED';
  end if;
  select * into sub_row from public.billing_subscriptions
    where provider='mercado_pago' and provider_subscription_id=p_provider_subscription_id for update;
  if not found and p_checkout_id is not null then
    select * into checkout_row from public.billing_checkout_sessions
      where id=p_checkout_id and provider='mercado_pago' and method='card' and billing_model='recurring' for update;
    if found then
      select * into plan_row from public.plans where id=checkout_row.plan_id and active for share;
      if not found then
        update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='PLAN_REFERENCE_MISMATCH',
          metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','PLAN_REFERENCE_MISMATCH')
          where id=p_event_id;
        return jsonb_build_object('code','PLAN_REFERENCE_MISMATCH');
      end if;
      insert into public.billing_subscriptions(company_id,checkout_id,plan_id,provider_subscription_id,amount_minor,currency,billing_period_snapshot,status,provider_status)
      values(checkout_row.company_id,checkout_row.id,checkout_row.plan_id,p_provider_subscription_id,checkout_row.amount_minor,plan_row.currency,checkout_row.billing_period_snapshot,'pending',p_provider_status)
      on conflict (checkout_id) do update set
        provider_subscription_id=coalesce(public.billing_subscriptions.provider_subscription_id,excluded.provider_subscription_id),
        provider_status=excluded.provider_status,updated_at=now();
      select * into sub_row from public.billing_subscriptions where checkout_id=p_checkout_id for update;
      update public.billing_checkout_sessions set provider_subscription_id=p_provider_subscription_id,status='pending',updated_at=now()
        where id=checkout_row.id and company_id=checkout_row.company_id;
    end if;
  end if;
  if sub_row.id is null then
    update public.billing_webhook_events set status='ignored',processed=true,processed_at=now(),
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('ignored_reason','subscription_not_found')
      where id=p_event_id;
    return jsonb_build_object('code','OK','ignored',true);
  end if;
  if sub_row.provider_subscription_id is distinct from p_provider_subscription_id then
    update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='SUBSCRIPTION_REFERENCE_CONFLICT',
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','SUBSCRIPTION_REFERENCE_CONFLICT')
      where id=p_event_id;
    return jsonb_build_object('code','SUBSCRIPTION_REFERENCE_CONFLICT');
  end if;
  select * into plan_row from public.plans where id=sub_row.plan_id for share;
  if not found or not plan_row.active or plan_row.price_minor is null then
    update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='PLAN_REFERENCE_MISMATCH',
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','PLAN_REFERENCE_MISMATCH')
      where id=p_event_id;
    return jsonb_build_object('code','PLAN_REFERENCE_MISMATCH');
  end if;
  if p_event_kind='preapproval' then
    previous_subscription_status := sub_row.status;
    status_value := case lower(coalesce(p_provider_status,''))
      when 'authorized' then 'authorized' when 'paused' then 'paused'
      when 'cancelled' then 'cancelled' when 'canceled' then 'cancelled'
      when 'rejected' then 'rejected' when 'expired' then 'expired' else 'pending' end;
    update public.billing_subscriptions set status=status_value,provider_status=p_provider_status,
      cancelled_at=case when status_value='cancelled' then coalesce(cancelled_at,now()) else cancelled_at end,updated_at=now()
      where id=sub_row.id;
    if status_value='cancelled' then
      update public.company_subscriptions set status=case when current_period_end>now() then 'active' else 'cancelled' end,updated_at=now() where company_id=sub_row.company_id;
    elsif status_value='paused' then
      update public.company_subscriptions set status='suspended',updated_at=now() where company_id=sub_row.company_id;
    end if;
    if previous_subscription_status is distinct from status_value then
      insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
      values(sub_row.company_id,'billing.recurring_status_changed','billing_subscriptions',sub_row.id,
        jsonb_build_object('status',status_value));
    end if;
    update public.billing_webhook_events set status='processed',processed=true,processed_at=now(),error_message=null,
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('normalized_subscription_status',status_value)
      where id=p_event_id;
    return jsonb_build_object('code','OK','status',status_value);
  end if;

  if length(coalesce(p_provider_payment_id,'')) not between 1 and 120
     or p_payment_status not in ('approved','pending','rejected','cancelled','refunded','charged_back') then
    update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='PROVIDER_RESPONSE_INCOMPLETE',
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','PROVIDER_RESPONSE_INCOMPLETE')
      where id=p_event_id;
    return jsonb_build_object('code','PROVIDER_RESPONSE_INCOMPLETE');
  end if;
  if p_amount_minor is distinct from sub_row.amount_minor or upper(coalesce(p_currency,''))<>upper(sub_row.currency) then
    update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH',
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH')
      where id=p_event_id;
    return jsonb_build_object('code','PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH');
  end if;
  select * into payment_row from public.billing_payments where provider='mercado_pago' and provider_payment_id=p_provider_payment_id for update;
  if found and (payment_row.company_id is distinct from sub_row.company_id
      or payment_row.subscription_id is distinct from (select id from public.company_subscriptions where company_id=sub_row.company_id)
      or payment_row.amount_minor is distinct from p_amount_minor or upper(payment_row.currency)<>upper(plan_row.currency)) then
    update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='PAYMENT_REFERENCE_CONFLICT',
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','PAYMENT_REFERENCE_CONFLICT')
      where id=p_event_id;
    return jsonb_build_object('code','PAYMENT_REFERENCE_CONFLICT');
  end if;
  if found and payment_row.status=p_payment_status then
    update public.billing_webhook_events set status='processed',processed=true,processed_at=now(),error_message=null,
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('normalized_payment_status',p_payment_status,'duplicate_payment',true)
      where id=p_event_id;
    return jsonb_build_object('code','OK','status',p_payment_status,'duplicate',true);
  end if;
  if not found then
    insert into public.billing_payments(company_id,subscription_id,provider,provider_payment_id,provider_status,amount_minor,currency,status,paid_at,metadata)
    values(sub_row.company_id,(select id from public.company_subscriptions where company_id=sub_row.company_id),'mercado_pago',p_provider_payment_id,p_provider_status,p_amount_minor,upper(plan_row.currency),p_payment_status,
      case when p_payment_status='approved' then coalesce(p_paid_at,now()) else null end,
      jsonb_build_object('billing_subscription_id',sub_row.id,'plan_code',plan_row.code,'recurring_invoice',true))
    returning * into payment_row;
  else
    update public.billing_payments set provider_status=p_provider_status,status=p_payment_status,
      paid_at=case when p_payment_status='approved' then coalesce(p_paid_at,now()) else null end,updated_at=now()
      where id=payment_row.id and company_id=sub_row.company_id;
  end if;
  if p_payment_status='approved' and sub_row.status in ('paused','cancelled','rejected','expired') then
    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(sub_row.company_id,'billing.recurring_payment_after_inactive_subscription','billing_subscriptions',sub_row.id,
      jsonb_build_object('subscription_status',sub_row.status,'payment_recorded',true,'access_granted',false));
    update public.billing_webhook_events set status='processed',processed=true,processed_at=now(),error_message=null,
      metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('normalized_payment_status','approved','access_granted',false)
      where id=p_event_id;
    return jsonb_build_object('code','OK','status','approved','access_granted',false,'payment_id',payment_row.id);
  end if;
  if p_payment_status='approved' then
    period_start:=coalesce(p_paid_at,now());
    if sub_row.billing_period_snapshot='year' then period_end:=period_start+interval '1 year';
    else period_end:=period_start+interval '1 month'; end if;
    update public.billing_subscriptions set status='authorized',provider_status='authorized',current_period_start=period_start,current_period_end=period_end,updated_at=now()
      where id=sub_row.id;
    insert into public.company_subscriptions(company_id,plan,status,trial_used,billing_model,billing_checkout_id,current_period_start,current_period_end,updated_at)
    values(sub_row.company_id,plan_row.code,'active',true,'recurring',sub_row.checkout_id,period_start,period_end,now())
    on conflict(company_id) do update set plan=excluded.plan,status='active',trial_used=true,
      billing_model='recurring',billing_checkout_id=excluded.billing_checkout_id,
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now();
    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(sub_row.company_id,'billing.recurring_payment_settled','company_subscriptions',
      (select id from public.company_subscriptions where company_id=sub_row.company_id),
      jsonb_build_object('plan_code',plan_row.code,'amount_minor',p_amount_minor,'currency',upper(plan_row.currency)));
  elsif p_payment_status='rejected' or p_payment_status='charged_back' then
    update public.billing_subscriptions set status='past_due',provider_status=p_provider_status,updated_at=now() where id=sub_row.id;
    update public.company_subscriptions set status='past_due',updated_at=now() where company_id=sub_row.company_id;
    insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
    values(sub_row.company_id,'billing.recurring_payment_failed','company_subscriptions',
      (select id from public.company_subscriptions where company_id=sub_row.company_id),jsonb_build_object('status','past_due'));
  elsif p_payment_status in ('cancelled','refunded') then
    update public.company_subscriptions set status='past_due',updated_at=now() where company_id=sub_row.company_id;
  end if;
  update public.billing_webhook_events set status='processed',processed=true,processed_at=now(),error_message=null,
    metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('normalized_payment_status',p_payment_status)
    where id=p_event_id;
  return jsonb_build_object('code','OK','status',p_payment_status,'payment_id',payment_row.id);
end;
$$;
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
  period_end timestamptz;
  override_enabled boolean;
  configured boolean;
begin
  select coalesce(s.plan, 'free'), s.status, s.current_period_end
    into plan_name, subscription_status, period_end
  from public.company_subscriptions s
  where s.company_id = target_company;
  plan_name := coalesce(plan_name, 'free');

  if subscription_status = 'trial'
     or subscription_status in ('expired', 'cancelled', 'suspended', 'past_due') then
    return false;
  end if;

  if subscription_status = 'active' and period_end is not null and period_end <= now() then return false; end if;

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
revoke all on function public.company_has_feature_internal(uuid,text) from public,anon,authenticated; grant execute on function public.company_has_feature_internal(uuid,text) to service_role;

revoke all on function public.persist_billing_subscription(uuid,uuid,text,text) from public,anon,authenticated; grant execute on function public.persist_billing_subscription(uuid,uuid,text,text) to service_role;
revoke all on function public.record_billing_subscription_control(uuid,uuid,text,text,text,text) from public,anon,authenticated; grant execute on function public.record_billing_subscription_control(uuid,uuid,text,text,text,text) to service_role;
revoke all on function public.settle_billing_webhook_event(uuid,text,text,text,text,text,text,bigint,text,jsonb,timestamptz) from public,anon,authenticated; grant execute on function public.settle_billing_webhook_event(uuid,text,text,text,text,text,text,bigint,text,jsonb,timestamptz) to service_role;
revoke all on function public.settle_billing_recurring_event(uuid,text,text,uuid,text,text,text,text,bigint,text,timestamptz) from public,anon,authenticated; grant execute on function public.settle_billing_recurring_event(uuid,text,text,uuid,text,text,text,text,bigint,text,timestamptz) to service_role;

-- Rollback: restore prior function bodies from migrations 0085, 20261015154213 and 20261015172611 before removing columns. Preserve all billing/payment/audit records. No rows are deleted.
commit;
