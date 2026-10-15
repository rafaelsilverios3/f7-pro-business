-- Local-only preparation for Mercado Pago recurring subscriptions. This file
-- must be reviewed and explicitly authorized before any remote application.
begin;

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  checkout_id uuid not null unique references public.billing_checkout_sessions(id),
  plan_id uuid not null references public.plans(id),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_subscription_id text unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_period_snapshot text not null check (billing_period_snapshot in ('month','year')),
  access_status_before_pause text check (access_status_before_pause in ('trial','active','past_due','suspended','cancelled','expired')),
  control_lease_token text,
  control_lease_expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','authorized','paused','past_due','cancelled','rejected','expired')),
  provider_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_checkout_sessions
  add column if not exists provider_subscription_id text;

-- Keep the commercial agreement immutable even if the plan catalog is later
-- repriced. Backfill is only relevant if a prior local partial rollout left
-- subscription rows without snapshots; production migration execution is not
-- authorized in this task.
alter table public.billing_subscriptions add column if not exists amount_minor bigint;
alter table public.billing_subscriptions add column if not exists currency text;
alter table public.billing_subscriptions add column if not exists billing_period_snapshot text;
alter table public.billing_subscriptions add column if not exists access_status_before_pause text;
alter table public.billing_subscriptions add column if not exists control_lease_token text;
alter table public.billing_subscriptions add column if not exists control_lease_expires_at timestamptz;
update public.billing_subscriptions s
set amount_minor = coalesce(s.amount_minor, c.amount_minor),
    currency = coalesce(s.currency, p.currency),
    billing_period_snapshot = coalesce(s.billing_period_snapshot, p.billing_period)
from public.billing_checkout_sessions c, public.plans p
where s.checkout_id = c.id and s.plan_id = p.id
  and (s.amount_minor is null or s.currency is null or s.billing_period_snapshot is null);
alter table public.billing_subscriptions alter column amount_minor set not null;
alter table public.billing_subscriptions alter column currency set not null;
alter table public.billing_subscriptions alter column billing_period_snapshot set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_subscriptions_amount_positive') then
    alter table public.billing_subscriptions add constraint billing_subscriptions_amount_positive check (amount_minor > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'billing_subscriptions_currency_brl') then
    alter table public.billing_subscriptions add constraint billing_subscriptions_currency_brl check (currency = 'BRL');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'billing_subscriptions_period_snapshot') then
    alter table public.billing_subscriptions add constraint billing_subscriptions_period_snapshot check (billing_period_snapshot in ('month','year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'billing_subscriptions_access_pause_snapshot') then
    alter table public.billing_subscriptions add constraint billing_subscriptions_access_pause_snapshot
      check (access_status_before_pause is null or access_status_before_pause in ('trial','active','past_due','suspended','cancelled','expired'));
  end if;
end $$;

alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_subscriptions from anon;
revoke insert, update, delete on public.billing_subscriptions from authenticated;
grant select on public.billing_subscriptions to authenticated;
grant select, insert, update on public.billing_subscriptions to service_role;
drop policy if exists billing_subscriptions_company_select on public.billing_subscriptions;
create policy billing_subscriptions_company_select on public.billing_subscriptions
  for select to authenticated using (public.is_company_member(company_id));

create index if not exists idx_billing_subscriptions_company_updated
  on public.billing_subscriptions(company_id, updated_at desc);

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
      and method='card' for update;
  if not found then raise exception using errcode='P0002', message='CHECKOUT_NOT_FOUND'; end if;
  select * into plan_row from public.plans where id=checkout_row.plan_id and active for share;
  if not found or checkout_row.amount_minor <= 0 or plan_row.currency <> 'BRL'
     or plan_row.billing_period not in ('month','year') then
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
  values(checkout_row.company_id,checkout_row.id,checkout_row.plan_id,p_provider_subscription_id,checkout_row.amount_minor,plan_row.currency,plan_row.billing_period,status_value,p_provider_status)
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
revoke all on function public.persist_billing_subscription(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.persist_billing_subscription(uuid,uuid,text,text) to service_role;

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
      where id=p_checkout_id and provider='mercado_pago' and method='card' for update;
    if found then
      select * into plan_row from public.plans where id=checkout_row.plan_id and active for share;
      if not found then
        update public.billing_webhook_events set status='failed',processed=false,processed_at=null,error_message='PLAN_REFERENCE_MISMATCH',
          metadata=(metadata-'processing_token'-'processing_started_at')||jsonb_build_object('rejection_code','PLAN_REFERENCE_MISMATCH')
          where id=p_event_id;
        return jsonb_build_object('code','PLAN_REFERENCE_MISMATCH');
      end if;
      insert into public.billing_subscriptions(company_id,checkout_id,plan_id,provider_subscription_id,amount_minor,currency,billing_period_snapshot,status,provider_status)
      values(checkout_row.company_id,checkout_row.id,checkout_row.plan_id,p_provider_subscription_id,checkout_row.amount_minor,plan_row.currency,plan_row.billing_period,'pending',p_provider_status)
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
      update public.company_subscriptions set status='cancelled',updated_at=now() where company_id=sub_row.company_id;
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
    insert into public.company_subscriptions(company_id,plan,status,trial_used,current_period_start,current_period_end,updated_at)
    values(sub_row.company_id,plan_row.code,'active',true,period_start,period_end,now())
    on conflict(company_id) do update set plan=excluded.plan,status='active',trial_used=true,
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
revoke all on function public.settle_billing_recurring_event(uuid,text,text,uuid,text,text,text,text,bigint,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_billing_recurring_event(uuid,text,text,uuid,text,text,text,text,bigint,text,timestamptz) to service_role;

create or replace function public.record_billing_subscription_control(
  p_subscription_id uuid,
  p_company_id uuid,
  p_action text,
  p_expected_status text,
  p_provider_status text,
  p_control_token text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  sub_row public.billing_subscriptions%rowtype;
  access_row public.company_subscriptions%rowtype;
  next_status text;
begin
  if p_action is null or p_action not in ('pause','resume','cancel') or p_subscription_id is null or p_company_id is null
     or length(coalesce(p_control_token,'')) not between 1 and 120 then
    raise exception using errcode='22023', message='INVALID_SUBSCRIPTION_CONTROL';
  end if;
  select * into sub_row from public.billing_subscriptions
    where id=p_subscription_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002', message='SUBSCRIPTION_NOT_FOUND'; end if;
  if sub_row.control_lease_token is distinct from p_control_token then
    raise exception using errcode='42501', message='SUBSCRIPTION_CONTROL_LEASE_NOT_OWNED';
  end if;
  if sub_row.status='cancelled' and p_action='cancel' then
    update public.billing_subscriptions set control_lease_token=null,control_lease_expires_at=null where id=sub_row.id;
    return jsonb_build_object('code','OK','status','cancelled','duplicate',true);
  end if;
  if sub_row.status is distinct from p_expected_status then
    return jsonb_build_object('code','SUBSCRIPTION_STATUS_CONFLICT','status',sub_row.status);
  end if;
  if p_action='pause' and sub_row.status <> 'authorized'
     or p_action='resume' and sub_row.status <> 'paused'
     or p_action='cancel' and sub_row.status not in ('pending','authorized','paused','past_due','rejected','expired') then
    return jsonb_build_object('code','SUBSCRIPTION_ACTION_NOT_ALLOWED','status',sub_row.status);
  end if;
  next_status := case p_action when 'pause' then 'paused' when 'resume' then 'authorized' else 'cancelled' end;
  if p_action='pause' then
    select * into access_row from public.company_subscriptions where company_id=p_company_id for update;
    update public.billing_subscriptions set status=next_status,provider_status=p_provider_status,
      access_status_before_pause=case when access_row.status in ('trial','active','past_due','suspended','cancelled','expired') then access_row.status else 'past_due' end,
      control_lease_token=null,control_lease_expires_at=null,updated_at=now() where id=sub_row.id;
  elsif p_action='resume' then
    update public.billing_subscriptions set status=next_status,provider_status=p_provider_status,
      access_status_before_pause=null,control_lease_token=null,control_lease_expires_at=null,updated_at=now() where id=sub_row.id;
  else
    update public.billing_subscriptions set status=next_status,provider_status=p_provider_status,
      cancelled_at=coalesce(cancelled_at,now()),control_lease_token=null,control_lease_expires_at=null,updated_at=now() where id=sub_row.id;
    update public.company_subscriptions set status='cancelled',updated_at=now() where company_id=p_company_id;
  end if;
  insert into public.audit_logs(company_id,action,entity,entity_id,new_data)
  values(p_company_id,'billing.recurring_'||p_action,'billing_subscriptions',sub_row.id,
    jsonb_build_object('status',next_status));
  return jsonb_build_object('code','OK','status',next_status,'duplicate',false);
end;
$$;
revoke all on function public.record_billing_subscription_control(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_billing_subscription_control(uuid,uuid,text,text,text,text) to service_role;

create or replace function public.claim_billing_subscription_control(
  p_subscription_id uuid,
  p_company_id uuid,
  p_action text,
  p_control_token text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  sub_row public.billing_subscriptions%rowtype;
begin
  if p_action is null or p_action not in ('pause','resume','cancel') or p_subscription_id is null or p_company_id is null
     or length(coalesce(p_control_token,'')) not between 1 and 120 then
    raise exception using errcode='22023', message='INVALID_SUBSCRIPTION_CONTROL';
  end if;
  select * into sub_row from public.billing_subscriptions
    where id=p_subscription_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002', message='SUBSCRIPTION_NOT_FOUND'; end if;
  if sub_row.status='cancelled' and p_action='cancel' then
    return jsonb_build_object('code','OK','status','cancelled','duplicate',true);
  end if;
  if sub_row.control_lease_token is not null and sub_row.control_lease_expires_at > now() then
    return jsonb_build_object('code','SUBSCRIPTION_CONTROL_IN_PROGRESS','status',sub_row.status);
  end if;
  if p_action='pause' and sub_row.status <> 'authorized'
     or p_action='resume' and sub_row.status <> 'paused'
     or p_action='cancel' and sub_row.status not in ('pending','authorized','paused','past_due','rejected','expired') then
    return jsonb_build_object('code','SUBSCRIPTION_ACTION_NOT_ALLOWED','status',sub_row.status);
  end if;
  update public.billing_subscriptions set control_lease_token=p_control_token,
    control_lease_expires_at=now()+interval '5 minutes',updated_at=now() where id=sub_row.id;
  return jsonb_build_object('code','OK','status',sub_row.status,'duplicate',false,'lease_token',p_control_token);
end;
$$;
revoke all on function public.claim_billing_subscription_control(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_billing_subscription_control(uuid,uuid,text,text) to service_role;

create or replace function public.release_billing_subscription_control(
  p_subscription_id uuid,
  p_company_id uuid,
  p_control_token text
) returns boolean
language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  update public.billing_subscriptions set control_lease_token=null,control_lease_expires_at=null,updated_at=now()
  where id=p_subscription_id and company_id=p_company_id and control_lease_token=p_control_token;
  return found;
end;
$$;
revoke all on function public.release_billing_subscription_control(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.release_billing_subscription_control(uuid,uuid,text) to service_role;

commit;
