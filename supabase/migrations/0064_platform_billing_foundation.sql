-- Platform billing foundation. Prices are intentionally nullable until the product owner defines them.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('free','pro','business','premium')),
  name text not null,
  description text not null default '',
  price_minor bigint,
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_period text not null default 'month' check (billing_period in ('month','year')),
  trial_days integer check (trial_days is null or trial_days >= 0),
  active boolean not null default true,
  highlighted boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_features (
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature text not null,
  enabled boolean not null default false,
  usage_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature)
);

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_customer_id text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.company_subscriptions(id) on delete set null,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_payment_id text,
  provider_status text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','refunded','charged_back')),
  paid_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_id)
);

create table if not exists public.billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  method text not null check (method in ('pix','card')),
  amount_minor bigint not null check (amount_minor >= 0),
  status text not null default 'created' check (status in ('created','pending','approved','failed','expired','cancelled')),
  provider_payment_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_event_id text not null,
  event_type text,
  provider_resource_id text,
  processed boolean not null default false,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  metadata jsonb not null default '{}',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, provider_event_id)
);

insert into public.plans (code, name, description, sort_order, highlighted)
values
  ('free', 'FREE', 'Para começar e conhecer o sistema.', 1, false),
  ('pro', 'PRO', 'Para pequenos negócios que querem organização e inteligência.', 2, true),
  ('business', 'BUSINESS', 'Para empresas que precisam de mais recursos e automações.', 3, false),
  ('premium', 'PREMIUM', 'Para operações mais completas e avançadas.', 4, false)
on conflict (code) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order, highlighted = excluded.highlighted, updated_at = now();

insert into public.plan_features (plan_id, feature, enabled)
select p.id, f.feature, f.expected_enabled
from public.plans p
cross join (values
  ('intelligence', true, array['free','pro','business','premium']),
  ('automations', true, array['pro','business','premium']),
  ('atendimento', true, array['business','premium']),
  ('advanced_reports', true, array['business','premium']),
  ('whatsapp', true, array['business','premium']),
  ('ai', true, array['premium']),
  ('ai_sales', true, array['business','premium'])
) as f(feature, expected_enabled, enabled_plans)
where p.code = any(f.enabled_plans)
on conflict (plan_id, feature) do update set enabled = excluded.enabled, updated_at = now();

alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_checkout_sessions enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists plans_public_active_select on public.plans;
create policy plans_public_active_select on public.plans for select to anon, authenticated using (active = true);
drop policy if exists plan_features_public_select on public.plan_features;
create policy plan_features_public_select on public.plan_features for select to anon, authenticated using (exists (select 1 from public.plans p where p.id = plan_id and p.active));
drop policy if exists billing_customers_company_select on public.billing_customers;
create policy billing_customers_company_select on public.billing_customers for select to authenticated using (public.is_company_member(company_id));
drop policy if exists billing_payments_company_select on public.billing_payments;
create policy billing_payments_company_select on public.billing_payments for select to authenticated using (public.is_company_member(company_id));
drop policy if exists billing_checkout_company_select on public.billing_checkout_sessions;
create policy billing_checkout_company_select on public.billing_checkout_sessions for select to authenticated using (public.is_company_member(company_id) and user_id = auth.uid());

revoke all on public.plans, public.plan_features, public.billing_customers, public.billing_payments, public.billing_checkout_sessions, public.billing_webhook_events from anon;
grant select on public.plans, public.plan_features to anon, authenticated;
grant select on public.billing_customers, public.billing_payments, public.billing_checkout_sessions to authenticated;
grant all on public.plans, public.plan_features, public.billing_customers, public.billing_payments, public.billing_checkout_sessions, public.billing_webhook_events to service_role;

create index if not exists idx_billing_payments_company_created on public.billing_payments(company_id, created_at desc);
create index if not exists idx_billing_payments_provider_id on public.billing_payments(provider, provider_payment_id);
create index if not exists idx_billing_checkout_company_created on public.billing_checkout_sessions(company_id, created_at desc);

create or replace function public.company_has_feature(target_company uuid, feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare plan_name text; override_enabled boolean; configured boolean;
begin
  select o.enabled into override_enabled from public.company_feature_overrides o where o.company_id = target_company and o.feature = lower(trim(feature));
  if override_enabled is not null then return override_enabled; end if;
  select coalesce(s.plan, 'free') into plan_name from public.company_subscriptions s where s.company_id = target_company;
  select pf.enabled into configured from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = plan_name and p.active and pf.feature = lower(trim(feature));
  if configured is not null then return configured; end if;
  return case lower(trim(feature)) when 'intelligence' then true when 'automations' then plan_name in ('pro','business','premium') when 'atendimento' then plan_name in ('business','premium') when 'advanced_reports' then plan_name in ('business','premium') when 'whatsapp' then plan_name in ('business','premium') when 'ai' then plan_name = 'premium' when 'ai_sales' then plan_name in ('business','premium') else false end;
end; $$;
revoke all on function public.company_has_feature(uuid, text) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;
