-- ETAPA 24: fundação do F7 Opportunity. Revisar e aplicar manualmente.
create table if not exists public.product_opportunities (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  title text not null, description text, status text not null default 'descoberta', source text, source_url text,
  collected_at timestamptz, source_type text, confidence_level text, scores jsonb not null default '{}'::jsonb,
  opportunity_score numeric(5,2) not null default 0, supplier_score numeric(5,2) not null default 0,
  trust_score numeric(5,2) not null default 0, channel_score numeric(5,2) not null default 0,
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
create unique index if not exists product_opportunities_company_id_key on public.product_opportunities(company_id,id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'opportunity_product_drafts_company_opportunity_fk') then
    alter table public.opportunity_product_drafts add constraint opportunity_product_drafts_company_opportunity_fk foreign key (company_id, opportunity_id) references public.product_opportunities(company_id, id) on delete cascade;
  end if;
end $$;
alter table public.product_opportunities drop constraint if exists product_opportunities_status_check;
alter table public.product_opportunities add constraint product_opportunities_status_check check (status in ('descoberta','em análise','validada','teste','descartada','convertida em produto'));
alter table public.opportunity_product_drafts drop constraint if exists opportunity_product_drafts_status_check;
alter table public.opportunity_product_drafts add constraint opportunity_product_drafts_status_check check (status in ('draft','active','archived'));
