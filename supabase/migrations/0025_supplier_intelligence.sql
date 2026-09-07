-- ETAPA 25: inteligência de fornecedores. Revisar e aplicar manualmente.
create table if not exists public.supplier_intelligence_profiles (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, reputation_score numeric(5,2) not null default 0,
  history_score numeric(5,2) not null default 0, price_score numeric(5,2) not null default 0, delivery_score numeric(5,2) not null default 0,
  returns_score numeric(5,2) not null default 0, complaints_score numeric(5,2) not null default 0, consistency_score numeric(5,2) not null default 0,
  supplier_score numeric(5,2) not null default 0, trust_score numeric(5,2) not null default 0, trust_label text not null default 'dados insuficientes',
  data_confidence numeric(5,2) not null default 0, source_summary text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,supplier_id)
);
create table if not exists public.supplier_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, rating numeric(3,2), review_count integer not null default 1,
  comment text, reviewed_at timestamptz, source text, source_type text, sentiment text, recurring_issues text[], created_at timestamptz not null default now()
);
create table if not exists public.supplier_risk_signals (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, signal_type text not null, severity text not null default 'medium',
  description text, source text, needs_validation boolean not null default true, detected_at timestamptz not null default now(), created_at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['supplier_intelligence_profiles','supplier_reviews','supplier_risk_signals'] loop execute format('alter table public.%I enable row level security', t); execute format('drop policy if exists supplier_intelligence_company_isolation on public.%I', t); execute format('drop policy if exists supplier_intelligence_select on public.%I', t); execute format('drop policy if exists supplier_intelligence_insert on public.%I', t); execute format('drop policy if exists supplier_intelligence_update on public.%I', t); execute format('drop policy if exists supplier_intelligence_delete on public.%I', t); execute format('create policy supplier_intelligence_select on public.%I for select to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('create policy supplier_intelligence_insert on public.%I for insert to authenticated with check (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('create policy supplier_intelligence_update on public.%I for update to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial'')) with check (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('create policy supplier_intelligence_delete on public.%I for delete to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('grant select, insert, update, delete on public.%I to authenticated', t); end loop; end $$;
create unique index if not exists suppliers_company_id_key on public.suppliers(company_id,id);
do $$ declare t text; begin foreach t in array array['supplier_intelligence_profiles','supplier_reviews','supplier_risk_signals'] loop execute format('alter table public.%I drop constraint if exists %I', t, t || '_company_supplier_fk'); execute format('alter table public.%I add constraint %I foreign key (company_id,supplier_id) references public.suppliers(company_id,id) on delete cascade', t, t || '_company_supplier_fk'); end loop; end $$;
alter table public.supplier_intelligence_profiles drop constraint if exists supplier_intelligence_trust_label_check;
alter table public.supplier_intelligence_profiles add constraint supplier_intelligence_trust_label_check check (trust_label in ('baixo risco aparente','risco moderado','risco elevado','dados insuficientes'));
alter table public.supplier_intelligence_profiles drop constraint if exists supplier_intelligence_scores_check;
alter table public.supplier_intelligence_profiles add constraint supplier_intelligence_scores_check check (reputation_score between 0 and 100 and history_score between 0 and 100 and price_score between 0 and 100 and delivery_score between 0 and 100 and returns_score between 0 and 100 and complaints_score between 0 and 100 and consistency_score between 0 and 100 and supplier_score between 0 and 100 and trust_score between 0 and 100 and data_confidence between 0 and 100);
alter table public.supplier_reviews drop constraint if exists supplier_reviews_rating_check;
alter table public.supplier_reviews add constraint supplier_reviews_rating_check check (rating is null or rating between 0 and 5);
alter table public.supplier_reviews drop constraint if exists supplier_reviews_count_check;
alter table public.supplier_reviews add constraint supplier_reviews_count_check check (review_count >= 0);
