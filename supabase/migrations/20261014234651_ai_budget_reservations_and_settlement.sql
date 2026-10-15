-- Transactional AI spend reservations. This migration is intentionally local until reviewed.
-- Legacy usage counters are preserved as already-consumed/held amounts.

begin;

alter table public.company_assistant_settings
  add column if not exists ai_budget_currency text;

alter table public.company_assistant_settings
  drop constraint if exists company_assistant_settings_ai_budget_currency_check;
alter table public.company_assistant_settings
  add constraint company_assistant_settings_ai_budget_currency_check
  check (ai_budget_currency is null or ai_budget_currency ~ '^[A-Z]{3}$');

-- Cost is stored as microunits; integer cannot safely represent ordinary budget caps.
alter table public.usage_counters alter column count type bigint using count::bigint;

create table if not exists public.ai_rate_cards (
  id uuid primary key default gen_random_uuid(),
  rate_kind text not null check (rate_kind in ('model_tokens','external_query')),
  provider_key text not null check (length(provider_key) between 1 and 200),
  model_key text,
  rate_version text not null check (length(rate_version) between 1 and 80),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  input_cost_per_1k numeric(20,10),
  output_cost_per_1k numeric(20,10),
  cost_per_query numeric(20,10),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 500),
  verified_at timestamptz not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  effective_from timestamptz not null,
  effective_until timestamptz,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from),
  check (
    (rate_kind = 'model_tokens' and model_key is not null and length(model_key) between 1 and 160
      and input_cost_per_1k is not null and input_cost_per_1k::text <> 'NaN' and input_cost_per_1k >= 0
      and output_cost_per_1k is not null and output_cost_per_1k::text <> 'NaN' and output_cost_per_1k >= 0
      and input_cost_per_1k + output_cost_per_1k > 0 and cost_per_query is null)
    or
    (rate_kind = 'external_query' and model_key is null
      and cost_per_query is not null and cost_per_query::text <> 'NaN' and cost_per_query > 0
      and input_cost_per_1k is null and output_cost_per_1k is null)
  )
);
create unique index if not exists ai_rate_cards_identity_version_uidx
  on public.ai_rate_cards(rate_kind, provider_key, coalesce(model_key, ''), rate_version);
create index if not exists ai_rate_cards_lookup_idx
  on public.ai_rate_cards(rate_kind, provider_key, model_key, enabled, effective_from desc);

create or replace function public.prevent_ai_rate_card_repricing()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if row(new.rate_kind, new.provider_key, new.model_key, new.rate_version, new.currency,
         new.input_cost_per_1k, new.output_cost_per_1k, new.cost_per_query,
         new.source_reference, new.verified_at, new.approved_by, new.effective_from,
         new.created_at)
     is distinct from
     row(old.rate_kind, old.provider_key, old.model_key, old.rate_version, old.currency,
         old.input_cost_per_1k, old.output_cost_per_1k, old.cost_per_query,
         old.source_reference, old.verified_at, old.approved_by, old.effective_from,
         old.created_at) then
    raise exception 'AI_RATE_CARD_TERMS_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists ai_rate_cards_prevent_repricing on public.ai_rate_cards;
create trigger ai_rate_cards_prevent_repricing before update on public.ai_rate_cards
  for each row execute function public.prevent_ai_rate_card_repricing();

create table if not exists public.ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_key text not null check (length(request_key) between 1 and 180),
  rate_kind text not null check (rate_kind in ('model_tokens','external_query')),
  provider_key text not null,
  model_key text,
  rate_card_id uuid not null references public.ai_rate_cards(id) on delete restrict,
  rate_version text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  budget_period date not null,
  reserved_input_tokens integer not null default 0 check (reserved_input_tokens >= 0),
  reserved_output_tokens integer not null default 0 check (reserved_output_tokens >= 0),
  reserved_external_queries integer not null default 0 check (reserved_external_queries >= 0),
  reserved_cost_microunits bigint not null check (reserved_cost_microunits > 0),
  actual_input_tokens integer check (actual_input_tokens is null or actual_input_tokens >= 0),
  actual_output_tokens integer check (actual_output_tokens is null or actual_output_tokens >= 0),
  actual_external_queries integer check (actual_external_queries is null or actual_external_queries >= 0),
  actual_cost_microunits bigint check (actual_cost_microunits is null or actual_cost_microunits >= 0),
  status text not null default 'reserved' check (status in ('reserved','uncertain','settled')),
  safe_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(company_id, request_key),
  check (
    (rate_kind = 'model_tokens' and model_key is not null and reserved_input_tokens > 0
      and reserved_output_tokens > 0 and reserved_external_queries = 0)
    or
    (rate_kind = 'external_query' and model_key is null and reserved_input_tokens = 0
      and reserved_output_tokens = 0 and reserved_external_queries > 0)
  ),
  check ((status = 'settled') = (settled_at is not null)),
  check (status <> 'settled' or actual_cost_microunits is not null)
);
create index if not exists ai_budget_reservations_company_period_idx
  on public.ai_budget_reservations(company_id, budget_period, status, created_at);

alter table public.ai_rate_cards enable row level security;
alter table public.ai_budget_reservations enable row level security;
revoke all on public.ai_rate_cards, public.ai_budget_reservations from public, anon, authenticated, service_role;

create or replace function public.reserve_ai_budget_v2(
  target_company uuid,
  request_key text,
  requested_kind text,
  requested_provider text,
  requested_model text,
  requested_input_tokens integer default 0,
  requested_output_tokens integer default 0,
  requested_external_queries integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cfg public.company_assistant_settings;
  rate public.ai_rate_cards;
  existing public.ai_budget_reservations;
  day date := current_date;
  used_ai bigint := 0;
  used_web bigint := 0;
  used_tokens bigint := 0;
  used_cost_units bigint := 0;
  reserved_tokens bigint := 0;
  requested_cost_value numeric := 0;
  requested_cost_units bigint := 0;
  cap_cost_units bigint := 0;
  matching_rates integer := 0;
  expected_model text := nullif(btrim(requested_model), '');
begin
  if target_company is null or request_key is null or length(request_key) not between 1 and 180
    or requested_kind not in ('model_tokens','external_query')
    or requested_provider is null or length(requested_provider) not between 1 and 200
    or coalesce(requested_input_tokens, -1) < 0 or coalesce(requested_output_tokens, -1) < 0
    or coalesce(requested_external_queries, -1) < 0 then
    return jsonb_build_object('allowed',false,'reason','invalid_reservation_request');
  end if;
  if requested_kind = 'model_tokens' and (expected_model is null or requested_input_tokens < 1 or requested_output_tokens < 1 or requested_external_queries <> 0) then
    return jsonb_build_object('allowed',false,'reason','invalid_model_reservation');
  end if;
  if requested_kind = 'external_query' and (expected_model is not null or requested_external_queries < 1 or requested_input_tokens <> 0 or requested_output_tokens <> 0) then
    return jsonb_build_object('allowed',false,'reason','invalid_external_reservation');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || day::text || ':ai-budget-v2', 0));

  select * into existing from public.ai_budget_reservations r
    where r.company_id = target_company and r.request_key = reserve_ai_budget_v2.request_key;
  if found then
    if existing.rate_kind <> requested_kind or existing.provider_key <> requested_provider
      or existing.model_key is distinct from expected_model
      or existing.reserved_input_tokens <> requested_input_tokens
      or existing.reserved_output_tokens <> requested_output_tokens
      or existing.reserved_external_queries <> requested_external_queries then
      return jsonb_build_object('allowed',false,'reason','idempotency_key_conflict','reservation_id',existing.id);
    end if;
    return jsonb_build_object('allowed',false,'reason','reservation_already_exists','reservation_id',existing.id,'status',existing.status);
  end if;

  select * into cfg from public.company_assistant_settings s where s.company_id = target_company;
  if cfg.company_id is null then return jsonb_build_object('allowed',false,'reason','settings_not_found'); end if;
  if cfg.max_daily_ai_cost is null or cfg.max_daily_ai_cost::text = 'NaN' or cfg.max_daily_ai_cost <= 0
    or cfg.ai_budget_currency is null or cfg.ai_budget_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('allowed',false,'reason','ai_cost_budget_missing');
  end if;
  if requested_kind = 'model_tokens' then
    if cfg.max_daily_ai_calls is null or cfg.max_daily_ai_calls <= 0 then return jsonb_build_object('allowed',false,'reason','daily_ai_calls_disabled'); end if;
    reserved_tokens := requested_input_tokens::bigint + requested_output_tokens::bigint;
    if cfg.max_tokens_per_request is null or reserved_tokens > cfg.max_tokens_per_request then return jsonb_build_object('allowed',false,'reason','request_tokens_exceeded'); end if;
  else
    if cfg.max_daily_web_queries is null or cfg.max_daily_web_queries <= 0 then return jsonb_build_object('allowed',false,'reason','daily_web_queries_disabled'); end if;
  end if;

  select count(*) into matching_rates from public.ai_rate_cards r
    where r.rate_kind = requested_kind and r.provider_key = requested_provider
      and r.model_key is not distinct from expected_model and r.enabled
      and r.effective_from <= now() and (r.effective_until is null or r.effective_until > now());
  if matching_rates <> 1 then return jsonb_build_object('allowed',false,'reason','rate_card_missing_or_ambiguous'); end if;
  select * into rate from public.ai_rate_cards r
    where r.rate_kind = requested_kind and r.provider_key = requested_provider
      and r.model_key is not distinct from expected_model and r.enabled
      and r.effective_from <= now() and (r.effective_until is null or r.effective_until > now());
  if rate.currency <> cfg.ai_budget_currency then return jsonb_build_object('allowed',false,'reason','budget_currency_mismatch'); end if;

  if requested_kind = 'model_tokens' then
    requested_cost_value := ceil((rate.input_cost_per_1k * requested_input_tokens + rate.output_cost_per_1k * requested_output_tokens) * 1000);
  else
    requested_cost_value := ceil(rate.cost_per_query * requested_external_queries * 1000000);
  end if;
  if requested_cost_value <= 0 or requested_cost_value > 9223372036854775807 then return jsonb_build_object('allowed',false,'reason','cost_reservation_invalid'); end if;
  requested_cost_units := requested_cost_value::bigint;
  cap_cost_units := floor(cfg.max_daily_ai_cost * 1000000);

  select coalesce(max(c.count) filter (where c.metric='ai_calls'),0),
    coalesce(max(c.count) filter (where c.metric='web_queries'),0),
    coalesce(max(c.count) filter (where c.metric='ai_tokens'),0),
    coalesce(max(c.count) filter (where c.metric='ai_cost_microunits'),0)
  into used_ai, used_web, used_tokens, used_cost_units
  from public.usage_counters c where c.company_id = target_company and c.period = day;
  if used_ai < 0 or used_web < 0 or used_tokens < 0 or used_cost_units < 0 then
    return jsonb_build_object('allowed',false,'reason','usage_counter_invalid');
  end if;
  if requested_kind = 'model_tokens' and used_ai::numeric + 1 > cfg.max_daily_ai_calls then return jsonb_build_object('allowed',false,'reason','daily_ai_calls_exceeded'); end if;
  if requested_kind = 'external_query' and used_web::numeric + requested_external_queries > cfg.max_daily_web_queries then return jsonb_build_object('allowed',false,'reason','daily_web_queries_exceeded'); end if;
  if used_cost_units::numeric + requested_cost_units::numeric > cap_cost_units then return jsonb_build_object('allowed',false,'reason','daily_ai_cost_exceeded'); end if;
  if requested_kind = 'model_tokens' and used_tokens::numeric + reserved_tokens::numeric > 9223372036854775807 then return jsonb_build_object('allowed',false,'reason','daily_token_counter_overflow'); end if;
  if requested_kind = 'external_query' and used_web::numeric + requested_external_queries::numeric > 9223372036854775807 then return jsonb_build_object('allowed',false,'reason','daily_query_counter_overflow'); end if;

  insert into public.ai_budget_reservations(company_id, request_key, rate_kind, provider_key, model_key, rate_card_id,
    rate_version, currency, budget_period, reserved_input_tokens, reserved_output_tokens, reserved_external_queries,
    reserved_cost_microunits)
  values(target_company, request_key, requested_kind, requested_provider, expected_model, rate.id, rate.rate_version,
    rate.currency, day, requested_input_tokens, requested_output_tokens, requested_external_queries, requested_cost_units)
  returning * into existing;

  insert into public.usage_counters(company_id,metric,period,count) values
    (target_company,'ai_calls',day,case when requested_kind='model_tokens' then 1 else 0 end),
    (target_company,'web_queries',day,case when requested_kind='external_query' then requested_external_queries else 0 end),
    (target_company,'ai_tokens',day,case when requested_kind='model_tokens' then reserved_tokens else 0 end),
    (target_company,'ai_cost_microunits',day,requested_cost_units)
  on conflict(company_id,metric,period) do update set count = public.usage_counters.count + excluded.count;

  return jsonb_build_object('allowed',true,'reason','budget_reserved','reservation_id',existing.id,
    'rate_version',rate.rate_version,'currency',rate.currency,'reserved_cost',requested_cost_units::numeric / 1000000,
    'estimated_cost',requested_cost_units::numeric / 1000000,
    'reserved_tokens',reserved_tokens,'max_output_tokens',requested_output_tokens,'reserved_external_queries',requested_external_queries);
end;
$$;

create or replace function public.settle_ai_budget_v2(
  target_company uuid,
  target_reservation uuid,
  request_key text,
  usage_reliable boolean,
  actual_input_tokens integer default null,
  actual_output_tokens integer default null,
  actual_external_queries integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reservation public.ai_budget_reservations;
  actual_cost bigint;
  actual_cost_value numeric;
  actual_tokens bigint;
  actual_queries bigint;
  existing_cost bigint;
  existing_metric_count bigint;
  resulting_count numeric;
begin
  if target_company is null or target_reservation is null or request_key is null then
    return jsonb_build_object('settled',false,'reason','invalid_settlement_request');
  end if;
  select * into reservation from public.ai_budget_reservations r
    where r.id = target_reservation and r.company_id = target_company and r.request_key = settle_ai_budget_v2.request_key;
  if not found then return jsonb_build_object('settled',false,'reason','reservation_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || reservation.budget_period::text || ':ai-budget-v2', 0));
  select * into reservation from public.ai_budget_reservations r
    where r.id = target_reservation and r.company_id = target_company and r.request_key = settle_ai_budget_v2.request_key for update;
  if reservation.status = 'settled' then
    if reservation.actual_input_tokens is not distinct from actual_input_tokens
      and reservation.actual_output_tokens is not distinct from actual_output_tokens
      and reservation.actual_external_queries is not distinct from actual_external_queries then
      return jsonb_build_object('settled',true,'idempotent',true,'actual_cost',reservation.actual_cost_microunits::numeric / 1000000);
    end if;
    return jsonb_build_object('settled',false,'reason','settlement_conflict');
  end if;

  if usage_reliable is not true then
    update public.ai_budget_reservations set status='uncertain', safe_reason_code='usage_unavailable', updated_at=now()
      where id=target_reservation and company_id=target_company;
    return jsonb_build_object('settled',false,'reason','reservation_held_uncertain','reservation_id',target_reservation);
  end if;

  if reservation.rate_kind = 'model_tokens' then
    if actual_input_tokens is null or actual_output_tokens is null or actual_external_queries is not null
      or actual_input_tokens < 0 or actual_output_tokens < 0
      or actual_input_tokens::bigint + actual_output_tokens::bigint = 0
      or actual_input_tokens > 10000000 or actual_output_tokens > 10000000 then
      update public.ai_budget_reservations set status='uncertain', safe_reason_code='usage_invalid', updated_at=now()
        where id=target_reservation and company_id=target_company;
      return jsonb_build_object('settled',false,'reason','reservation_held_uncertain','reservation_id',target_reservation);
    end if;
    select ceil((r.input_cost_per_1k * actual_input_tokens + r.output_cost_per_1k * actual_output_tokens) * 1000)
      into actual_cost_value from public.ai_rate_cards r where r.id=reservation.rate_card_id;
    if actual_cost_value > 9223372036854775807 then return jsonb_build_object('settled',false,'reason','actual_usage_overflow'); end if;
    actual_cost := actual_cost_value::bigint;
    actual_tokens := actual_input_tokens::bigint + actual_output_tokens::bigint;
    actual_queries := 0;
  else
    if actual_external_queries is null or actual_input_tokens is not null or actual_output_tokens is not null
      or actual_external_queries < 0 or actual_external_queries > 1000000 then
      update public.ai_budget_reservations set status='uncertain', safe_reason_code='usage_invalid', updated_at=now()
        where id=target_reservation and company_id=target_company;
      return jsonb_build_object('settled',false,'reason','reservation_held_uncertain','reservation_id',target_reservation);
    end if;
    select ceil(r.cost_per_query * actual_external_queries * 1000000)
      into actual_cost_value from public.ai_rate_cards r where r.id=reservation.rate_card_id;
    if actual_cost_value > 9223372036854775807 then return jsonb_build_object('settled',false,'reason','actual_usage_overflow'); end if;
    actual_cost := actual_cost_value::bigint;
    actual_tokens := 0;
    actual_queries := actual_external_queries;
  end if;
  if actual_cost is null or actual_cost < 0 then return jsonb_build_object('settled',false,'reason','actual_cost_invalid'); end if;

  select c.count into existing_cost from public.usage_counters c
    where c.company_id=target_company and c.metric='ai_cost_microunits' and c.period=reservation.budget_period for update;
  if existing_cost is null or existing_cost < reservation.reserved_cost_microunits then
    return jsonb_build_object('settled',false,'reason','counter_invariant_failed');
  end if;
  resulting_count := existing_cost::numeric - reservation.reserved_cost_microunits::numeric + actual_cost::numeric;
  if resulting_count < 0 or resulting_count > 9223372036854775807 then
    return jsonb_build_object('settled',false,'reason','counter_overflow');
  end if;

  if reservation.rate_kind='model_tokens' then
    select c.count into existing_metric_count from public.usage_counters c
      where c.company_id=target_company and c.metric='ai_tokens' and c.period=reservation.budget_period for update;
    if existing_metric_count is null or existing_metric_count < reservation.reserved_input_tokens + reservation.reserved_output_tokens then
      return jsonb_build_object('settled',false,'reason','token_counter_invariant_failed');
    end if;
    resulting_count := existing_metric_count::numeric - reservation.reserved_input_tokens::numeric - reservation.reserved_output_tokens::numeric + actual_tokens::numeric;
    if resulting_count < 0 or resulting_count > 9223372036854775807 then
      return jsonb_build_object('settled',false,'reason','counter_overflow');
    end if;
  else
    select c.count into existing_metric_count from public.usage_counters c
      where c.company_id=target_company and c.metric='web_queries' and c.period=reservation.budget_period for update;
    if existing_metric_count is null or existing_metric_count < reservation.reserved_external_queries then
      return jsonb_build_object('settled',false,'reason','query_counter_invariant_failed');
    end if;
    resulting_count := existing_metric_count::numeric - reservation.reserved_external_queries::numeric + actual_queries::numeric;
    if resulting_count < 0 or resulting_count > 9223372036854775807 then
      return jsonb_build_object('settled',false,'reason','counter_overflow');
    end if;
  end if;
  -- Validate every invariant before any counter mutation. Returning a JSON error
  -- from PL/pgSQL does not roll back prior statements in the same function.
  update public.usage_counters set count=existing_cost - reservation.reserved_cost_microunits + actual_cost
    where company_id=target_company and metric='ai_cost_microunits' and period=reservation.budget_period;
  if reservation.rate_kind='model_tokens' then
    update public.usage_counters set count=count - reservation.reserved_input_tokens - reservation.reserved_output_tokens + actual_tokens
      where company_id=target_company and metric='ai_tokens' and period=reservation.budget_period;
  else
    update public.usage_counters set count=count - reservation.reserved_external_queries + actual_queries
      where company_id=target_company and metric='web_queries' and period=reservation.budget_period;
  end if;
  update public.ai_budget_reservations as ledger set status='settled',
    actual_input_tokens=case when ledger.rate_kind='model_tokens' then settle_ai_budget_v2.actual_input_tokens else null end,
    actual_output_tokens=case when ledger.rate_kind='model_tokens' then settle_ai_budget_v2.actual_output_tokens else null end,
    actual_external_queries=case when ledger.rate_kind='external_query' then settle_ai_budget_v2.actual_external_queries else null end,
    actual_cost_microunits=actual_cost, safe_reason_code=null, settled_at=now(), updated_at=now()
    where ledger.id=target_reservation and ledger.company_id=target_company;
  return jsonb_build_object('settled',true,'idempotent',false,'actual_cost',actual_cost::numeric / 1000000,
    'currency',reservation.currency,'rate_version',reservation.rate_version,'over_reservation',actual_cost > reservation.reserved_cost_microunits);
end;
$$;

create or replace function public.mark_ai_budget_uncertain(
  target_company uuid,
  target_reservation uuid,
  request_key text,
  reason_code text default 'provider_result_unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare reservation public.ai_budget_reservations;
begin
  if target_company is null or target_reservation is null or request_key is null then
    return jsonb_build_object('marked',false,'reason','invalid_request');
  end if;
  select * into reservation from public.ai_budget_reservations r
    where r.id=target_reservation and r.company_id=target_company and r.request_key=mark_ai_budget_uncertain.request_key;
  if not found then return jsonb_build_object('marked',false,'reason','reservation_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || reservation.budget_period::text || ':ai-budget-v2', 0));
  select * into reservation from public.ai_budget_reservations r
    where r.id=target_reservation and r.company_id=target_company and r.request_key=mark_ai_budget_uncertain.request_key for update;
  if not found then return jsonb_build_object('marked',false,'reason','reservation_not_found'); end if;
  if reservation.status='settled' then return jsonb_build_object('marked',false,'reason','reservation_already_settled'); end if;
  update public.ai_budget_reservations set status='uncertain', safe_reason_code=case when reason_code ~ '^[a-z0-9_]{1,80}$' then reason_code else 'provider_result_unknown' end, updated_at=now()
    where id=target_reservation and company_id=target_company;
  return jsonb_build_object('marked',true,'held',true,'reservation_id',target_reservation);
end;
$$;

-- Mixed deployments must fail closed: old edge code cannot make an unpriced reservation.
create or replace function public.reserve_ai_budget(target_company uuid, requested_ai_calls integer default 0, requested_web_queries integer default 0, requested_tokens integer default 0, requested_cost numeric default 0)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return jsonb_build_object('allowed',false,'reason','reservation_protocol_upgrade_required');
end;
$$;

revoke all on function public.reserve_ai_budget(uuid,integer,integer,integer,numeric) from public, anon, authenticated;
revoke all on function public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.settle_ai_budget_v2(uuid,uuid,text,boolean,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.mark_ai_budget_uncertain(uuid,uuid,text,text) from public, anon, authenticated;
-- Older migrations granted this SECURITY DEFINER counter helper to authenticated.
-- Client callers could otherwise decrement the AI cost counter and bypass the
-- v2 budget. Server-side webhook callers continue through service_role.
revoke all on function public.increment_usage(uuid,text,date,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget(uuid,integer,integer,integer,numeric) to service_role;
grant execute on function public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer) to service_role;
grant execute on function public.settle_ai_budget_v2(uuid,uuid,text,boolean,integer,integer,integer) to service_role;
grant execute on function public.mark_ai_budget_uncertain(uuid,uuid,text,text) to service_role;
grant execute on function public.increment_usage(uuid,text,date,integer) to service_role;

comment on table public.ai_rate_cards is 'Privileged price cards. No active rates are seeded; paid calls remain denied until reviewed rates and currency are explicitly configured.';
comment on table public.ai_budget_reservations is 'Sanitized per-request spend ledger. Uncertain reservations remain held and are never auto-refunded.';
comment on column public.company_assistant_settings.ai_budget_currency is 'Currency code for max_daily_ai_cost. NULL disables paid AI until an authorized explicit configuration is supplied.';

-- Recovery: do not delete uncertain rows or reduce usage_counters automatically.
-- Reconcile only against provider billing evidence through a separately reviewed operational procedure.
-- Rollback requires paid AI to be disabled first; dropping this protocol without that gate would reopen legacy callers.

commit;
