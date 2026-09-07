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
do $$ declare t text; begin foreach t in array array['market_sources','market_signals','market_opportunities'] loop execute format('alter table public.%I enable row level security', t); execute format('drop policy if exists market_intelligence_company_isolation on public.%I', t); execute format('drop policy if exists market_intelligence_select on public.%I', t); execute format('drop policy if exists market_intelligence_insert on public.%I', t); execute format('drop policy if exists market_intelligence_update on public.%I', t); execute format('drop policy if exists market_intelligence_delete on public.%I', t); execute format('create policy market_intelligence_select on public.%I for select to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('create policy market_intelligence_insert on public.%I for insert to authenticated with check (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('create policy market_intelligence_update on public.%I for update to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial'')) with check (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('create policy market_intelligence_delete on public.%I for delete to authenticated using (public.current_company_role(company_id) in (''admin'',''gestor'',''comercial''))', t); execute format('grant select, insert, update, delete on public.%I to authenticated', t); end loop; end $$;
create unique index if not exists market_sources_company_id_key on public.market_sources(company_id,id);
alter table public.market_signals drop constraint if exists market_signals_source_id_fkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'market_signals_company_source_fk') then
    alter table public.market_signals add constraint market_signals_company_source_fk foreign key (company_id, source_id) references public.market_sources(company_id, id) on delete cascade;
  end if;
end $$;
create or replace function public.validate_market_opportunity_sources() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from unnest(coalesce(new.source_ids, '{}'::uuid[])) as source_id where not exists (select 1 from public.market_sources where id = source_id and company_id = new.company_id)) then
    raise exception 'Fonte de mercado não pertence à empresa';
  end if;
  return new;
end;
$$;
drop trigger if exists market_opportunity_sources_company_check on public.market_opportunities;
create trigger market_opportunity_sources_company_check before insert or update of company_id, source_ids on public.market_opportunities for each row execute function public.validate_market_opportunity_sources();
