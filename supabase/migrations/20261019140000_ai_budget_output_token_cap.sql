-- Keep the configured token ceiling on model output, while still reserving
-- and charging the full input + output estimate. Conservative input framing must
-- not accidentally reject valid requests or reduce financial reservations.
-- Conceptual rollback: retain the output-only cap; reverting to the old total-token
-- comparison can strand valid requests. Use a reviewed forward fix and preserve
-- existing usage, reservations, and ledger rows.
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
    if cfg.max_tokens_per_request is null or requested_output_tokens > cfg.max_tokens_per_request then return jsonb_build_object('allowed',false,'reason','output_tokens_exceeded'); end if;
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
revoke all on function public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer) to service_role;
comment on function public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer) is
  'Reserve complete input/output financial cost; max_tokens_per_request caps output tokens only.';
