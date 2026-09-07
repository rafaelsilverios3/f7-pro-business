-- ETAPA 24: fundação do F7 Opportunity. Revisar e aplicar manualmente.
create table if not exists public.product_opportunities (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  title text not null, description text, status text not null default 'descoberta', source text, source_url text,
  collected_at timestamptz, source_type text, confidence_level text, scores jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.opportunity_product_drafts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.product_opportunities(id) on delete cascade, name text not null,
  description text, category text, price numeric(14,2) not null default 0, cost numeric(14,2) not null default 0,
  stock numeric(14,3) not null default 0, active boolean not null default false, status text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['product_opportunities','opportunity_product_drafts'] loop execute format('alter table public.%I enable row level security', t); execute format('drop policy if exists opportunity_company_isolation on public.%I', t); execute format('create policy opportunity_company_isolation on public.%I for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))', t); execute format('grant select, insert, update, delete on public.%I to authenticated', t); end loop; end $$;
create index if not exists product_opportunities_company_status on public.product_opportunities(company_id,status);
create index if not exists opportunity_product_drafts_company on public.opportunity_product_drafts(company_id,opportunity_id);
