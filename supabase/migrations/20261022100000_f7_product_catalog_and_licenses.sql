begin;

-- Product-scoped catalog for future independent F7 subscriptions. Existing
-- plans, billing rows, subscriptions and authorization gates remain untouched.
create table if not exists public.product_catalog (
  product_key text primary key check (product_key ~ '^f7_[a-z0-9_]{2,40}$'),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '',
  access_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_url is null or access_url like 'https://%')
);

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

create table if not exists public.company_product_licenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_key text not null,
  offer_id uuid not null,
  status text not null check (status in ('trial','active','past_due','suspended','expired','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  source text not null check (source in ('manual','payment','trial','migration')),
  external_subscription_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product_key),
  foreign key (offer_id, product_key) references public.product_offers(id, product_key) on delete restrict,
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists company_product_licenses_company_status_idx
  on public.company_product_licenses(company_id, status, ends_at);
create index if not exists company_product_licenses_offer_fk_idx
  on public.company_product_licenses(offer_id, product_key);
create index if not exists company_product_licenses_created_by_fk_idx
  on public.company_product_licenses(created_by);
create index if not exists company_product_licenses_updated_by_fk_idx
  on public.company_product_licenses(updated_by);

create table if not exists public.company_product_license_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  license_id uuid references public.company_product_licenses(id) on delete set null,
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
create index if not exists company_product_license_events_timeline_idx
  on public.company_product_license_events(company_id, product_key, occurred_at desc);
create index if not exists company_product_license_events_license_fk_idx
  on public.company_product_license_events(license_id);

-- Cross-project tenant links are proof records, not an email/name matching rule.
-- Only trusted server-side code may create or verify these challenges.
create table if not exists public.product_tenant_link_challenges (
  id uuid primary key default gen_random_uuid(),
  pro_company_id uuid not null references public.companies(id) on delete cascade,
  food_company_id uuid not null,
  status text not null default 'pending' check (status in ('pending','verified','revoked','expired')),
  pro_proof_digest text not null check (length(pro_proof_digest) between 32 and 256),
  food_proof_digest text not null check (length(food_proof_digest) between 32 and 256),
  pro_verified_at timestamptz,
  food_verified_at timestamptz,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'verified' or (pro_verified_at is not null and food_verified_at is not null and verified_at is not null))
);
create unique index if not exists product_tenant_link_pro_verified_uidx
  on public.product_tenant_link_challenges(pro_company_id) where status='verified';
create unique index if not exists product_tenant_link_food_verified_uidx
  on public.product_tenant_link_challenges(food_company_id) where status='verified';

insert into public.product_catalog(product_key,name,description,access_url,sort_order)
values
  ('f7_pro_business','F7 PRO BUSINESS','Gestão empresarial e inteligência comercial.',null,10),
  ('f7_food','F7 Food','Operação gastronômica, pedidos, cozinha e atendimento.','https://f7-food.vercel.app',20)
on conflict (product_key) do nothing;

alter table public.product_catalog enable row level security;
alter table public.product_offers enable row level security;
alter table public.company_product_licenses enable row level security;
alter table public.company_product_license_events enable row level security;
alter table public.product_tenant_link_challenges enable row level security;

revoke all on public.product_catalog, public.product_offers, public.company_product_licenses,
  public.company_product_license_events, public.product_tenant_link_challenges from public, anon, authenticated;
grant select on public.product_catalog, public.product_offers to anon, authenticated;
grant select on public.company_product_licenses, public.company_product_license_events to authenticated;

create policy product_catalog_active_read on public.product_catalog
  for select to anon, authenticated using (active);
create policy product_offers_active_read on public.product_offers
  for select to anon, authenticated using (active and exists (
    select 1 from public.product_catalog p where p.product_key=product_offers.product_key and p.active
  ));
create policy company_product_license_member_read on public.company_product_licenses
  for select to authenticated using (public.is_company_member(company_id));
create policy company_product_license_event_member_read on public.company_product_license_events
  for select to authenticated using (public.is_company_member(company_id));
-- No client policies or grants are defined for cross-system proof challenges.
grant all on public.product_catalog, public.product_offers, public.company_product_licenses,
  public.company_product_license_events, public.product_tenant_link_challenges to service_role;

create or replace function public.company_has_product_license(target_company uuid, target_product text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and public.is_company_member(target_company)
    and exists (
      select 1 from public.company_product_licenses l
      join public.product_catalog p on p.product_key=l.product_key and p.active
      join public.product_offers o on o.id=l.offer_id and o.product_key=l.product_key and o.active
      where l.company_id=target_company and l.product_key=lower(btrim(target_product))
        and l.status in ('trial','active') and l.starts_at<=now()
        and (l.ends_at is null or l.ends_at>now())
    );
$$;
revoke all on function public.company_has_product_license(uuid,text) from public, anon;
grant execute on function public.company_has_product_license(uuid,text) to authenticated, service_role;

commit;
