-- Narrow, auditable platform-admin access to AI pricing and company budgets.
-- The underlying rate-card and reservation tables remain private to every API role.
begin;

-- Company administrators can manage assistant content and tool preferences under
-- the existing table policy, but never change monetary or consumption limits.
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
    -- Tenant owners may reduce their own limits or disable usage, but cannot
    -- raise them, change to another currency, or add any budget.
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
    where pa.user_id = actor_id and pa.status = 'active' and pa.role in ('owner','admin')
  ) then return new; end if;
  raise exception using errcode = '42501', message = 'AI_FINANCIAL_LIMITS_PLATFORM_ADMIN_ONLY';
end;
$$;
revoke all on function public.guard_ai_financial_settings() from public, anon, authenticated, service_role;
drop trigger if exists company_assistant_settings_guard_ai_financial on public.company_assistant_settings;
create trigger company_assistant_settings_guard_ai_financial
before insert or update on public.company_assistant_settings
for each row execute function public.guard_ai_financial_settings();

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
    where pa.user_id = actor_id and pa.status = 'active' and pa.role in ('owner','admin')
  ) then
    raise exception using errcode = '42501', message = 'PLATFORM_ADMIN_FORBIDDEN';
  end if;
  return actor_id;
end;
$$;
revoke all on function public.platform_admin_ai_assert_financial_admin() from public, anon, authenticated, service_role;

create or replace function public.platform_admin_ai_list_rate_cards()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.platform_admin_ai_assert_financial_admin();
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
  perform public.platform_admin_ai_assert_financial_admin();
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

create or replace function public.platform_admin_ai_set_company_budget(
  target_company uuid,
  consumption_enabled boolean,
  target_daily_calls integer,
  target_daily_web_queries integer,
  target_daily_budget numeric,
  target_currency text,
  target_max_tokens integer,
  audit_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  before_data jsonb;
  after_data jsonb;
  calls_value integer;
  budget_value numeric;
  currency_value text;
begin
  actor_id := public.platform_admin_ai_assert_financial_admin();
  if target_company is null or not exists (select 1 from public.companies c where c.id = target_company) then
    raise exception using errcode = 'P0002', message = 'AI_FINANCIAL_COMPANY_NOT_FOUND';
  end if;
  if coalesce(length(btrim(audit_reason)), 0) < 8 or length(audit_reason) > 500
    or audit_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)' then
    raise exception using errcode = '22023', message = 'AI_FINANCIAL_REASON_REQUIRED';
  end if;
  if consumption_enabled is null then raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID'; end if;

  -- Serialize administrator cap changes with the reservation RPC's company/day lock.
  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || current_date::text || ':ai-budget-v2', 0));
  select jsonb_build_object('max_daily_ai_calls', s.max_daily_ai_calls,
      'max_daily_web_queries', s.max_daily_web_queries,
      'max_daily_ai_cost', s.max_daily_ai_cost, 'ai_budget_currency', s.ai_budget_currency,
      'max_tokens_per_request', s.max_tokens_per_request)
    into before_data from public.company_assistant_settings s where s.company_id = target_company;

  if consumption_enabled then
    if target_daily_calls is null or target_daily_calls not between 1 and 1000
      or target_daily_web_queries is null or target_daily_web_queries not between 1 and 1000
      or target_daily_budget is null or target_daily_budget::text in ('NaN','Infinity','-Infinity')
      or target_daily_budget <= 0 or target_daily_budget > 1000
      or target_currency is null or target_currency not in ('BRL','EUR','USD')
      or target_max_tokens is null or target_max_tokens not between 256 and 100000 then
      raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID';
    end if;
    if not exists (
      select 1 from public.ai_rate_cards r
      where r.rate_kind = 'model_tokens' and r.enabled and r.currency = target_currency
        and r.effective_from <= now() and (r.effective_until is null or r.effective_until > now())
    ) then
      raise exception using errcode = '22023', message = 'AI_FINANCIAL_ACTIVE_RATE_REQUIRED';
    end if;
    calls_value := target_daily_calls;
    budget_value := target_daily_budget;
    currency_value := target_currency;
  else
    -- Zero call allowance is the existing ledger's fail-closed disable switch.
    -- Preserve any configured cap/currency so an administrator can pause and resume safely.
    calls_value := 0;
    target_daily_web_queries := 0;
    budget_value := null;
    currency_value := null;
  end if;

  insert into public.company_assistant_settings(company_id, max_daily_ai_calls, max_daily_web_queries, max_daily_ai_cost,
      ai_budget_currency, max_tokens_per_request)
    values (target_company, calls_value, coalesce(target_daily_web_queries, 0), coalesce(budget_value, 0), currency_value,
      coalesce(target_max_tokens, 8000))
  on conflict (company_id) do update set
    max_daily_ai_calls = excluded.max_daily_ai_calls,
    max_daily_web_queries = excluded.max_daily_web_queries,
    max_daily_ai_cost = case when consumption_enabled then excluded.max_daily_ai_cost else public.company_assistant_settings.max_daily_ai_cost end,
    ai_budget_currency = case when consumption_enabled then excluded.ai_budget_currency else public.company_assistant_settings.ai_budget_currency end,
    max_tokens_per_request = case when consumption_enabled and target_max_tokens is not null then excluded.max_tokens_per_request else public.company_assistant_settings.max_tokens_per_request end,
    updated_at = now();

  select jsonb_build_object('max_daily_ai_calls', s.max_daily_ai_calls,
      'max_daily_web_queries', s.max_daily_web_queries,
      'max_daily_ai_cost', s.max_daily_ai_cost, 'ai_budget_currency', s.ai_budget_currency,
      'max_tokens_per_request', s.max_tokens_per_request,
      'consumption_enabled', s.max_daily_ai_calls > 0 and s.max_daily_ai_cost > 0 and s.ai_budget_currency is not null)
    into after_data from public.company_assistant_settings s where s.company_id = target_company;
  insert into public.platform_admin_audit_logs(admin_user_id, company_id, action, entity, entity_id, before_data, after_data, reason)
    values (actor_id, target_company, 'company.ai_financial_budget.changed', 'company_assistant_settings', target_company::text, before_data, after_data, left(btrim(audit_reason), 500));
  return after_data;
end;
$$;

create or replace function public.platform_admin_ai_create_rate_card(
  target_rate_kind text,
  target_provider text,
  target_model text,
  target_version text,
  target_currency text,
  target_input_cost numeric,
  target_output_cost numeric,
  target_query_cost numeric,
  target_source_reference text,
  target_effective_from timestamptz,
  target_effective_until timestamptz,
  target_enabled boolean,
  audit_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  inserted_row public.ai_rate_cards;
begin
  actor_id := public.platform_admin_ai_assert_financial_admin();
  if coalesce(length(btrim(audit_reason)), 0) < 8 or length(audit_reason) > 500
    or audit_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)'
    or target_rate_kind is null or target_rate_kind not in ('model_tokens','external_query')
    or target_provider is null or length(btrim(target_provider)) not between 1 and 200
    or target_version is null or length(btrim(target_version)) not between 1 and 80
     or target_currency is null or target_currency not in ('BRL','EUR','USD')
    or target_source_reference is null or length(btrim(target_source_reference)) not between 1 and 500
    or target_source_reference !~ '^https://[^[:space:]?#@]+$'
    or target_effective_from is null or target_effective_from < now() - interval '5 minutes'
    or (target_effective_until is not null and target_effective_until <= target_effective_from)
    or target_enabled is null then
    raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID';
  end if;
  if target_rate_kind = 'model_tokens' then
    if target_provider !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
      or target_model is null or length(btrim(target_model)) not between 1 and 160
      or target_input_cost is null or target_output_cost is null
      or target_input_cost::text in ('NaN','Infinity','-Infinity') or target_output_cost::text in ('NaN','Infinity','-Infinity')
      or target_input_cost < 0 or target_output_cost < 0 or target_input_cost + target_output_cost <= 0
      or target_input_cost > 1000000 or target_output_cost > 1000000 or target_query_cost is not null then
      raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID';
    end if;
  else
    if (lower(btrim(target_provider)) <> 'brave' and target_provider !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$')
      or target_model is not null or target_query_cost is null
      or target_query_cost::text in ('NaN','Infinity','-Infinity') or target_query_cost <= 0
      or target_query_cost > 1000 or target_input_cost is not null or target_output_cost is not null then
      raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(btrim(target_rate_kind) || ':' || lower(btrim(target_provider)) || ':' || coalesce(nullif(btrim(target_model),''),''), 0));
  if target_enabled and exists (
    select 1 from public.ai_rate_cards r
    where r.rate_kind = target_rate_kind and r.provider_key = lower(btrim(target_provider))
      and r.model_key is not distinct from nullif(btrim(target_model),'') and r.enabled
      and r.effective_from < coalesce(target_effective_until, 'infinity'::timestamptz)
      and coalesce(r.effective_until, 'infinity'::timestamptz) > target_effective_from
  ) then
    raise exception using errcode = '23505', message = 'AI_FINANCIAL_RATE_OVERLAP';
  end if;
  insert into public.ai_rate_cards(rate_kind, provider_key, model_key, rate_version, currency,
      input_cost_per_1k, output_cost_per_1k, cost_per_query, source_reference,
      verified_at, approved_by, effective_from, effective_until, enabled)
    values (target_rate_kind, lower(btrim(target_provider)), nullif(btrim(target_model),''), btrim(target_version), target_currency,
      target_input_cost, target_output_cost, target_query_cost, btrim(target_source_reference),
      now(), actor_id, target_effective_from, target_effective_until, target_enabled)
    returning * into inserted_row;
  insert into public.platform_admin_audit_logs(admin_user_id, action, entity, entity_id, before_data, after_data, reason)
    values (actor_id, 'ai.rate_card.created', 'ai_rate_cards', inserted_row.id::text, null,
      jsonb_build_object('id', inserted_row.id, 'rate_kind', inserted_row.rate_kind, 'provider_key', inserted_row.provider_key,
        'model_key', inserted_row.model_key, 'rate_version', inserted_row.rate_version, 'currency', inserted_row.currency,
        'input_cost_per_1k', inserted_row.input_cost_per_1k, 'output_cost_per_1k', inserted_row.output_cost_per_1k,
        'cost_per_query', inserted_row.cost_per_query, 'source_reference', inserted_row.source_reference,
        'effective_from', inserted_row.effective_from, 'effective_until', inserted_row.effective_until, 'enabled', inserted_row.enabled),
      left(btrim(audit_reason), 500));
  return jsonb_build_object('id', inserted_row.id, 'rate_kind', inserted_row.rate_kind,
    'provider_key', inserted_row.provider_key, 'model_key', inserted_row.model_key,
    'rate_version', inserted_row.rate_version, 'currency', inserted_row.currency,
    'input_cost_per_1k', inserted_row.input_cost_per_1k, 'output_cost_per_1k', inserted_row.output_cost_per_1k,
    'cost_per_query', inserted_row.cost_per_query, 'source_reference', inserted_row.source_reference,
    'verified_at', inserted_row.verified_at, 'approved_by', inserted_row.approved_by,
    'effective_from', inserted_row.effective_from, 'effective_until', inserted_row.effective_until,
    'enabled', inserted_row.enabled, 'created_at', inserted_row.created_at);
end;
$$;

create or replace function public.platform_admin_ai_set_rate_card_enabled(target_rate_card uuid, target_enabled boolean, audit_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  before_row public.ai_rate_cards;
  after_row public.ai_rate_cards;
begin
  actor_id := public.platform_admin_ai_assert_financial_admin();
  if target_rate_card is null or target_enabled is null or coalesce(length(btrim(audit_reason)), 0) < 8 or length(audit_reason) > 500
    or audit_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)' then
    raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID';
  end if;
  select * into before_row from public.ai_rate_cards r where r.id = target_rate_card for update;
  if not found then raise exception using errcode = 'P0002', message = 'AI_FINANCIAL_RATE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(before_row.rate_kind || ':' || before_row.provider_key || ':' || coalesce(before_row.model_key,''), 0));
  if target_enabled then
    if before_row.effective_from > now() or (before_row.effective_until is not null and before_row.effective_until <= now()) then
      raise exception using errcode = '22023', message = 'AI_FINANCIAL_RATE_NOT_EFFECTIVE';
    end if;
    if exists (select 1 from public.ai_rate_cards r where r.id <> target_rate_card
      and r.rate_kind = before_row.rate_kind and r.provider_key = before_row.provider_key
      and r.model_key is not distinct from before_row.model_key and r.enabled
      and r.effective_from < coalesce(before_row.effective_until, 'infinity'::timestamptz)
      and coalesce(r.effective_until, 'infinity'::timestamptz) > before_row.effective_from) then
      raise exception using errcode = '23505', message = 'AI_FINANCIAL_RATE_OVERLAP';
    end if;
  end if;
  update public.ai_rate_cards set enabled = target_enabled where id = target_rate_card returning * into after_row;
  insert into public.platform_admin_audit_logs(admin_user_id, action, entity, entity_id, before_data, after_data, reason)
    values (actor_id, case when target_enabled then 'ai.rate_card.enabled' else 'ai.rate_card.disabled' end,
      'ai_rate_cards', target_rate_card::text, jsonb_build_object('enabled', before_row.enabled),
      jsonb_build_object('enabled', after_row.enabled), left(btrim(audit_reason), 500));
  return jsonb_build_object('id', after_row.id, 'rate_kind', after_row.rate_kind,
    'provider_key', after_row.provider_key, 'model_key', after_row.model_key,
    'rate_version', after_row.rate_version, 'currency', after_row.currency,
    'input_cost_per_1k', after_row.input_cost_per_1k, 'output_cost_per_1k', after_row.output_cost_per_1k,
    'cost_per_query', after_row.cost_per_query, 'source_reference', after_row.source_reference,
    'verified_at', after_row.verified_at, 'approved_by', after_row.approved_by,
    'effective_from', after_row.effective_from, 'effective_until', after_row.effective_until,
    'enabled', after_row.enabled, 'created_at', after_row.created_at);
end;
$$;

revoke all on function public.platform_admin_ai_list_rate_cards() from public, anon, authenticated, service_role;
revoke all on function public.platform_admin_ai_company_financial_usage(uuid) from public, anon, authenticated, service_role;
revoke all on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text) from public, anon, authenticated, service_role;
revoke all on function public.platform_admin_ai_create_rate_card(text,text,text,text,text,numeric,numeric,numeric,text,timestamptz,timestamptz,boolean,text) from public, anon, authenticated, service_role;
revoke all on function public.platform_admin_ai_set_rate_card_enabled(uuid,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.platform_admin_ai_list_rate_cards() to authenticated;
grant execute on function public.platform_admin_ai_company_financial_usage(uuid) to authenticated;
grant execute on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text) to authenticated;
grant execute on function public.platform_admin_ai_create_rate_card(text,text,text,text,text,numeric,numeric,numeric,text,timestamptz,timestamptz,boolean,text) to authenticated;
grant execute on function public.platform_admin_ai_set_rate_card_enabled(uuid,boolean,text) to authenticated;

comment on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text) is
  'Global admin only. Serializes with the AI reservation lock, caps daily AI and external queries at 1000 each, budget at 1000 currency units, tokens/request at 100000, and writes an audit row atomically. Does not enable the global provider or change secrets.';
comment on table public.ai_rate_cards is 'Private immutable model/external tariffs. Access is mediated through narrowly scoped SECURITY DEFINER platform-admin RPCs; no API role has direct table grants.';

commit;
