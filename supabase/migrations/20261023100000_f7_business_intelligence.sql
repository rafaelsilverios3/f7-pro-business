begin;

create table if not exists public.bi_studies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  client_name text,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create table if not exists public.bi_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  version integer not null check (version > 0),
  source_filename text not null check (length(trim(source_filename)) between 1 and 255),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  data_cutoff date,
  source_metadata jsonb not null default '{}'::jsonb,
  methodology jsonb not null default '{}'::jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'staging' check (status in ('staging','complete','failed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (company_id, study_id, version),
  unique (company_id, id),
  foreign key (company_id, study_id) references public.bi_studies(company_id, id) on delete cascade
);

create table if not exists public.bi_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  import_id uuid not null,
  unit_name text not null check (length(trim(unit_name)) between 1 and 120),
  code text not null check (length(trim(code)) between 1 and 120),
  description text,
  abc_class text check (abc_class is null or abc_class in ('A','B','C')),
  turn_class text,
  historical_value numeric check (historical_value is null or historical_value >= 0),
  months_active integer check (months_active is null or months_active >= 0),
  days_without_purchase integer check (days_without_purchase is null or days_without_purchase >= 0),
  stock_available numeric check (stock_available is null or stock_available >= 0),
  open_orders numeric check (open_orders is null or open_orders >= 0),
  substitutions text[] not null default '{}',
  historical_months jsonb not null default '{}'::jsonb,
  forecast_months jsonb not null default '{}'::jsonb,
  suggested_quantity numeric check (suggested_quantity is null or suggested_quantity >= 0),
  net_suggested_quantity numeric check (net_suggested_quantity is null or net_suggested_quantity >= 0),
  prudence_factor numeric check (prudence_factor is null or prudence_factor between 0 and 1),
  eligible_for_suggestion boolean not null default false,
  review_reasons text[] not null default '{}',
  trend_percent numeric,
  trend_3m_percent numeric,
  seasonality jsonb not null default '{}'::jsonb,
  source_reference jsonb not null default '{}'::jsonb,
  original_recommendation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (import_id, unit_name, code),
  foreign key (company_id, study_id) references public.bi_studies(company_id, id) on delete cascade,
  foreign key (company_id, import_id) references public.bi_imports(company_id, id) on delete cascade
);

create table if not exists public.bi_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  import_id uuid not null,
  item_id uuid not null,
  status text not null check (status in ('recommended','review','approved','adjusted','discarded','waiting')),
  reason text not null check (length(trim(reason)) between 3 and 2000),
  adjusted_quantity numeric check (adjusted_quantity is null or adjusted_quantity >= 0),
  original_recommendation jsonb not null default '{}'::jsonb,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (company_id, study_id) references public.bi_studies(company_id, id) on delete cascade,
  foreign key (company_id, import_id) references public.bi_imports(company_id, id) on delete cascade,
  foreign key (company_id, item_id) references public.bi_items(company_id, id) on delete cascade
);

create table if not exists public.bi_audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid references public.bi_studies(id) on delete set null,
  import_id uuid references public.bi_imports(id) on delete set null,
  event_type text not null,
  actor_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bi_shared_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  import_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null,
  password_hash text,
  password_salt text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  auth_failures integer not null default 0 check (auth_failures >= 0),
  locked_until timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (company_id, study_id) references public.bi_studies(company_id, id) on delete cascade,
  foreign key (company_id, import_id) references public.bi_imports(company_id, id) on delete cascade,
  check ((password_hash is null) = (password_salt is null))
);

create index if not exists bi_studies_company_updated_idx on public.bi_studies(company_id, updated_at desc);
create index if not exists bi_imports_study_version_idx on public.bi_imports(company_id, study_id, version desc) where status = 'complete';
create index if not exists bi_items_import_unit_code_idx on public.bi_items(company_id, import_id, unit_name, code);
create index if not exists bi_decisions_item_time_idx on public.bi_decisions(company_id, item_id, created_at desc);
create index if not exists bi_audit_study_time_idx on public.bi_audit_events(company_id, study_id, created_at desc);

create or replace function public.bi_validate_tenant_links()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'bi_items' then
    if not exists (select 1 from public.bi_imports i where i.id = new.import_id and i.company_id = new.company_id and i.study_id = new.study_id and i.status = 'staging') then
      raise exception 'BI_IMPORT_NOT_WRITABLE';
    end if;
  elsif tg_table_name = 'bi_decisions' then
    if not exists (select 1 from public.bi_items i join public.bi_imports p on p.id = i.import_id and p.company_id = i.company_id where i.id = new.item_id and i.company_id = new.company_id and i.study_id = new.study_id and i.import_id = new.import_id and p.status = 'complete') then
      raise exception 'BI_ITEM_NOT_FOUND';
    end if;
  elsif tg_table_name = 'bi_shared_reports' then
    if not exists (select 1 from public.bi_imports i where i.id = new.import_id and i.company_id = new.company_id and i.study_id = new.study_id and i.status = 'complete') then
      raise exception 'BI_IMPORT_NOT_SHAREABLE';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.bi_validate_tenant_links() from public, anon, authenticated;

drop trigger if exists bi_items_tenant_links on public.bi_items;
create trigger bi_items_tenant_links before insert or update on public.bi_items for each row execute function public.bi_validate_tenant_links();
drop trigger if exists bi_decisions_tenant_links on public.bi_decisions;
create trigger bi_decisions_tenant_links before insert on public.bi_decisions for each row execute function public.bi_validate_tenant_links();
drop trigger if exists bi_shares_tenant_links on public.bi_shared_reports;
create trigger bi_shares_tenant_links before insert on public.bi_shared_reports for each row execute function public.bi_validate_tenant_links();

create or replace function public.bi_protect_version_identity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'bi_studies' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id or new.created_by is distinct from old.created_by then raise exception 'BI_STUDY_IDENTITY_IMMUTABLE'; end if;
  elsif tg_table_name = 'bi_imports' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id or new.study_id is distinct from old.study_id or new.version is distinct from old.version or new.source_filename is distinct from old.source_filename or new.source_sha256 is distinct from old.source_sha256 or new.data_cutoff is distinct from old.data_cutoff or new.source_metadata is distinct from old.source_metadata or new.methodology is distinct from old.methodology or new.row_count is distinct from old.row_count or new.created_by is distinct from old.created_by then raise exception 'BI_IMPORT_IMMUTABLE'; end if;
    if old.status <> 'staging' or new.status not in ('complete','failed') then raise exception 'BI_IMPORT_STATUS_TRANSITION_INVALID'; end if;
    if new.status = 'complete' and new.completed_at is null then raise exception 'BI_IMPORT_COMPLETION_TIME_REQUIRED'; end if;
    if new.status = 'complete' and (new.row_count = 0 or (select count(*) from public.bi_items i where i.company_id = new.company_id and i.import_id = new.id) <> new.row_count) then raise exception 'BI_IMPORT_ROW_COUNT_MISMATCH'; end if;
  end if;
  return new;
end $$;
revoke all on function public.bi_protect_version_identity() from public, anon, authenticated;
drop trigger if exists bi_studies_identity_guard on public.bi_studies;
create trigger bi_studies_identity_guard before update on public.bi_studies for each row execute function public.bi_protect_version_identity();
drop trigger if exists bi_imports_identity_guard on public.bi_imports;
create trigger bi_imports_identity_guard before update on public.bi_imports for each row execute function public.bi_protect_version_identity();

create or replace function public.bi_audit_row_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare company uuid; study uuid; import uuid; kind text; actor uuid; meta jsonb;
begin
  if tg_table_name = 'bi_studies' then
    company := coalesce(new.company_id, old.company_id); study := coalesce(new.id, old.id); kind := case when tg_op='INSERT' then 'study.created' else 'study.updated' end;
    actor := coalesce(new.created_by, auth.uid()); meta := jsonb_build_object('name', coalesce(new.name, old.name), 'status', coalesce(new.status, old.status));
  elsif tg_table_name = 'bi_imports' then
    company := coalesce(new.company_id, old.company_id); study := coalesce(new.study_id, old.study_id); import := coalesce(new.id, old.id);
    kind := case when tg_op='INSERT' then 'import.started' when new.status='complete' and old.status<>'complete' then 'import.completed' when new.status='failed' then 'import.failed' else 'import.updated' end;
    actor := coalesce(new.created_by, auth.uid()); meta := jsonb_build_object('version', coalesce(new.version, old.version), 'source_filename', coalesce(new.source_filename, old.source_filename), 'rows', coalesce(new.row_count, old.row_count), 'status', coalesce(new.status, old.status));
  else
    company := new.company_id; study := new.study_id; import := new.import_id; kind := 'decision.recorded'; actor := new.actor_id;
    meta := jsonb_build_object('item_id', new.item_id, 'status', new.status, 'reason', new.reason, 'adjusted_quantity', new.adjusted_quantity, 'original_recommendation', new.original_recommendation);
  end if;
  insert into public.bi_audit_events(company_id, study_id, import_id, event_type, actor_id, metadata) values(company, study, import, kind, actor, meta);
  return new;
end $$;
revoke all on function public.bi_audit_row_change() from public, anon, authenticated;
drop trigger if exists bi_studies_audit on public.bi_studies;
create trigger bi_studies_audit after insert or update on public.bi_studies for each row execute function public.bi_audit_row_change();
drop trigger if exists bi_imports_audit on public.bi_imports;
create trigger bi_imports_audit after insert or update on public.bi_imports for each row execute function public.bi_audit_row_change();
drop trigger if exists bi_decisions_audit on public.bi_decisions;
create trigger bi_decisions_audit after insert on public.bi_decisions for each row execute function public.bi_audit_row_change();

create or replace function public.bi_get_shared_report(p_token_hash text, p_password text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare share public.bi_shared_reports; expected text;
begin
  select * into share from public.bi_shared_reports where token_hash = p_token_hash for update;
  if share.id is null or share.revoked_at is not null or share.expires_at <= now() then return jsonb_build_object('status','unavailable'); end if;
  if share.locked_until is not null and share.locked_until > now() then return jsonb_build_object('status','locked'); end if;
  if share.password_hash is not null then
    if p_password is null then return jsonb_build_object('status','password_required'); end if;
    expected := p_password;
    if expected <> share.password_hash then
      update public.bi_shared_reports set auth_failures = auth_failures + 1,
        locked_until = case when auth_failures + 1 >= 8 then now() + interval '15 minutes' else locked_until end
        where id = share.id;
      return jsonb_build_object('status','invalid_password');
    end if;
    update public.bi_shared_reports set auth_failures = 0, locked_until = null where id = share.id;
  end if;
  return jsonb_build_object('status','ok','snapshot',share.snapshot);
end $$;
revoke all on function public.bi_get_shared_report(text,text) from public, anon, authenticated;
grant execute on function public.bi_get_shared_report(text,text) to service_role;

alter table public.bi_studies enable row level security;
alter table public.bi_imports enable row level security;
alter table public.bi_items enable row level security;
alter table public.bi_decisions enable row level security;
alter table public.bi_audit_events enable row level security;
alter table public.bi_shared_reports enable row level security;

create policy bi_studies_select on public.bi_studies for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence'));
create policy bi_studies_insert on public.bi_studies for insert to authenticated with check (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and created_by = auth.uid());
create policy bi_studies_update on public.bi_studies for update to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence')) with check (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence'));

create policy bi_imports_select on public.bi_imports for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence'));
create policy bi_imports_insert on public.bi_imports for insert to authenticated with check (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and created_by = auth.uid() and status='staging' and exists (select 1 from public.bi_studies s where s.id=bi_imports.study_id and s.company_id=bi_imports.company_id));
create policy bi_imports_update on public.bi_imports for update to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and status='staging' and created_by=auth.uid()) with check (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and status in ('staging','complete','failed') and created_by=auth.uid());

create policy bi_items_select on public.bi_items for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and exists (select 1 from public.bi_imports p where p.id=bi_items.import_id and p.company_id=bi_items.company_id and p.status='complete'));
create policy bi_items_insert on public.bi_items for insert to authenticated with check (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and exists (select 1 from public.bi_imports p where p.id=bi_items.import_id and p.study_id=bi_items.study_id and p.company_id=bi_items.company_id and p.status='staging' and p.created_by=auth.uid()));

create policy bi_decisions_select on public.bi_decisions for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence'));
create policy bi_decisions_insert on public.bi_decisions for insert to authenticated with check (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence') and actor_id=auth.uid());

create policy bi_audit_select on public.bi_audit_events for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial') and public.company_has_feature(company_id, 'business_intelligence'));
-- Share secrets are accessible only to the Edge Function's service role.

grant select, insert, update on public.bi_studies, public.bi_imports to authenticated;
grant select, insert on public.bi_items, public.bi_decisions to authenticated;
grant select on public.bi_audit_events to authenticated;
grant all on public.bi_studies, public.bi_imports, public.bi_items, public.bi_decisions, public.bi_audit_events, public.bi_shared_reports to service_role;

insert into public.plan_features(plan_id, feature, enabled)
select p.id, 'business_intelligence', p.code in ('business','premium')
from public.plans p where p.active
on conflict (plan_id, feature) do update set enabled=excluded.enabled, updated_at=now();

commit;

-- Conceptual rollback: remove the BI navigation, permission/plan mapping, grants, policies, triggers, functions, and tables only after exporting retained BI studies, import versions, decisions, audit history, and shared-report metadata according to the customer's retention policy. Do not delete source company data or unrelated plan feature rows.
