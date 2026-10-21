begin;

-- Commercial identity is deliberately independent from operational tenants.
-- An account may buy F7 Food without ever creating public.companies in PRO.
create table if not exists public.commercial_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commercial_account_members (
  commercial_account_id uuid not null references public.commercial_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','billing')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (commercial_account_id, user_id)
);
create index if not exists commercial_account_members_user_active_idx
  on public.commercial_account_members(user_id, active);

create or replace function public.is_commercial_account_member(target_account uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$ select auth.uid() is not null and exists (
  select 1 from public.commercial_account_members m
  where m.commercial_account_id=target_account and m.user_id=auth.uid() and m.active
) $$;
revoke all on function public.is_commercial_account_member(uuid) from public, anon;
grant execute on function public.is_commercial_account_member(uuid) to authenticated, service_role;

create or replace function public.create_commercial_account(account_name text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare account_id uuid;
begin
  if auth.uid() is null or coalesce(length(btrim(account_name)),0) not between 2 and 120 then
    raise exception using errcode='22023', message='COMMERCIAL_ACCOUNT_INPUT_INVALID';
  end if;
  insert into public.commercial_accounts(display_name,created_by)
  values (btrim(account_name),auth.uid()) returning id into account_id;
  insert into public.commercial_account_members(commercial_account_id,user_id,role,created_by)
  values(account_id,auth.uid(),'owner',auth.uid());
  return account_id;
end $$;
revoke all on function public.create_commercial_account(text) from public, anon;
grant execute on function public.create_commercial_account(text) to authenticated;

-- Canonical identifiers are stable across PRO and Food. Aliases only normalize
-- inputs; they never rewrite existing subscription rows.
create table if not exists public.product_catalog (
  product_key text primary key check (product_key in ('f7_pro_business','f7_food')),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '',
  access_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_url is null or access_url like 'https://%')
);
create table if not exists public.product_key_aliases (
  alias text primary key check (alias=lower(btrim(alias))),
  product_key text not null references public.product_catalog(product_key) on delete restrict
);
create or replace function public.normalize_product_key(input_key text)
returns text language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select a.product_key from public.product_key_aliases a where a.alias=lower(btrim(input_key))),
    case lower(btrim(input_key)) when 'f7_pro_business' then 'f7_pro_business' when 'f7_food' then 'f7_food' end
  )
$$;

create table if not exists public.product_offers (
  id uuid primary key default gen_random_uuid(),
  product_key text not null references public.product_catalog(product_key) on delete restrict,
  offer_code text not null check (offer_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '',
  price_minor bigint check (price_minor is null or price_minor >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_period text not null check (billing_period in ('none','month','year')),
  trial_days integer check (trial_days is null or trial_days between 0 and 365),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features)='object'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_key, offer_code),
  unique (id, product_key),
  check ((billing_period='none' and price_minor is null) or billing_period<>'none')
);

create table if not exists public.commercial_product_licenses (
  id uuid primary key default gen_random_uuid(),
  commercial_account_id uuid not null references public.commercial_accounts(id) on delete restrict,
  product_key text not null references public.product_catalog(product_key) on delete restrict,
  offer_id uuid not null,
  pro_company_id uuid references public.companies(id) on delete set null,
  food_company_id uuid,
  status text not null check (status in ('trial','active','past_due','suspended','expired','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  source text not null check (source in ('manual','payment','trial')),
  external_subscription_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commercial_account_id, product_key),
  foreign key (offer_id, product_key) references public.product_offers(id, product_key) on delete restrict,
  check (ends_at is null or ends_at > starts_at),
  check ((product_key='f7_pro_business' and food_company_id is null) or (product_key='f7_food' and pro_company_id is null))
);
create index if not exists commercial_product_licenses_account_status_idx
  on public.commercial_product_licenses(commercial_account_id,status,ends_at);
create index if not exists commercial_product_licenses_pro_tenant_idx
  on public.commercial_product_licenses(pro_company_id) where pro_company_id is not null;
create index if not exists commercial_product_licenses_offer_fk_idx
  on public.commercial_product_licenses(offer_id,product_key);
create index if not exists commercial_product_licenses_created_by_fk_idx
  on public.commercial_product_licenses(created_by);
create index if not exists commercial_product_licenses_updated_by_fk_idx
  on public.commercial_product_licenses(updated_by);

create table if not exists public.commercial_product_license_events (
  id uuid primary key default gen_random_uuid(),
  commercial_account_id uuid not null references public.commercial_accounts(id) on delete restrict,
  license_id uuid references public.commercial_product_licenses(id) on delete set null,
  product_key text not null references public.product_catalog(product_key) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','granted','changed','suspended','reactivated','revoked','payment_confirmed')),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  before_state jsonb,
  after_state jsonb not null check (jsonb_typeof(after_state)='object'),
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (actor_id, command_id)
);
create index if not exists commercial_product_license_events_timeline_idx
  on public.commercial_product_license_events(commercial_account_id,product_key,occurred_at desc);
create index if not exists commercial_product_license_events_license_fk_idx
  on public.commercial_product_license_events(license_id);

-- Link challenges require possession proofs in each product. Neither email nor
-- business name is used as an identity key. These records are backend-only.
create table if not exists public.product_tenant_link_challenges (
  id uuid primary key default gen_random_uuid(),
  commercial_account_id uuid not null references public.commercial_accounts(id) on delete cascade,
  pro_company_id uuid references public.companies(id) on delete cascade,
  food_company_id uuid,
  status text not null default 'pending' check (status in ('pending','verified','revoked','expired')),
  pro_proof_digest text check (pro_proof_digest is null or length(pro_proof_digest) between 32 and 256),
  food_proof_digest text check (food_proof_digest is null or length(food_proof_digest) between 32 and 256),
  pro_verified_at timestamptz,
  food_verified_at timestamptz,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (pro_company_id is not null or food_company_id is not null),
  check (status <> 'verified' or (pro_verified_at is not null and food_verified_at is not null and verified_at is not null))
);
create unique index if not exists product_tenant_link_pro_verified_uidx
  on public.product_tenant_link_challenges(pro_company_id) where status='verified' and pro_company_id is not null;
create unique index if not exists product_tenant_link_food_verified_uidx
  on public.product_tenant_link_challenges(food_company_id) where status='verified' and food_company_id is not null;

-- Separate product checkout ledger. The current live charging flag is false;
-- this path does not call the legacy PRO settlement system.
create table if not exists public.product_checkout_settings (
  singleton boolean primary key default true check(singleton),
  live_charges_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.product_checkout_settings(singleton,live_charges_enabled) values(true,false) on conflict(singleton) do nothing;

create table if not exists public.product_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  commercial_account_id uuid not null references public.commercial_accounts(id) on delete restrict,
  offer_id uuid not null references public.product_offers(id) on delete restrict,
  product_key text not null references public.product_catalog(product_key) on delete restrict,
  amount_minor bigint not null check(amount_minor>=0),
  currency text not null default 'BRL' check(currency='BRL'),
  billing_period text not null check(billing_period in ('none','month','year')),
  status text not null default 'prepared' check(status in ('prepared','pending','paid','failed','cancelled','expired')),
  idempotency_key uuid not null,
  provider text check(provider is null or provider='mercado_pago'),
  provider_checkout_id text,
  provider_payment_id text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(commercial_account_id,idempotency_key),
  foreign key(offer_id,product_key) references public.product_offers(id,product_key)
);
create index if not exists product_checkout_sessions_account_status_idx
  on public.product_checkout_sessions(commercial_account_id,status,created_at desc);
create unique index if not exists product_checkout_sessions_provider_payment_uidx
  on public.product_checkout_sessions(provider,provider_payment_id) where provider_payment_id is not null;

create table if not exists public.product_checkout_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider='mercado_pago'),
  provider_event_id text not null,
  checkout_id uuid references public.product_checkout_sessions(id) on delete set null,
  event_type text not null,
  status text not null default 'received' check(status in ('received','processed','ignored','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,provider_event_id)
);
create index if not exists product_checkout_webhook_checkout_idx on public.product_checkout_webhook_events(checkout_id);

create or replace function public.prepare_product_checkout(p_account_id uuid,p_offer_id uuid,p_idempotency_key uuid)
returns public.product_checkout_sessions language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare offer_row public.product_offers; result public.product_checkout_sessions;
begin
  if auth.uid() is null or not public.is_commercial_account_member(p_account_id) then
    raise exception using errcode='42501',message='COMMERCIAL_ACCOUNT_ACCESS_REQUIRED';
  end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='CHECKOUT_IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into offer_row from public.product_offers where id=p_offer_id and active for share;
  if offer_row.id is null then raise exception using errcode='P0002',message='PRODUCT_OFFER_NOT_FOUND'; end if;
  if offer_row.billing_period<>'none' and offer_row.price_minor is null then
    raise exception using errcode='22023',message='PRODUCT_OFFER_PRICE_NOT_CONFIGURED'; end if;
  insert into public.product_checkout_sessions(commercial_account_id,offer_id,product_key,amount_minor,currency,billing_period,idempotency_key,created_by)
    values(p_account_id,offer_row.id,offer_row.product_key,coalesce(offer_row.price_minor,0),offer_row.currency,offer_row.billing_period,p_idempotency_key,auth.uid())
    on conflict(commercial_account_id,idempotency_key) do nothing returning * into result;
  if result.id is null then
    select * into result from public.product_checkout_sessions where commercial_account_id=p_account_id and idempotency_key=p_idempotency_key;
    if result.offer_id<>offer_row.id then raise exception using errcode='23505',message='CHECKOUT_IDEMPOTENCY_KEY_REUSED'; end if;
  end if;
  return result;
end $$;
revoke all on function public.prepare_product_checkout(uuid,uuid,uuid) from public,anon;
grant execute on function public.prepare_product_checkout(uuid,uuid,uuid) to authenticated;

create or replace function public.confirm_product_checkout_payment(
  p_provider_event_id text,p_event_type text,p_checkout_id uuid,p_provider_payment_id text,
  p_amount_minor bigint,p_currency text,p_confirmed boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare session_row public.product_checkout_sessions; event_row public.product_checkout_webhook_events;
  offer_row public.product_offers; license_row public.commercial_product_licenses;
  expiration timestamptz; live_enabled boolean;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if coalesce(length(btrim(p_provider_event_id)),0) not between 1 and 200 or p_checkout_id is null then
    raise exception using errcode='22023',message='PRODUCT_WEBHOOK_INPUT_INVALID'; end if;
  insert into public.product_checkout_webhook_events(provider,provider_event_id,checkout_id,event_type)
    values('mercado_pago',btrim(p_provider_event_id),p_checkout_id,left(coalesce(p_event_type,'unknown'),100))
    on conflict(provider,provider_event_id) do nothing returning * into event_row;
  if event_row.id is null then
    select * into event_row from public.product_checkout_webhook_events where provider='mercado_pago' and provider_event_id=btrim(p_provider_event_id) for update;
    if event_row.status<>'received' then return jsonb_build_object('status','duplicate'); end if;
  end if;
  select * into session_row from public.product_checkout_sessions where id=p_checkout_id for update;
  if session_row.id is null then
    update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','ignored');
  end if;
  select live_charges_enabled into live_enabled from public.product_checkout_settings where singleton=true;
  if coalesce(live_enabled,false)=false then return jsonb_build_object('status','charges_disabled'); end if;
  if not p_confirmed or p_amount_minor is distinct from session_row.amount_minor or upper(coalesce(p_currency,''))<>session_row.currency then
    update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','unconfirmed');
  end if;
  if session_row.status='paid' then
    update public.product_checkout_webhook_events set status='processed',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','already_paid');
  end if;
  if session_row.status not in ('prepared','pending') or coalesce(length(btrim(p_provider_payment_id)),0)=0 then
    update public.product_checkout_webhook_events set status='ignored',processed_at=now() where id=event_row.id;
    return jsonb_build_object('status','not_payable');
  end if;
  update public.product_checkout_sessions set status='paid',provider='mercado_pago',provider_payment_id=btrim(p_provider_payment_id),updated_at=now()
    where id=session_row.id;
  select * into offer_row from public.product_offers where id=session_row.offer_id;
  expiration:=case session_row.billing_period when 'month' then now()+interval '1 month' when 'year' then now()+interval '1 year' else null end;
  insert into public.commercial_product_licenses(commercial_account_id,product_key,offer_id,status,starts_at,ends_at,source,external_subscription_ref)
    values(session_row.commercial_account_id,session_row.product_key,session_row.offer_id,'active',now(),expiration,'payment',btrim(p_provider_payment_id))
    on conflict(commercial_account_id,product_key) do nothing returning * into license_row;
  if license_row.id is not null then
    insert into public.commercial_product_license_events(commercial_account_id,license_id,product_key,action,reason,before_state,after_state,command_id)
      values(session_row.commercial_account_id,license_row.id,session_row.product_key,'payment_confirmed','Payment confirmed by verified Mercado Pago webhook',null,to_jsonb(license_row),session_row.id);
  end if;
  update public.product_checkout_webhook_events set status='processed',processed_at=now() where id=event_row.id;
  return jsonb_build_object('status','paid','license_provisioned',license_row.id is not null);
end $$;
revoke all on function public.confirm_product_checkout_payment(text,text,uuid,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_product_checkout_payment(text,text,uuid,text,bigint,text,boolean) to service_role;

insert into public.product_catalog(product_key,name,description,access_url,sort_order)
values
  ('f7_pro_business','F7 PRO BUSINESS','Gestão empresarial e inteligência comercial.','https://f7business.com.br',10),
  ('f7_food','F7 Food','Operação gastronômica, pedidos, cozinha e atendimento.','https://f7-food.vercel.app',20)
on conflict (product_key) do nothing;
insert into public.product_key_aliases(alias,product_key) values
  ('f7_pro','f7_pro_business'),('pro_business','f7_pro_business'),('food','f7_food'),('f7-food','f7_food')
on conflict(alias) do update set product_key=excluded.product_key;

alter table public.commercial_accounts enable row level security;
alter table public.commercial_account_members enable row level security;
alter table public.product_catalog enable row level security;
alter table public.product_key_aliases enable row level security;
alter table public.product_offers enable row level security;
alter table public.commercial_product_licenses enable row level security;
alter table public.commercial_product_license_events enable row level security;
alter table public.product_tenant_link_challenges enable row level security;
alter table public.product_checkout_settings enable row level security;
alter table public.product_checkout_sessions enable row level security;
alter table public.product_checkout_webhook_events enable row level security;

revoke all on public.commercial_accounts, public.commercial_account_members, public.product_catalog,
  public.product_key_aliases, public.product_offers, public.commercial_product_licenses,
  public.commercial_product_license_events, public.product_tenant_link_challenges,
  public.product_checkout_settings, public.product_checkout_sessions, public.product_checkout_webhook_events
  from public, anon, authenticated;
grant select on public.commercial_accounts, public.commercial_account_members,
  public.commercial_product_licenses, public.commercial_product_license_events,
  public.product_checkout_sessions to authenticated;
grant select on public.product_catalog, public.product_offers to anon, authenticated;
create policy commercial_account_member_read on public.commercial_accounts for select to authenticated
  using (public.is_commercial_account_member(id));
create policy commercial_account_members_read on public.commercial_account_members for select to authenticated
  using (public.is_commercial_account_member(commercial_account_id));
create policy product_catalog_active_read on public.product_catalog for select to anon,authenticated using(active);
create policy product_offers_active_read on public.product_offers for select to anon,authenticated
  using(active and exists(select 1 from public.product_catalog p where p.product_key=product_offers.product_key and p.active));
create policy commercial_license_member_read on public.commercial_product_licenses for select to authenticated
  using(public.is_commercial_account_member(commercial_account_id));
create policy commercial_license_event_member_read on public.commercial_product_license_events for select to authenticated
  using(public.is_commercial_account_member(commercial_account_id));
create policy product_checkout_member_read on public.product_checkout_sessions for select to authenticated
  using(public.is_commercial_account_member(commercial_account_id));
grant all on public.commercial_accounts, public.commercial_account_members, public.product_catalog,
  public.product_key_aliases, public.product_offers, public.commercial_product_licenses,
  public.commercial_product_license_events, public.product_tenant_link_challenges,
  public.product_checkout_settings, public.product_checkout_sessions, public.product_checkout_webhook_events
  to service_role;

create or replace function public.product_platform_admin_set_license(
  p_account_id uuid, p_product_key text, p_offer_id uuid, p_status text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_reason text,
  p_command_id uuid, p_actor_id uuid
) returns public.commercial_product_licenses
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare old_row public.commercial_product_licenses; new_row public.commercial_product_licenses;
begin
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_product_key not in ('f7_pro_business','f7_food') or p_status not in ('trial','active','suspended','expired','cancelled')
     or coalesce(length(btrim(p_reason)),0) not between 5 and 500 or p_command_id is null or p_actor_id is null then
    raise exception using errcode='22023',message='PRODUCT_LICENSE_INPUT_INVALID';
  end if;
  select * into old_row from public.commercial_product_licenses
    where commercial_account_id=p_account_id and product_key=p_product_key for update;
  insert into public.commercial_product_licenses(commercial_account_id,product_key,offer_id,status,starts_at,ends_at,source,created_by,updated_by)
    values(p_account_id,p_product_key,p_offer_id,p_status,coalesce(p_starts_at,now()),p_ends_at,'manual',p_actor_id,p_actor_id)
    on conflict(commercial_account_id,product_key) do update set
      offer_id=excluded.offer_id,status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      source='manual',updated_by=p_actor_id,updated_at=now()
    returning * into new_row;
  insert into public.commercial_product_license_events(commercial_account_id,license_id,product_key,actor_id,action,reason,before_state,after_state,command_id)
    values(p_account_id,new_row.id,p_product_key,p_actor_id,
      case when old_row.id is null then 'granted' when p_status='suspended' then 'suspended' when p_status='active' and old_row.status='suspended' then 'reactivated' when p_status='cancelled' then 'revoked' else 'changed' end,
      btrim(p_reason),case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(new_row),p_command_id);
  return new_row;
end $$;
revoke all on function public.product_platform_admin_set_license(uuid,text,uuid,text,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.product_platform_admin_set_license(uuid,text,uuid,text,timestamptz,timestamptz,text,uuid,uuid) to service_role;

create or replace function public.product_platform_admin_set_offer(
  p_offer_id uuid, p_product_key text, p_offer_code text, p_name text,
  p_description text, p_price_minor bigint, p_billing_period text,
  p_trial_days integer, p_features jsonb, p_active boolean
) returns public.product_offers
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare result public.product_offers;
begin
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_product_key not in ('f7_pro_business','f7_food') or p_billing_period not in ('none','month','year')
     or coalesce(length(btrim(p_name)),0) not between 2 and 100 or coalesce(length(btrim(p_offer_code)),0) not between 2 and 40
     or (p_billing_period='none' and p_price_minor is not null) or (p_billing_period<>'none' and coalesce(p_price_minor,0)<0)
     or coalesce(p_trial_days,0) not between 0 and 365 or jsonb_typeof(coalesce(p_features,'{}'::jsonb)) <> 'object' then
    raise exception using errcode='22023',message='PRODUCT_OFFER_INPUT_INVALID';
  end if;
  if p_offer_id is null then
    insert into public.product_offers(product_key,offer_code,name,description,price_minor,billing_period,trial_days,features,active)
    values(p_product_key,lower(btrim(p_offer_code)),btrim(p_name),coalesce(p_description,''),p_price_minor,p_billing_period,p_trial_days,coalesce(p_features,'{}'::jsonb),p_active)
    returning * into result;
  else
    update public.product_offers set offer_code=lower(btrim(p_offer_code)),name=btrim(p_name),description=coalesce(p_description,''),
      price_minor=p_price_minor,billing_period=p_billing_period,trial_days=p_trial_days,features=coalesce(p_features,'{}'::jsonb),active=p_active,updated_at=now()
    where id=p_offer_id and product_key=p_product_key returning * into result;
    if result.id is null then raise exception using errcode='P0002',message='PRODUCT_OFFER_NOT_FOUND'; end if;
  end if;
  return result;
end $$;
revoke all on function public.product_platform_admin_set_offer(uuid,text,text,text,text,bigint,text,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.product_platform_admin_set_offer(uuid,text,text,text,text,bigint,text,integer,jsonb,boolean) to service_role;

-- No subscription migration/backfill and no production authorization gate swap.
-- Admin grant, offers editing and provider settlement are separate trusted API
-- increments, gated until the official production project is identified.
commit;

-- Rollback is intentionally not automatic: export commercial accounts, product
-- licenses, history, and checkout rows before any manual rollback. Never alter
-- existing company_subscriptions or company_has_feature during rollback.
