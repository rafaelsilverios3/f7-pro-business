-- Multisegment product/parts intelligence foundation. Apply manually.
-- External adapters remain disabled until explicitly configured per company.
create table if not exists public.product_intelligence_sources (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, source_type text not null check (source_type in ('company_official','manufacturer_official','distributor','public_web','approved_catalog')),
  base_url text, manufacturer text, segment text, enabled boolean not null default false, priority integer not null default 100 check (priority >= 0),
  requires_auth boolean not null default false, integration_type text, trust_level numeric(5,4), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id, name)
);
create table if not exists public.verified_product_applications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  manufacturer text, machine_model text, machine_year text, serial_range text, system text, assembly text, position text, part_number text not null,
  source_refs jsonb not null default '[]'::jsonb, verification_state text not null default 'discovered' check (verification_state in ('discovered','candidate','verified','rejected')),
  verified_by uuid references auth.users(id), verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.part_cross_references (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  original_part_number text not null, equivalent_part_number text not null, original_manufacturer text, equivalent_manufacturer text,
  relation_type text not null check (relation_type in ('OEM_EQUIVALENT','AFTERMARKET','SUPERSEDED_BY','REPLACED_BY','POSSIBLE_MATCH')),
  evidence jsonb not null default '[]'::jsonb, confidence numeric(5,4), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.product_research_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  query text not null, query_hash text, manufacturer text, status text not null default 'started' check (status in ('started','completed','failed','insufficient_data')),
  result jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(), completed_at timestamptz, expires_at timestamptz
);
create table if not exists public.product_research_sources (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  research_run_id uuid not null references public.product_research_runs(id) on delete cascade, source_type text not null, source_name text not null, url text, manufacturer text,
  retrieved_at timestamptz not null default now(), evidence jsonb not null default '{}'::jsonb, confidence numeric(5,4), status text not null default 'success' check (status in ('success','failed','unavailable'))
);
do $$ declare table_name text; begin foreach table_name in array array['product_intelligence_sources','verified_product_applications','part_cross_references','product_research_runs','product_research_sources'] loop
  execute format('alter table public.%I enable row level security', table_name);
  execute format('drop policy if exists product_intelligence_select on public.%I', table_name);
  execute format('drop policy if exists product_intelligence_manage on public.%I', table_name);
  execute format('create policy product_intelligence_select on public.%I for select to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial'',''vendedor'',''atendimento''))', table_name);
  execute format('create policy product_intelligence_manage on public.%I for all to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'')) with check (public.current_company_role(company_id) in (''admin'',''gestor''))', table_name);
  execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
end loop; end $$;
grant select on public.product_intelligence_sources to service_role;
grant select on public.verified_product_applications to service_role;
grant select on public.part_cross_references to service_role;
grant select on public.product_research_runs to service_role;
grant select on public.product_research_sources to service_role;
