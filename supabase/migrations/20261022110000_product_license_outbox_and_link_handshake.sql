begin;

-- Durable server-to-server delivery. Secrets and privileged credentials remain
-- in Edge Function environments; this table stores only signed-event payloads.
create table if not exists public.product_license_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.commercial_product_licenses(id) on delete restrict,
  commercial_account_id uuid not null references public.commercial_accounts(id) on delete restrict,
  food_company_id uuid not null,
  event_payload jsonb not null check(jsonb_typeof(event_payload)='object'),
  status text not null default 'pending' check(status in ('pending','processing','delivered','retry','blocked')),
  attempts integer not null default 0 check(attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_http_status integer,
  last_error text,
  remote_license_id uuid,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_license_delivery_due_idx
  on public.product_license_delivery_outbox(status,next_attempt_at,created_at)
  where status in ('pending','retry');
create index if not exists product_license_delivery_license_idx
  on public.product_license_delivery_outbox(license_id,created_at desc);
create table if not exists public.product_license_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.product_license_delivery_outbox(id) on delete restrict,
  attempt_number integer not null check(attempt_number > 0),
  result text not null check(result in ('delivered','retry','blocked')),
  http_status integer,
  remote_license_id uuid,
  error_code text,
  occurred_at timestamptz not null default now(),
  unique(outbox_id,attempt_number)
);
create index if not exists product_license_delivery_attempts_history_idx
  on public.product_license_delivery_attempts(outbox_id,occurred_at desc);
create unique index if not exists product_tenant_link_account_verified_uidx
  on public.product_tenant_link_challenges(commercial_account_id) where status='verified';
alter table public.product_license_delivery_outbox enable row level security;
alter table public.product_license_delivery_attempts enable row level security;
revoke all on public.product_license_delivery_outbox from public,anon,authenticated;
revoke all on public.product_license_delivery_attempts from public,anon,authenticated;
grant all on public.product_license_delivery_outbox,public.product_license_delivery_attempts to service_role;

alter table public.product_checkout_settings
  add column if not exists test_checkout_enabled boolean not null default false;

create or replace function public.product_license_delivery_claim(p_outbox_id uuid default null)
returns setof public.product_license_delivery_outbox language plpgsql security definer
set search_path=pg_catalog,public
as $$
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  return query
    with due as (
      select id from public.product_license_delivery_outbox
      where (p_outbox_id is null or id=p_outbox_id)
        and ((status in ('pending','retry') and next_attempt_at<=now())
          or (status='processing' and lease_until<=now()))
      order by created_at asc
      limit case when p_outbox_id is null then 25 else 1 end
      for update skip locked
    )
    update public.product_license_delivery_outbox o
      set status='processing',attempts=o.attempts+1,lease_until=now()+interval '2 minutes',updated_at=now()
      from due where o.id=due.id returning o.*;
end $$;
revoke all on function public.product_license_delivery_claim(uuid) from public,anon,authenticated;
grant execute on function public.product_license_delivery_claim(uuid) to service_role;

create or replace function public.product_food_tenant_for_account(p_account_id uuid)
returns uuid language sql stable security definer
set search_path=pg_catalog,public
as $$
  select c.food_company_id from public.product_tenant_link_challenges c
   where c.commercial_account_id=p_account_id and c.status='verified'
     and c.food_company_id is not null
   order by c.verified_at desc limit 1
$$;
revoke all on function public.product_food_tenant_for_account(uuid) from public,anon,authenticated;
grant execute on function public.product_food_tenant_for_account(uuid) to service_role;

-- Food tenant assignment is accepted only from the one-time authenticated
-- two-sided linking handshake. A direct admin form value cannot choose a tenant.
create or replace function public.product_attach_verified_food_tenant()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare verified_food uuid;
begin
  if new.product_key <> 'f7_food' then
    new.food_company_id := null;
    return new;
  end if;
  verified_food := public.product_food_tenant_for_account(new.commercial_account_id);
  if new.food_company_id is not null and new.food_company_id is distinct from verified_food then
    raise exception using errcode='42501',message='FOOD_TENANT_LINK_NOT_VERIFIED';
  end if;
  new.food_company_id := verified_food;
  return new;
end $$;
revoke all on function public.product_attach_verified_food_tenant() from public,anon,authenticated;
drop trigger if exists product_attach_verified_food_tenant on public.commercial_product_licenses;
create trigger product_attach_verified_food_tenant before insert or update of commercial_account_id,product_key,food_company_id
  on public.commercial_product_licenses for each row execute function public.product_attach_verified_food_tenant();

create or replace function public.product_enqueue_food_license_delivery()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare offer_code_value text; delivery_event uuid; mapped_status text; payload jsonb;
begin
  if new.product_key <> 'f7_food' or new.food_company_id is null then return new; end if;
  if tg_op='UPDATE' and row(new.commercial_account_id,new.product_key,new.offer_id,new.status,new.starts_at,new.ends_at,new.food_company_id)
      is not distinct from row(old.commercial_account_id,old.product_key,old.offer_id,old.status,old.starts_at,old.ends_at,old.food_company_id) then
    return new;
  end if;
  select offer_code into offer_code_value from public.product_offers where id=new.offer_id and product_key='f7_food';
  if offer_code_value is null then raise exception using errcode='23503',message='FOOD_OFFER_NOT_FOUND'; end if;
  mapped_status := case new.status when 'past_due' then 'suspended' else new.status end;
  if mapped_status not in ('trial','active','suspended','expired','cancelled') then
    raise exception using errcode='22023',message='FOOD_LICENSE_STATUS_NOT_SUPPORTED';
  end if;
  delivery_event := gen_random_uuid();
  payload := jsonb_build_object('source_system','f7_business','event_id',delivery_event,
    'license_id',new.id,'company_id',new.food_company_id,'product_key','f7_food',
    'plan_code',offer_code_value,'status',mapped_status,'starts_at',new.starts_at,
    'ends_at',new.ends_at,'reason','Commercial F7 Business license update');
  insert into public.product_license_delivery_outbox(id,license_id,commercial_account_id,food_company_id,event_payload)
    values(delivery_event,new.id,new.commercial_account_id,new.food_company_id,payload);
  return new;
end $$;
revoke all on function public.product_enqueue_food_license_delivery() from public,anon,authenticated;
drop trigger if exists product_enqueue_food_license_delivery on public.commercial_product_licenses;
create trigger product_enqueue_food_license_delivery after insert or update of offer_id,status,starts_at,ends_at,food_company_id
  on public.commercial_product_licenses for each row execute function public.product_enqueue_food_license_delivery();

-- Start is invoked only by the authenticated PRO Edge Function. The account
-- owner's session is validated there and the function rechecks membership.
create or replace function public.product_link_challenge_start(
  p_account_id uuid,p_actor_id uuid,p_pro_company_id uuid,p_proof_digest text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare challenge_id uuid; expiry timestamptz;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_actor_id is null or p_account_id is null or p_pro_company_id is null or coalesce(length(p_proof_digest),0)<>64
     or p_proof_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='PRODUCT_LINK_INPUT_INVALID';
  end if;
  if not exists(select 1 from public.commercial_account_members m
    where m.commercial_account_id=p_account_id and m.user_id=p_actor_id and m.active and m.role in ('owner','admin')) then
    raise exception using errcode='42501',message='COMMERCIAL_ACCOUNT_ADMIN_REQUIRED';
  end if;
  if not exists(select 1 from public.company_users u
    where u.company_id=p_pro_company_id and u.user_id=p_actor_id and u.active and u.role='admin') then
    raise exception using errcode='42501',message='PRO_COMPANY_ADMIN_REQUIRED';
  end if;
  expiry:=now()+interval '15 minutes';
  insert into public.product_tenant_link_challenges(commercial_account_id,pro_company_id,status,pro_proof_digest,pro_verified_at,expires_at)
    values(p_account_id,p_pro_company_id,'pending',p_proof_digest,now(),expiry)
    returning id into challenge_id;
  return jsonb_build_object('challenge_id',challenge_id,'expires_at',expiry);
end $$;
revoke all on function public.product_link_challenge_start(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.product_link_challenge_start(uuid,uuid,uuid,text) to service_role;

-- Food Edge Function calls this after checking the authenticated Food user is
-- an active administrator of the submitted company and signing the request.
create or replace function public.product_link_challenge_accept(
  p_proof_digest text,p_food_company_id uuid,p_food_user_id uuid,p_food_proof_digest text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare challenge public.product_tenant_link_challenges; prior public.product_tenant_link_challenges;
  linked_license public.commercial_product_licenses;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if coalesce(length(p_proof_digest),0)<>64 or p_proof_digest !~ '^[a-f0-9]{64}$'
     or coalesce(length(p_food_proof_digest),0)<>64 or p_food_proof_digest !~ '^[a-f0-9]{64}$'
     or p_food_company_id is null or p_food_user_id is null then
    raise exception using errcode='22023',message='PRODUCT_LINK_INPUT_INVALID';
  end if;
  select * into challenge from public.product_tenant_link_challenges
   where pro_proof_digest=p_proof_digest order by created_at desc limit 1 for update;
  if challenge.id is null then raise exception using errcode='P0002',message='PRODUCT_LINK_CHALLENGE_NOT_FOUND'; end if;
  if challenge.status='verified' then
    if challenge.food_company_id=p_food_company_id then
      return jsonb_build_object('status','duplicate','challenge_id',challenge.id);
    end if;
    raise exception using errcode='23505',message='PRODUCT_LINK_CHALLENGE_ALREADY_USED';
  end if;
  if challenge.status<>'pending' or challenge.expires_at<=now() then
    update public.product_tenant_link_challenges set status='expired' where id=challenge.id and status='pending';
    raise exception using errcode='22023',message='PRODUCT_LINK_CHALLENGE_EXPIRED';
  end if;
  if exists(select 1 from public.product_tenant_link_challenges c where c.food_company_id=p_food_company_id and c.status='verified') then
    raise exception using errcode='23505',message='FOOD_TENANT_ALREADY_LINKED';
  end if;
  update public.product_tenant_link_challenges set food_company_id=p_food_company_id,
    food_verified_at=now(),verified_at=now(),
    status='verified',food_proof_digest=p_food_proof_digest
    where id=challenge.id returning * into challenge;
  update public.commercial_product_licenses set food_company_id=p_food_company_id,updated_at=now()
    where commercial_account_id=challenge.commercial_account_id and product_key='f7_food'
    returning * into linked_license;
  return jsonb_build_object('status','verified','challenge_id',challenge.id,
    'commercial_account_id',challenge.commercial_account_id,'food_company_id',p_food_company_id,
    'license_linked',linked_license.id is not null);
end $$;
revoke all on function public.product_link_challenge_accept(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.product_link_challenge_accept(text,uuid,uuid,text) to service_role;

-- A sandbox payment can provision only after the webhook Edge Function has
-- verified Mercado Pago's signature and fetched the payment independently.
-- Test settlement is separately disabled by default and cannot run while live
-- charging is enabled; the legacy PRO billing settlement remains untouched.
create or replace function public.confirm_product_test_checkout_payment(
  p_provider_event_id text,p_checkout_id uuid,p_provider_payment_id text,
  p_amount_minor bigint,p_currency text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare session_row public.product_checkout_sessions; event_row public.product_checkout_webhook_events;
  setting_row public.product_checkout_settings; license_row public.commercial_product_licenses;
  expiration timestamptz;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if coalesce(length(btrim(p_provider_event_id)),0) not between 1 and 200
     or coalesce(length(btrim(p_provider_payment_id)),0) not between 1 and 200
     or p_checkout_id is null then
    raise exception using errcode='22023',message='PRODUCT_PAYMENT_INPUT_INVALID';
  end if;
  select * into setting_row from public.product_checkout_settings where singleton=true;
  if coalesce(setting_row.live_charges_enabled,true) or not coalesce(setting_row.test_checkout_enabled,false) then
    return jsonb_build_object('status','checkout_disabled');
  end if;
  select * into session_row from public.product_checkout_sessions where id=p_checkout_id for update;
  if session_row.id is null then return jsonb_build_object('status','checkout_not_found'); end if;
  if session_row.provider not in ('mercado_pago') or session_row.amount_minor is distinct from p_amount_minor
     or upper(session_row.currency)<>upper(coalesce(p_currency,'')) then
    raise exception using errcode='22023',message='PRODUCT_PAYMENT_MISMATCH';
  end if;
  insert into public.product_checkout_webhook_events(provider,provider_event_id,checkout_id,event_type)
    values('mercado_pago',btrim(p_provider_event_id),p_checkout_id,'payment.approved.sandbox')
    on conflict(provider,provider_event_id) do nothing returning * into event_row;
  if event_row.id is null then
    return jsonb_build_object('status','duplicate');
  end if;
  if session_row.status='paid' then
    if session_row.provider_payment_id<>btrim(p_provider_payment_id) then
      update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
      raise exception using errcode='23505',message='PRODUCT_CHECKOUT_ALREADY_SETTLED';
    end if;
    update public.product_checkout_webhook_events set status='processed',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','already_paid');
  end if;
  if session_row.status not in ('prepared','pending') then
    update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','not_payable');
  end if;
  update public.product_checkout_sessions set status='paid',provider='mercado_pago',
    provider_payment_id=btrim(p_provider_payment_id),updated_at=now() where id=session_row.id;
  expiration:=case session_row.billing_period when 'month' then now()+interval '1 month'
    when 'year' then now()+interval '1 year' else null end;
  insert into public.commercial_product_licenses(commercial_account_id,product_key,offer_id,status,starts_at,ends_at,source,external_subscription_ref)
    values(session_row.commercial_account_id,session_row.product_key,session_row.offer_id,'active',now(),expiration,'payment',btrim(p_provider_payment_id))
    on conflict(commercial_account_id,product_key) do update set offer_id=excluded.offer_id,status='active',
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,source='payment',
      external_subscription_ref=excluded.external_subscription_ref,updated_at=now()
    returning * into license_row;
  insert into public.commercial_product_license_events(commercial_account_id,license_id,product_key,action,reason,before_state,after_state,command_id)
    values(session_row.commercial_account_id,license_row.id,session_row.product_key,'payment_confirmed',
      'Verified Mercado Pago sandbox payment; no live charge',null,to_jsonb(license_row),session_row.id);
  update public.product_checkout_webhook_events set status='processed',processed_at=now() where id=event_row.id;
  return jsonb_build_object('status','paid','license_id',license_row.id,'checkout_id',session_row.id);
end $$;
revoke all on function public.confirm_product_test_checkout_payment(text,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_product_test_checkout_payment(text,uuid,text,bigint,text) to service_role;

create or replace function public.reconcile_product_test_payment_status(
  p_provider_event_id text,p_checkout_id uuid,p_provider_payment_id text,p_provider_status text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare session_row public.product_checkout_sessions; event_row public.product_checkout_webhook_events;
  license_row public.commercial_product_licenses; setting_row public.product_checkout_settings; before_state jsonb;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if coalesce(length(btrim(p_provider_event_id)),0) not between 1 and 200
     or coalesce(length(btrim(p_provider_payment_id)),0) not between 1 and 200
     or p_checkout_id is null or p_provider_status not in ('refunded','charged_back','cancelled','rejected','pending','in_process') then
    raise exception using errcode='22023',message='PRODUCT_PAYMENT_RECONCILIATION_INPUT_INVALID';
  end if;
  select * into setting_row from public.product_checkout_settings where singleton=true;
  if coalesce(setting_row.live_charges_enabled,true) or not coalesce(setting_row.test_checkout_enabled,false) then
    return jsonb_build_object('status','checkout_disabled');
  end if;
  insert into public.product_checkout_webhook_events(provider,provider_event_id,checkout_id,event_type)
    values('mercado_pago',btrim(p_provider_event_id),p_checkout_id,'payment.'||p_provider_status)
    on conflict(provider,provider_event_id) do nothing returning * into event_row;
  if event_row.id is null then return jsonb_build_object('status','duplicate'); end if;
  select * into session_row from public.product_checkout_sessions where id=p_checkout_id for update;
  if session_row.id is null or session_row.provider_payment_id is distinct from btrim(p_provider_payment_id) then
    update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','payment_reference_mismatch');
  end if;
  if p_provider_status in ('refunded','charged_back','cancelled') then
    select * into license_row from public.commercial_product_licenses
      where commercial_account_id=session_row.commercial_account_id and product_key=session_row.product_key for update;
    if license_row.id is not null and license_row.external_subscription_ref=btrim(p_provider_payment_id)
       and license_row.source='payment' and license_row.status in ('active','trial','past_due') then
      before_state:=to_jsonb(license_row);
      update public.commercial_product_licenses set status='suspended',updated_at=now()
        where id=license_row.id returning * into license_row;
      insert into public.commercial_product_license_events(commercial_account_id,license_id,product_key,action,reason,before_state,after_state,command_id)
        values(license_row.commercial_account_id,license_row.id,license_row.product_key,'suspended',
          'Verified Mercado Pago sandbox payment reversal',before_state,to_jsonb(license_row),event_row.id);
      update public.product_checkout_webhook_events set status='processed',processed_at=now() where id=event_row.id;
      return jsonb_build_object('status','reconciled','license_status','suspended');
    end if;
  end if;
  update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
  return jsonb_build_object('status','recorded_no_entitlement_change');
end $$;
revoke all on function public.reconcile_product_test_payment_status(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_product_test_payment_status(text,uuid,text,text) to service_role;

commit;
