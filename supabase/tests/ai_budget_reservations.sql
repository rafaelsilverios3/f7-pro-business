begin;
select no_plan();

insert into auth.users(id, email, aud, role) values
  ('a8900000-0000-4000-8000-000000000001', 'ai-budget-owner@example.invalid', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.companies(id, name) values
  ('a8910000-0000-4000-8000-000000000001', 'Synthetic AI Budget A'),
  ('a8910000-0000-4000-8000-000000000002', 'Synthetic AI Budget B'),
  ('a8910000-0000-4000-8000-000000000003', 'Synthetic AI Budget Without Settings'),
  ('a8910000-0000-4000-8000-000000000004', 'Synthetic AI Budget Without Currency');
insert into public.company_assistant_settings(company_id, max_daily_ai_cost, ai_budget_currency, max_daily_ai_calls, max_daily_web_queries, max_tokens_per_request)
values
  ('a8910000-0000-4000-8000-000000000001', 10, 'USD', 20, 20, 5000),
  ('a8910000-0000-4000-8000-000000000002', 0, 'USD', 20, 20, 5000),
  ('a8910000-0000-4000-8000-000000000004', 1, null, 20, 20, 5000);
insert into public.ai_rate_cards(rate_kind, provider_key, model_key, rate_version, currency, input_cost_per_1k, output_cost_per_1k, cost_per_query, source_reference, verified_at, approved_by, effective_from, enabled)
values
  ('model_tokens', 'https://provider.example', 'test-model', 'test-v1', 'USD', 0.001, 0.002, null, 'https://provider.example/pricing', now(), 'a8900000-0000-4000-8000-000000000001', now() - interval '1 day', true),
  ('model_tokens', 'https://provider.example', 'eur-model', 'test-eur-v1', 'EUR', 0.001, 0.002, null, 'https://provider.example/pricing-eur', now(), 'a8900000-0000-4000-8000-000000000001', now() - interval '1 day', true),
  ('external_query', 'brave', null, 'brave-test-v1', 'USD', null, null, 0.01, 'https://brave.com/search/api', now(), 'a8900000-0000-4000-8000-000000000001', now() - interval '1 day', true);

select ok(has_function_privilege('service_role', 'public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer)', 'EXECUTE'), 'Only the trusted server role can invoke the reservation RPC');
select ok((select count(*)=4 and bool_and(prosecdef and proconfig @> array['search_path=pg_catalog, public']) from pg_proc where oid in (
  'public.reserve_ai_budget(uuid,integer,integer,integer,numeric)'::regprocedure,
  'public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer)'::regprocedure,
  'public.settle_ai_budget_v2(uuid,uuid,text,boolean,integer,integer,integer)'::regprocedure,
  'public.mark_ai_budget_uncertain(uuid,uuid,text,text)'::regprocedure
)), 'Budget RPCs are SECURITY DEFINER with a fixed catalog-first search_path');
select ok(not has_function_privilege('authenticated', 'public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer)', 'EXECUTE'), 'Authenticated clients cannot invoke the reservation RPC');
select ok(not has_function_privilege('anon', 'public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer)', 'EXECUTE'), 'Anonymous clients cannot invoke the reservation RPC');
select ok(not has_function_privilege('authenticated', 'public.increment_usage(uuid,text,date,integer)', 'EXECUTE'), 'Authenticated clients cannot mutate usage counters through the legacy SECURITY DEFINER helper');
select ok(not has_function_privilege('anon', 'public.increment_usage(uuid,text,date,integer)', 'EXECUTE'), 'Anonymous clients cannot mutate usage counters through the legacy helper');
select ok(has_function_privilege('service_role', 'public.increment_usage(uuid,text,date,integer)', 'EXECUTE'), 'Trusted webhook callers retain the legacy counter helper');
select ok(not has_table_privilege('service_role', 'public.ai_budget_reservations', 'SELECT') and not has_table_privilege('service_role', 'public.ai_budget_reservations', 'INSERT'), 'The service role cannot bypass the RPC with direct ledger access');
select ok(not has_table_privilege('authenticated', 'public.ai_rate_cards', 'SELECT') and not has_table_privilege('authenticated', 'public.ai_rate_cards', 'INSERT'), 'Authenticated users cannot inspect or alter private price cards');
select ok(not has_table_privilege('authenticated', 'public.ai_budget_reservations', 'SELECT') and not has_table_privilege('authenticated', 'public.ai_budget_reservations', 'UPDATE'), 'Authenticated users cannot inspect or alter reservation records');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$ declare result jsonb; begin
  result := public.reserve_ai_budget('a8910000-0000-4000-8000-000000000001', 1, 0, 100, 0.001);
  perform set_config('test.ai_legacy_denied', result->>'allowed', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-model-1', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_first_allowed', result->>'allowed', true);
  perform set_config('test.ai_first_reservation_id', result->>'reservation_id', true);
  perform set_config('test.ai_first_cost', result->>'reserved_cost', true);
end $$;
select is(current_setting('test.ai_legacy_denied'), 'false', 'The legacy reservation contract is fail-closed');
select is(current_setting('test.ai_first_allowed'), 'true', 'A valid priced model request reserves atomically');
select is(current_setting('test.ai_first_cost')::numeric, 0.0012::numeric, 'Reservation cost combines separate input/output tariffs and rounds upward');

do $$ declare result jsonb; begin
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-model-1', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_duplicate_allowed', result->>'allowed', true);
  perform set_config('test.ai_duplicate_reason', result->>'reason', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-model-1', 'model_tokens', 'https://provider.example', 'test-model', 1000, 101, 0);
  perform set_config('test.ai_conflict_reason', result->>'reason', true);
end $$;
select is(current_setting('test.ai_duplicate_allowed'), 'false', 'Repeating a request key never authorizes a second provider call');
select is(current_setting('test.ai_duplicate_reason'), 'reservation_already_exists', 'An identical retry is identified as already reserved');
select is(current_setting('test.ai_conflict_reason'), 'idempotency_key_conflict', 'A request key cannot be reused with different inputs');

do $$ declare result jsonb; begin
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000002', 'request-zero-budget', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_zero_budget_allowed', result->>'allowed', true);
  perform set_config('test.ai_zero_budget_reason', result->>'reason', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000003', 'request-missing-settings', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_missing_settings_reason', result->>'reason', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000004', 'request-missing-currency', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_missing_currency_reason', result->>'reason', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-unknown-model', 'model_tokens', 'https://provider.example', 'unknown-model', 1000, 100, 0);
  perform set_config('test.ai_unknown_tariff_reason', result->>'reason', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-currency-mismatch', 'model_tokens', 'https://provider.example', 'eur-model', 1000, 100, 0);
  perform set_config('test.ai_currency_reason', result->>'reason', true);
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-invalid-input', 'model_tokens', 'https://provider.example', 'test-model', 0, 100, 0);
  perform set_config('test.ai_invalid_request_reason', result->>'reason', true);
end $$;
select is(current_setting('test.ai_zero_budget_allowed'), 'false', 'Zero monetary budget blocks paid generation');
select is(current_setting('test.ai_zero_budget_reason'), 'ai_cost_budget_missing', 'Zero budget returns an explicit safe denial');
select is(current_setting('test.ai_missing_settings_reason'), 'settings_not_found', 'Missing company budget settings block paid generation');
select is(current_setting('test.ai_missing_currency_reason'), 'ai_cost_budget_missing', 'Missing currency blocks paid generation');
select is(current_setting('test.ai_unknown_tariff_reason'), 'rate_card_missing_or_ambiguous', 'Unknown model pricing blocks paid generation');
select is(current_setting('test.ai_currency_reason'), 'budget_currency_mismatch', 'Currency mismatch blocks paid generation');
select is(current_setting('test.ai_invalid_request_reason'), 'invalid_model_reservation', 'Malformed token requests block before reservation');

reset role;
update public.company_assistant_settings set max_daily_ai_cost='NaN'::numeric where company_id='a8910000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare result jsonb; begin
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-nan-budget', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_nan_budget_reason', result->>'reason', true);
end $$;
select is(current_setting('test.ai_nan_budget_reason'), 'ai_cost_budget_missing', 'NaN monetary budgets are explicitly denied');
reset role;
update public.company_assistant_settings set max_daily_ai_cost=10 where company_id='a8910000-0000-4000-8000-000000000001';

do $$ declare rejected boolean := false; begin
  begin
    insert into public.ai_rate_cards(rate_kind, provider_key, model_key, rate_version, currency, input_cost_per_1k, output_cost_per_1k, source_reference, verified_at, approved_by, effective_from, enabled)
    values ('model_tokens', 'https://bad-rate.example', 'bad-model', 'bad-v1', 'USD', 'NaN'::numeric, 0.001, 'https://bad-rate.example/pricing', now(), 'a8900000-0000-4000-8000-000000000001', now(), true);
  exception when check_violation then rejected := true;
  end;
  perform set_config('test.ai_nan_rate_rejected', rejected::text, true);
end $$;
select is(current_setting('test.ai_nan_rate_rejected'), 'true', 'NaN tariff components cannot be registered');

do $$ declare result jsonb; begin
  result := public.settle_ai_budget_v2('a8910000-0000-4000-8000-000000000002', current_setting('test.ai_first_reservation_id')::uuid, 'request-model-1', true, 900, 80, null);
  perform set_config('test.ai_cross_company_settlement', result->>'reason', true);
end $$;
select is(current_setting('test.ai_cross_company_settlement'), 'reservation_not_found', 'A company cannot settle another company reservation');

reset role;
select is((select count from public.usage_counters where company_id='a8910000-0000-4000-8000-000000000001' and metric='ai_cost_microunits' and period=current_date), 1200::bigint, 'Only the first reservation is represented in the daily cost counter');
select is((select status from public.ai_budget_reservations where id=current_setting('test.ai_first_reservation_id')::uuid), 'reserved', 'The new reservation has a durable ledger state');

set local role service_role;
do $$ declare result jsonb; begin
  result := public.settle_ai_budget_v2('a8910000-0000-4000-8000-000000000001', current_setting('test.ai_first_reservation_id')::uuid, 'request-model-1', true, 2000000, 100, null);
  perform set_config('test.ai_overage_settled', result->>'settled', true);
  perform set_config('test.ai_overage_flag', result->>'over_reservation', true);
  perform set_config('test.ai_overage_cost', result->>'actual_cost', true);
end $$;
select is(current_setting('test.ai_overage_settled'), 'true', 'Reliable provider usage above the estimate is reconciled rather than discarded');
select is(current_setting('test.ai_overage_flag'), 'true', 'The ledger identifies provider consumption above the reservation');
select is(current_setting('test.ai_overage_cost')::numeric, 2.0002::numeric, 'Settlement uses the immutable input and output tariff');

do $$ declare result jsonb; begin
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-search-1', 'external_query', 'brave', null, 0, 0, 3);
  perform set_config('test.ai_search_allowed', result->>'allowed', true);
  perform set_config('test.ai_search_id', result->>'reservation_id', true);
end $$;
select is(current_setting('test.ai_search_allowed'), 'true', 'An externally metered search reserves its maximum query count');

do $$ declare result jsonb; begin
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-overflow-validation', 'model_tokens', 'https://provider.example', 'test-model', 100, 100, 0);
  perform set_config('test.ai_overflow_validation_allowed', result->>'allowed', true);
  perform set_config('test.ai_overflow_validation_id', result->>'reservation_id', true);
end $$;
select is(current_setting('test.ai_overflow_validation_allowed'), 'true', 'An isolated reservation is available for overflow validation');
do $$ declare result jsonb; begin
  result := public.settle_ai_budget_v2('a8910000-0000-4000-8000-000000000001', current_setting('test.ai_overflow_validation_id')::uuid, 'request-overflow-validation', true, 2147483647, 2147483647, null);
  perform set_config('test.ai_overflow_validation_reason', result->>'reason', true);
end $$;
select is(current_setting('test.ai_overflow_validation_reason'), 'reservation_held_uncertain', 'Extreme provider token counters are classified without integer overflow');
reset role;
select is((select status from public.ai_budget_reservations where id=current_setting('test.ai_overflow_validation_id')::uuid), 'uncertain', 'Invalid extreme usage keeps the reservation held');
set local role service_role;

do $$ declare result jsonb; begin
  result := public.settle_ai_budget_v2('a8910000-0000-4000-8000-000000000001', current_setting('test.ai_search_id')::uuid, 'request-search-1', false, null, null, null);
  perform set_config('test.ai_search_unknown_reason', result->>'reason', true);
end $$;
select is(current_setting('test.ai_search_unknown_reason'), 'reservation_held_uncertain', 'Provider failure or timeout with unknown metering holds the reservation');
reset role;
select is((select status from public.ai_budget_reservations where id=current_setting('test.ai_search_id')::uuid), 'uncertain', 'Uncertain provider consumption remains auditable and held');
select is((select count from public.usage_counters where company_id='a8910000-0000-4000-8000-000000000001' and metric='web_queries' and period=current_date), 3::bigint, 'Uncertain search does not release reserved query budget');

set local role service_role;
do $$ declare result jsonb; begin
  result := public.settle_ai_budget_v2('a8910000-0000-4000-8000-000000000001', current_setting('test.ai_search_id')::uuid, 'request-search-1', true, null, null, 1);
  perform set_config('test.ai_search_retry_settled', result->>'settled', true);
  perform set_config('test.ai_search_cost', result->>'actual_cost', true);
end $$;
select is(current_setting('test.ai_search_retry_settled'), 'true', 'A later provider-billing reconciliation can settle an uncertain reservation');
select is(current_setting('test.ai_search_cost')::numeric, 0.01::numeric, 'Reconciliation keeps only the measured query charge');
reset role;
select is((select count from public.usage_counters where company_id='a8910000-0000-4000-8000-000000000001' and metric='web_queries' and period=current_date), 1::bigint, 'Only verified unused external query capacity is released');

set local role service_role;
do $$ declare result jsonb; begin
  result := public.settle_ai_budget_v2('a8910000-0000-4000-8000-000000000001', current_setting('test.ai_first_reservation_id')::uuid, 'request-model-1', true, 2000000, 100, null);
  perform set_config('test.ai_settle_retry', result->>'idempotent', true);
end $$;
reset role;
update public.company_assistant_settings set max_daily_ai_cost=2 where company_id='a8910000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare result jsonb; begin
  result := public.reserve_ai_budget_v2('a8910000-0000-4000-8000-000000000001', 'request-after-overage', 'model_tokens', 'https://provider.example', 'test-model', 1000, 100, 0);
  perform set_config('test.ai_after_overage_allowed', result->>'allowed', true);
  perform set_config('test.ai_after_overage_reason', result->>'reason', true);
end $$;
select is(current_setting('test.ai_settle_retry'), 'true', 'Repeating an identical settlement is idempotent');
select is(current_setting('test.ai_after_overage_allowed'), 'false', 'A verified overage consumes the remaining budget and blocks later calls');
select is(current_setting('test.ai_after_overage_reason'), 'daily_ai_cost_exceeded', 'Subsequent reservation observes the overage in the atomic budget');

reset role;
select ok((select status='settled' and actual_cost_microunits=10000 and source_currency_check.currency='USD'
  from public.ai_budget_reservations r join public.ai_rate_cards source_currency_check on source_currency_check.id=r.rate_card_id
  where r.id=current_setting('test.ai_search_id')::uuid), 'Settled audit row retains the rate-card currency and measured amount');
select ok(not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ai_budget_reservations' and column_name in ('prompt','request_body','authorization','api_key')), 'Reservation ledger stores no prompt or credential fields');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.reserve_ai_budget_v2(uuid,text,text,text,text,integer,integer,integer)'::regprocedure)) > 0, 'Concurrent reservations serialize by company and budget period');

select * from finish();
rollback;
