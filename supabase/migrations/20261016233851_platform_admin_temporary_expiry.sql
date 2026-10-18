-- Permanent owner/operational administration, expiring temporary roles,
-- read-only AI financial visibility, and a narrowly-scoped SQL-editor bootstrap.
begin;

alter table public.platform_admins
  add column if not exists expires_at timestamptz;

-- Fail closed instead of silently assigning an arbitrary term to legacy
-- active support/read-only operators. An owner must classify those rows.
do $$
begin
  if exists (
    select 1 from public.platform_admins
    where status = 'active' and role in ('support','readonly') and expires_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'ACTIVE_SCOPED_PLATFORM_ADMIN_REQUIRES_EXPLICIT_EXPIRY';
  end if;
end;
$$;

alter table public.platform_admins
  drop constraint if exists platform_admins_owner_is_permanent_check;
alter table public.platform_admins
  add constraint platform_admins_owner_is_permanent_check
  check (role <> 'owner' or expires_at is null);

alter table public.platform_admins
  drop constraint if exists platform_admins_active_non_owner_expires_check;
alter table public.platform_admins
  add constraint platform_admins_active_non_owner_expires_check
  check (role in ('owner','admin') or status <> 'active' or expires_at is not null);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.status = 'active'
      and (
        (pa.role in ('owner','admin') and pa.expires_at is null)
        or (pa.role <> 'owner' and pa.expires_at > statement_timestamp())
      )
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Protect the last active, permanent owner against concurrent demotions or
-- disables, including writes performed through service-role code paths.
create or replace function public.guard_last_platform_owner()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  active_owner_count bigint;
begin
  if tg_op = 'INSERT' then
    if new.role = 'owner' then
      perform pg_advisory_xact_lock(hashtextextended('platform-admin-owner-set', 0));
    end if;
  elsif tg_op = 'UPDATE' then
    if old.role = 'owner' or new.role = 'owner' then
      perform pg_advisory_xact_lock(hashtextextended('platform-admin-owner-set', 0));
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.role = 'owner' and old.status = 'active' and old.expires_at is null
       and (new.role <> 'owner' or new.status <> 'active' or new.expires_at is not null) then
      perform id from public.platform_admins
       where role = 'owner' and status = 'active' and expires_at is null
       for update;
      get diagnostics active_owner_count = row_count;
      if active_owner_count <= 1 then
        raise exception using errcode = '23514', message = 'LAST_PLATFORM_OWNER_PROTECTED';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_last_platform_owner() from public, anon, authenticated, service_role;
drop trigger if exists platform_admins_guard_last_owner on public.platform_admins;
create trigger platform_admins_guard_last_owner
  before insert or update of role, status, expires_at on public.platform_admins
  for each row execute function public.guard_last_platform_owner();

-- Existing application audit rows keep the default platform-admin actor.
-- Bootstrap rows have no Auth actor because the database owner is acting from
-- the Supabase SQL Editor; attribution is deliberately not assigned to the
-- account receiving temporary access.
alter table public.platform_admin_audit_logs
  alter column admin_user_id drop not null,
  add column if not exists actor_kind text not null default 'platform_admin',
  add column if not exists actor_reference text;
alter table public.platform_admin_audit_logs
  drop constraint if exists platform_admin_audit_actor_attribution_check;
alter table public.platform_admin_audit_logs
  add constraint platform_admin_audit_actor_attribution_check
  check (
    (actor_kind = 'platform_admin' and admin_user_id is not null and actor_reference is null)
    or (actor_kind = 'bootstrap_operator' and admin_user_id is null and actor_reference = 'supabase_sql_editor')
  );

create or replace function public.guard_ai_financial_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
  financial_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    financial_changed := new.max_daily_ai_calls > 100
      or new.max_daily_web_queries > 300
      or new.max_daily_ai_cost > 0
      or new.ai_budget_currency is not null
      or new.max_tokens_per_request > 8000
      or new.estimated_cost_per_1k_tokens > 0;
  else
    financial_changed := new.max_daily_ai_calls > old.max_daily_ai_calls
      or new.max_daily_web_queries > old.max_daily_web_queries
      or new.max_daily_ai_cost > old.max_daily_ai_cost
      or (new.ai_budget_currency is distinct from old.ai_budget_currency and new.ai_budget_currency is not null)
      or new.max_tokens_per_request > old.max_tokens_per_request
      or new.estimated_cost_per_1k_tokens > old.estimated_cost_per_1k_tokens;
  end if;
  if not financial_changed then return new; end if;
  if auth.role() = 'service_role' then return new; end if;
  if actor_id is not null and exists (
    select 1 from public.platform_admins pa
    where pa.user_id = actor_id and pa.status = 'active' and pa.role = 'owner'
      and pa.expires_at is null
  ) then return new; end if;
  raise exception using errcode = '42501', message = 'AI_FINANCIAL_LIMITS_PLATFORM_OWNER_ONLY';
end;
$$;
revoke all on function public.guard_ai_financial_settings() from public, anon, authenticated, service_role;

create or replace function public.platform_admin_ai_assert_financial_admin()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = actor_id and pa.status = 'active' and pa.role = 'owner'
      and pa.expires_at is null
  ) then
    raise exception using errcode = '42501', message = 'PLATFORM_OWNER_REQUIRED';
  end if;
  return actor_id;
end;
$$;
revoke all on function public.platform_admin_ai_assert_financial_admin() from public, anon, authenticated, service_role;

create or replace function public.platform_admin_ai_assert_financial_reader()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = actor_id and pa.status = 'active'
      and pa.role in ('owner','admin','support','readonly')
      and (
        (pa.role in ('owner','admin') and pa.expires_at is null)
        or (pa.role <> 'owner' and pa.expires_at > statement_timestamp())
      )
  ) then
    raise exception using errcode = '42501', message = 'PLATFORM_ADMIN_FORBIDDEN';
  end if;
  return actor_id;
end;
$$;
revoke all on function public.platform_admin_ai_assert_financial_reader() from public, anon, authenticated, service_role;

-- Tariff catalog and company usage/budget are read-only for global admin roles.
-- Writes below continue to call the owner-only assertion.
create or replace function public.platform_admin_ai_list_rate_cards()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.platform_admin_ai_assert_financial_reader();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'rate_kind', r.rate_kind, 'provider_key', r.provider_key,
      'model_key', r.model_key, 'rate_version', r.rate_version, 'currency', r.currency,
      'input_cost_per_1k', r.input_cost_per_1k, 'output_cost_per_1k', r.output_cost_per_1k,
      'cost_per_query', r.cost_per_query, 'source_reference', r.source_reference,
      'verified_at', r.verified_at, 'approved_by', r.approved_by,
      'effective_from', r.effective_from, 'effective_until', r.effective_until,
      'enabled', r.enabled, 'created_at', r.created_at
    ) order by r.created_at desc)
    from public.ai_rate_cards r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.platform_admin_ai_company_financial_usage(target_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  company_row record;
  cfg public.company_assistant_settings;
  calls_used bigint := 0;
  web_used bigint := 0;
  tokens_used bigint := 0;
  cost_used bigint := 0;
  reservation_rows jsonb := '[]'::jsonb;
begin
  perform public.platform_admin_ai_assert_financial_reader();
  if target_company is null then
    raise exception using errcode = '22023', message = 'AI_FINANCIAL_COMPANY_REQUIRED';
  end if;
  select c.id, c.name into company_row from public.companies c where c.id = target_company;
  if not found then raise exception using errcode = 'P0002', message = 'AI_FINANCIAL_COMPANY_NOT_FOUND'; end if;
  select s.* into cfg from public.company_assistant_settings s where s.company_id = target_company;
  select coalesce(max(uc.count) filter (where uc.metric = 'ai_calls'), 0),
         coalesce(max(uc.count) filter (where uc.metric = 'web_queries'), 0),
         coalesce(max(uc.count) filter (where uc.metric = 'ai_tokens'), 0),
         coalesce(max(uc.count) filter (where uc.metric = 'ai_cost_microunits'), 0)
    into calls_used, web_used, tokens_used, cost_used
    from public.usage_counters uc where uc.company_id = target_company and uc.period = current_date;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'rate_kind', r.rate_kind, 'provider_key', r.provider_key,
      'model_key', r.model_key, 'rate_version', r.rate_version, 'currency', r.currency,
      'status', r.status, 'reserved_input_tokens', r.reserved_input_tokens,
      'reserved_output_tokens', r.reserved_output_tokens,
      'reserved_external_queries', r.reserved_external_queries,
      'reserved_cost', r.reserved_cost_microunits::numeric / 1000000,
      'actual_input_tokens', r.actual_input_tokens, 'actual_output_tokens', r.actual_output_tokens,
      'actual_external_queries', r.actual_external_queries,
      'actual_cost', case when r.actual_cost_microunits is null then null else r.actual_cost_microunits::numeric / 1000000 end,
      'safe_reason_code', r.safe_reason_code, 'created_at', r.created_at, 'settled_at', r.settled_at
    ) order by r.created_at desc), '[]'::jsonb)
    into reservation_rows
    from (
      select br.* from public.ai_budget_reservations br
      where br.company_id = target_company
      order by br.created_at desc limit 100
    ) r;
  return jsonb_build_object(
    'company', jsonb_build_object('id', company_row.id, 'name', company_row.name),
    'budget', case when cfg.company_id is null then null else jsonb_build_object(
      'max_daily_ai_calls', cfg.max_daily_ai_calls,
      'max_daily_web_queries', cfg.max_daily_web_queries,
      'max_daily_ai_cost', cfg.max_daily_ai_cost,
      'ai_budget_currency', cfg.ai_budget_currency,
      'max_tokens_per_request', cfg.max_tokens_per_request,
      'consumption_enabled', cfg.max_daily_ai_calls > 0 and cfg.max_daily_ai_cost > 0 and cfg.ai_budget_currency is not null
    ) end,
    'today', jsonb_build_object(
      'period', current_date, 'calls', calls_used, 'web_queries', web_used, 'tokens_reserved', tokens_used,
      'cost_reserved', cost_used::numeric / 1000000,
      'currency', case when cfg.company_id is null then null else cfg.ai_budget_currency end
    ),
    'reservations', reservation_rows
  );
end;
$$;

-- Bootstrap only an existing disabled admin into a two-hour, read-only role.
-- This SECURITY INVOKER function is executable only by postgres via SQL Editor;
-- application roles and service_role cannot invoke it. It writes a distinct
-- bootstrap_operator audit record with no beneficiary Auth ID as the actor.
create or replace function public.platform_admin_bootstrap_readonly(
  target_admin_id uuid,
  target_expires_at timestamptz,
  audit_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  before_row public.platform_admins;
  after_row public.platform_admins;
  audit_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'DATABASE_OWNER_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-admin-bootstrap', 0));
  if target_admin_id is null or target_expires_at <= statement_timestamp()
     or target_expires_at > statement_timestamp() + interval '2 hours'
     or coalesce(length(btrim(audit_reason)), 0) < 8 or length(audit_reason) > 500
     or audit_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)' then
    raise exception using errcode = '22023', message = 'BOOTSTRAP_INPUT_INVALID';
  end if;
  if exists (select 1 from public.platform_admins pa where pa.status = 'active') then
    raise exception using errcode = '42501', message = 'ACTIVE_PLATFORM_ADMIN_ALREADY_EXISTS';
  end if;
  select * into before_row from public.platform_admins where id = target_admin_id for update;
  if not found or before_row.status <> 'disabled' or before_row.role <> 'admin' then
    raise exception using errcode = 'P0002', message = 'DISABLED_ADMIN_TARGET_REQUIRED';
  end if;
  update public.platform_admins
     set role = 'readonly', status = 'active', expires_at = target_expires_at
   where id = target_admin_id
   returning * into after_row;
  insert into public.platform_admin_audit_logs(
    admin_user_id, actor_kind, actor_reference, action, entity, entity_id,
    before_data, after_data, reason
  ) values (
    null, 'bootstrap_operator', 'supabase_sql_editor', 'platform_admin.bootstrap_activated',
    'platform_admins', target_admin_id::text, to_jsonb(before_row), to_jsonb(after_row), left(btrim(audit_reason), 500)
  ) returning id into audit_id;
  return jsonb_build_object('admin', to_jsonb(after_row), 'audit_id', audit_id);
end;
$$;
revoke all on function public.platform_admin_bootstrap_readonly(uuid,timestamptz,text) from public, anon, authenticated, service_role;

create or replace function public.platform_admin_bootstrap_revoke(
  target_admin_id uuid,
  audit_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_row public.platform_admins;
  original_data jsonb;
  activated_data jsonb;
  after_row public.platform_admins;
  audit_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'DATABASE_OWNER_REQUIRED';
  end if;
  if target_admin_id is null or coalesce(length(btrim(audit_reason)), 0) < 8 or length(audit_reason) > 500
     or audit_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)' then
    raise exception using errcode = '22023', message = 'BOOTSTRAP_INPUT_INVALID';
  end if;
  select * into current_row from public.platform_admins where id = target_admin_id for update;
  if not found or current_row.role <> 'readonly' or current_row.status <> 'active' or current_row.expires_at is null then
    raise exception using errcode = 'P0002', message = 'ACTIVE_BOOTSTRAP_TARGET_REQUIRED';
  end if;
  select al.before_data, al.after_data into original_data, activated_data from public.platform_admin_audit_logs al
   where al.actor_kind = 'bootstrap_operator' and al.action = 'platform_admin.bootstrap_activated'
     and al.entity_id = target_admin_id::text
   order by al.created_at desc limit 1;
  if original_data is null or original_data->>'role' <> 'admin' or original_data->>'status' <> 'disabled' then
    raise exception using errcode = 'P0002', message = 'BOOTSTRAP_ORIGINAL_STATE_NOT_FOUND';
  end if;
  if activated_data is null
     or activated_data->>'id' <> target_admin_id::text
     or activated_data->>'role' <> current_row.role
     or activated_data->>'status' <> current_row.status
     or nullif(activated_data->>'expires_at', '')::timestamptz is distinct from current_row.expires_at then
    raise exception using errcode = '40001', message = 'BOOTSTRAP_TARGET_CHANGED_SINCE_ACTIVATION';
  end if;
  update public.platform_admins
     set role = 'admin', status = 'disabled', expires_at = null
   where id = target_admin_id
   returning * into after_row;
  insert into public.platform_admin_audit_logs(
    admin_user_id, actor_kind, actor_reference, action, entity, entity_id,
    before_data, after_data, reason
  ) values (
    null, 'bootstrap_operator', 'supabase_sql_editor', 'platform_admin.bootstrap_revoked',
    'platform_admins', target_admin_id::text, to_jsonb(current_row), to_jsonb(after_row), left(btrim(audit_reason), 500)
  ) returning id into audit_id;
  return jsonb_build_object('admin', to_jsonb(after_row), 'audit_id', audit_id);
end;
$$;
revoke all on function public.platform_admin_bootstrap_revoke(uuid,text) from public, anon, authenticated, service_role;

comment on column public.platform_admins.expires_at is
  'NULL is permitted for permanent owner/admin grants explicitly made by an owner; temporary global roles require a future expiry and are checked on every request.';
comment on column public.platform_admin_audit_logs.actor_kind is
  'platform_admin rows are attributed to Auth user_id; bootstrap_operator rows intentionally have no beneficiary as actor and are correlated with Supabase SQL Editor audit logs.';

commit;
