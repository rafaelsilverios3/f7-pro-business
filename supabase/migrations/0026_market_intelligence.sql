-- ETAPA 26: fundação de inteligência de mercado. Revisar e aplicar manualmente.
create table if not exists public.market_sources (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, source_type text, url text, active boolean not null default true, confidence numeric(5,2), metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.market_signals (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid references public.market_sources(id) on delete set null, product_name text not null, signal_type text not null,
  value numeric(14,4), unit text, source text, source_type text, url text, collected_at timestamptz, confidence numeric(5,2), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.market_opportunities (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_name text not null, trend text, demand numeric(14,4), competition numeric(14,4), potential_margin numeric(14,4), risk numeric(14,4), estimated_capital numeric(14,2), opportunity_score numeric(5,2), trust_score numeric(5,2), data_status text not null default 'indisponível', source_ids uuid[] not null default '{}', metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['market_sources','market_signals','market_opportunities'] loop execute format('alter table public.%I enable row level security', t); execute format('drop policy if exists market_intelligence_company_isolation on public.%I', t); execute format('create policy market_intelligence_company_isolation on public.%I for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))', t); execute format('grant select, insert, update, delete on public.%I to authenticated', t); end loop; end $$;
