begin;

-- Add an explicit audited operation to remove a configured budget. The existing
-- eight-argument entry point remains available and retains its pause semantics.
create or replace function public.platform_admin_ai_set_company_budget(
  target_company uuid,
  consumption_enabled boolean,
  target_daily_calls integer,
  target_daily_web_queries integer,
  target_daily_budget numeric,
  target_currency text,
  target_max_tokens integer,
  audit_reason text,
  target_clear_budget boolean
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
  if consumption_enabled is null or target_clear_budget is null or (target_clear_budget and consumption_enabled) then
    raise exception using errcode = '22023', message = 'AI_FINANCIAL_CONFIG_INVALID';
  end if;

  -- Serialize administrator cap changes with the reservation RPC's company/day lock.
  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || current_date::text || ':ai-budget-v2', 0));
  select jsonb_build_object('max_daily_ai_calls', s.max_daily_ai_calls,
      'max_daily_web_queries', s.max_daily_web_queries,
      'max_daily_ai_cost', s.max_daily_ai_cost, 'ai_budget_currency', s.ai_budget_currency,
      'max_tokens_per_request', s.max_tokens_per_request)
    into before_data from public.company_assistant_settings s where s.company_id = target_company;

  if consumption_enabled then
    if target_daily_calls is null or target_daily_calls not between 1 and 1000
      or target_daily_web_queries is null or target_daily_web_queries not between 0 and 1000
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
    calls_value := 0;
    target_daily_web_queries := 0;
    budget_value := case when target_clear_budget then 0 else null end;
    currency_value := null;
  end if;

  insert into public.company_assistant_settings(company_id, max_daily_ai_calls, max_daily_web_queries, max_daily_ai_cost,
      ai_budget_currency, max_tokens_per_request)
    values (target_company, calls_value, coalesce(target_daily_web_queries, 0), coalesce(budget_value, 0), currency_value,
      coalesce(target_max_tokens, 8000))
  on conflict (company_id) do update set
    max_daily_ai_calls = excluded.max_daily_ai_calls,
    max_daily_web_queries = excluded.max_daily_web_queries,
    max_daily_ai_cost = case when consumption_enabled or target_clear_budget then excluded.max_daily_ai_cost else public.company_assistant_settings.max_daily_ai_cost end,
    ai_budget_currency = case when consumption_enabled or target_clear_budget then excluded.ai_budget_currency else public.company_assistant_settings.ai_budget_currency end,
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

-- Existing callers retain the pause-and-resume behavior. Clearing the cap is an
-- explicit new parameter and always passes through the same owner assertion,
-- serialization lock, validation, and audit trail.
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
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.platform_admin_ai_set_company_budget(target_company, consumption_enabled,
    target_daily_calls, target_daily_web_queries, target_daily_budget, target_currency,
    target_max_tokens, audit_reason, false);
$$;

revoke all on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text,boolean) from public, anon, authenticated, service_role;
revoke all on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text,boolean) to authenticated;
grant execute on function public.platform_admin_ai_set_company_budget(uuid,boolean,integer,integer,numeric,text,integer,text) to authenticated;

commit;
