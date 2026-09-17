-- Commercial campaigns foundation (additive only).
-- Source workbook facts are immutable origin values; F7-derived values are
-- stored separately so a reconciliation never overwrites the source.

create table if not exists public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  campaign_type text not null default 'commercial_recovery',
  base_period text,
  compare_period text,
  status text not null default 'draft' check (status in ('draft','active','paused','closed')),
  source_file_name text,
  source_file_hash text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.commercial_campaign_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid references public.commercial_campaigns(id) on delete set null,
  file_name text not null,
  file_hash text not null,
  status text not null default 'preview' check (status in ('preview','review','confirmed','imported','failed')),
  source_metadata jsonb not null default '{}'::jsonb,
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_valid integer not null default 0 check (rows_valid >= 0),
  rows_review integer not null default 0 check (rows_review >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, file_hash)
);

create table if not exists public.commercial_campaign_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  import_id uuid not null references public.commercial_campaign_imports(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  period_base text,
  period_compare text,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  source_customer_name text,
  source_product_code text,
  source_product_name text,
  source_values jsonb not null default '{}'::jsonb,
  source_base_value numeric,
  source_compare_value numeric,
  source_difference numeric,
  source_variation_pct numeric,
  canonical_base_value numeric,
  canonical_compare_value numeric,
  canonical_difference numeric,
  canonical_variation_pct numeric,
  divergence boolean not null default false,
  divergence_details jsonb not null default '{}'::jsonb,
  match_status text not null default 'pending' check (match_status in ('pending','exact','probable','ambiguous','new','invalid','reviewed')),
  review_reason text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, import_id, idempotency_key)
);

create table if not exists public.commercial_campaign_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  import_id uuid not null references public.commercial_campaign_imports(id) on delete cascade,
  fact_id uuid references public.commercial_campaign_facts(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  source_sheet text,
  source_row integer check (source_row is null or source_row > 0),
  imported_priority text check (imported_priority is null or imported_priority in ('P1','P2','P3')),
  f7_priority text check (f7_priority is null or f7_priority in ('P1','P2','P3')),
  status text not null default 'NOT_CONTACTED' check (status in ('NOT_CONTACTED','CONTACTED','RETURN_DUE','NEGOTIATING','QUOTE','RECOVERED','LOST')),
  reason text,
  action text,
  next_action text,
  return_at timestamptz,
  informed_recovery_amount numeric not null default 0 check (informed_recovery_amount >= 0),
  canonical_potential numeric check (canonical_potential is null or canonical_potential >= 0),
  match_status text not null default 'pending' check (match_status in ('pending','exact','probable','ambiguous','new','invalid','reviewed')),
  review_reason text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, import_id, idempotency_key)
);

create table if not exists public.commercial_campaign_outcomes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  target_id uuid not null references public.commercial_campaign_targets(id) on delete cascade,
  crm_activity_id uuid references public.crm_activities(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  informed_amount numeric not null default 0 check (informed_amount >= 0),
  confirmed_amount numeric not null default 0 check (confirmed_amount >= 0),
  confirmed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (company_id, target_id, idempotency_key)
);

create index if not exists commercial_campaigns_company_idx on public.commercial_campaigns(company_id, created_at desc);
create index if not exists commercial_campaign_imports_company_idx on public.commercial_campaign_imports(company_id, created_at desc);
create index if not exists commercial_campaign_facts_company_idx on public.commercial_campaign_facts(company_id, campaign_id, match_status);
create index if not exists commercial_campaign_targets_queue_idx on public.commercial_campaign_targets(company_id, campaign_id, status, imported_priority);
create index if not exists commercial_campaign_outcomes_company_idx on public.commercial_campaign_outcomes(company_id, campaign_id, created_at desc);

create or replace function public.validate_commercial_campaign_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'commercial_campaign_imports' and new.campaign_id is not null
     and not exists (select 1 from public.commercial_campaigns c where c.id = new.campaign_id and c.company_id = new.company_id) then
    raise exception 'campaign tenant mismatch';
  end if;
  if tg_table_name = 'commercial_campaign_facts' then
    if not exists (select 1 from public.commercial_campaigns c where c.id = new.campaign_id and c.company_id = new.company_id)
       or not exists (select 1 from public.commercial_campaign_imports i where i.id = new.import_id and i.company_id = new.company_id) then
      raise exception 'fact tenant mismatch';
    end if;
    if new.customer_id is not null and not exists (select 1 from public.customers x where x.id = new.customer_id and x.company_id = new.company_id) then raise exception 'customer tenant mismatch'; end if;
    if new.product_id is not null and not exists (select 1 from public.products x where x.id = new.product_id and x.company_id = new.company_id) then raise exception 'product tenant mismatch'; end if;
  end if;
  if tg_table_name = 'commercial_campaign_targets' then
    if not exists (select 1 from public.commercial_campaigns c where c.id = new.campaign_id and c.company_id = new.company_id)
       or not exists (select 1 from public.commercial_campaign_imports i where i.id = new.import_id and i.company_id = new.company_id)
       or (new.fact_id is not null and not exists (select 1 from public.commercial_campaign_facts f where f.id = new.fact_id and f.company_id = new.company_id)) then
      raise exception 'target tenant mismatch';
    end if;
    if new.customer_id is not null and not exists (select 1 from public.customers x where x.id = new.customer_id and x.company_id = new.company_id) then raise exception 'customer tenant mismatch'; end if;
    if new.product_id is not null and not exists (select 1 from public.products x where x.id = new.product_id and x.company_id = new.company_id) then raise exception 'product tenant mismatch'; end if;
  end if;
  if tg_table_name = 'commercial_campaign_outcomes' then
    if not exists (select 1 from public.commercial_campaigns c where c.id = new.campaign_id and c.company_id = new.company_id)
       or not exists (select 1 from public.commercial_campaign_targets t where t.id = new.target_id and t.company_id = new.company_id) then
      raise exception 'outcome tenant mismatch';
    end if;
    if new.crm_activity_id is not null and not exists (select 1 from public.crm_activities a where a.id = new.crm_activity_id and a.company_id = new.company_id) then raise exception 'activity tenant mismatch'; end if;
    if new.quote_id is not null and not exists (select 1 from public.quotes q where q.id = new.quote_id and q.company_id = new.company_id) then raise exception 'quote tenant mismatch'; end if;
    if new.sale_id is not null and not exists (select 1 from public.sales s where s.id = new.sale_id and s.company_id = new.company_id) then raise exception 'sale tenant mismatch'; end if;
    if new.confirmed_amount > 0 and new.sale_id is null then raise exception 'confirmed recovery requires linked sale'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_campaign_imports_tenant on public.commercial_campaign_imports;
create trigger commercial_campaign_imports_tenant before insert or update on public.commercial_campaign_imports for each row execute function public.validate_commercial_campaign_tenant();
drop trigger if exists commercial_campaign_facts_tenant on public.commercial_campaign_facts;
create trigger commercial_campaign_facts_tenant before insert or update on public.commercial_campaign_facts for each row execute function public.validate_commercial_campaign_tenant();
drop trigger if exists commercial_campaign_targets_tenant on public.commercial_campaign_targets;
create trigger commercial_campaign_targets_tenant before insert or update on public.commercial_campaign_targets for each row execute function public.validate_commercial_campaign_tenant();
drop trigger if exists commercial_campaign_outcomes_tenant on public.commercial_campaign_outcomes;
create trigger commercial_campaign_outcomes_tenant before insert or update on public.commercial_campaign_outcomes for each row execute function public.validate_commercial_campaign_tenant();

alter table public.commercial_campaigns enable row level security;
alter table public.commercial_campaign_imports enable row level security;
alter table public.commercial_campaign_facts enable row level security;
alter table public.commercial_campaign_targets enable row level security;
alter table public.commercial_campaign_outcomes enable row level security;

create policy commercial_campaigns_select on public.commercial_campaigns for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
create policy commercial_campaigns_manage on public.commercial_campaigns for all to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));
create policy commercial_campaign_imports_select on public.commercial_campaign_imports for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
create policy commercial_campaign_imports_manage on public.commercial_campaign_imports for all to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));
create policy commercial_campaign_facts_select on public.commercial_campaign_facts for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
create policy commercial_campaign_facts_manage on public.commercial_campaign_facts for all to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));
create policy commercial_campaign_targets_select on public.commercial_campaign_targets for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
create policy commercial_campaign_targets_manage on public.commercial_campaign_targets for all to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));
create policy commercial_campaign_outcomes_select on public.commercial_campaign_outcomes for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
create policy commercial_campaign_outcomes_manage on public.commercial_campaign_outcomes for all to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial'));

grant select, insert, update, delete on public.commercial_campaigns, public.commercial_campaign_imports, public.commercial_campaign_facts, public.commercial_campaign_targets, public.commercial_campaign_outcomes to authenticated;
grant all on public.commercial_campaigns, public.commercial_campaign_imports, public.commercial_campaign_facts, public.commercial_campaign_targets, public.commercial_campaign_outcomes to service_role;

