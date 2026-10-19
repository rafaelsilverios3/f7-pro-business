import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const migration = fs.readFileSync('supabase/migrations/0046_ai_observability_cost_health.sql', 'utf8');
const budgetMigration = fs.readFileSync('supabase/migrations/20261014234651_ai_budget_reservations_and_settlement.sql', 'utf8');
const helper = fs.readFileSync('supabase/functions/_shared/aiObservability.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const health = fs.readFileSync('supabase/functions/platform-health/index.ts', 'utf8');
const inspector = fs.readFileSync('supabase/functions/ai-run-inspector/index.ts', 'utf8');
const budgetPolicy = await import('../supabase/functions/_shared/aiBudgetPolicy.js');

test('AI runs and events are company scoped, RLS protected and safe', () => {
  for (const table of ['ai_runs', 'ai_run_events', 'integration_health_snapshots']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.doesNotMatch(migration, /prompt|message_content|authorization|api_key/i);
  assert.doesNotMatch(helper, /prompt|headers|api[_ -]?key/i);
});

test('budget reservation is atomic and enforces every company limit', () => {
  for (const field of ['max_daily_ai_calls','max_daily_web_queries','max_research_rounds','max_tokens_per_request','max_daily_ai_cost']) assert.match(migration, new RegExp(field));
  assert.match(budgetMigration, /pg_advisory_xact_lock/);
  assert.match(budgetMigration, /daily_ai_calls_exceeded/);
  assert.match(budgetMigration, /daily_web_queries_exceeded/);
  assert.match(budgetMigration, /request_tokens_exceeded/);
  assert.match(budgetMigration, /daily_ai_cost_exceeded/);
  assert.match(assistant, /reserveAIModelBudget/);
  assert.match(budgetMigration, /unique\(company_id, request_key\)/);
  assert.match(budgetMigration, /ai_cost_microunits/);
});

test('AI budget migration is explicitly transactional and keeps its RPC and ledger boundary private', () => {
  const transactionStart = budgetMigration.search(/\bbegin\s*;/i);
  const transactionCommit = budgetMigration.search(/\bcommit\s*;\s*$/i);
  assert.ok(transactionStart > budgetMigration.indexOf('-- Legacy usage counters'));
  assert.ok(transactionCommit > budgetMigration.lastIndexOf('comment on column'));
  for (const fn of ['reserve_ai_budget_v2','settle_ai_budget_v2','mark_ai_budget_uncertain']) {
    assert.match(budgetMigration, new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog, public`, 'i'));
    assert.match(budgetMigration, new RegExp(`grant execute on function public\\.${fn}\\([^;]+ to service_role`, 'i'));
    assert.match(budgetMigration, new RegExp(`revoke all on function public\\.${fn}\\([^;]+ from public, anon, authenticated`, 'i'));
  }
  assert.match(budgetMigration, /alter table public\.ai_budget_reservations enable row level security/i);
  assert.match(budgetMigration, /revoke all on public\.ai_rate_cards, public\.ai_budget_reservations from public, anon, authenticated, service_role/i);
  assert.match(budgetMigration, /reservation_protocol_upgrade_required/);
});

test('model budget policy fails closed for zero, missing, invalid, or underpriced budgets', () => {
  const base = { max_daily_ai_calls: 10, max_tokens_per_request: 5000, max_daily_ai_cost: 1, ai_budget_currency: 'USD' };
  const rateCard = { rate_version: 'v1', currency: 'USD', input_cost_per_1k: 0.01, output_cost_per_1k: 0.02 };
  assert.equal(budgetPolicy.planModelReservation({ settings: { ...base, max_daily_ai_cost: 0 }, rateCard, inputTokens: 100, maxOutputTokens: 200 }).reason, 'ai_cost_budget_missing');
  assert.equal(budgetPolicy.planModelReservation({ settings: { ...base, max_daily_ai_cost: null }, rateCard, inputTokens: 100, maxOutputTokens: 200 }).allowed, false);
  assert.equal(budgetPolicy.planModelReservation({ settings: { ...base, max_daily_ai_cost: Number.NaN }, rateCard, inputTokens: 100, maxOutputTokens: 200 }).allowed, false);
  assert.equal(budgetPolicy.planModelReservation({ settings: base, rateCard: { ...rateCard, input_cost_per_1k: 'invalid' }, inputTokens: 100, maxOutputTokens: 200 }).reason, 'ai_model_price_missing');
  assert.equal(budgetPolicy.planModelReservation({ settings: base, rateCard: { ...rateCard, input_cost_per_1k: Number.NaN }, inputTokens: 100, maxOutputTokens: 200 }).reason, 'ai_model_price_missing');
  assert.equal(budgetPolicy.planModelReservation({ settings: base, rateCard: { ...rateCard, currency: 'EUR' }, inputTokens: 100, maxOutputTokens: 200 }).reason, 'budget_currency_mismatch');
  assert.equal(budgetPolicy.planModelReservation({ settings: { ...base, max_daily_ai_cost: 0.001 }, rateCard, inputTokens: 100, maxOutputTokens: 200 }).reason, 'daily_ai_cost_exceeded');
  assert.equal(budgetPolicy.planModelReservation({ settings: base, rateCard, inputTokens: 4990, maxOutputTokens: 20 }).allowed, true);
  assert.equal(budgetPolicy.planModelReservation({ settings: base, rateCard, inputTokens: 100, maxOutputTokens: 5001 }).reason, 'output_tokens_exceeded');
  assert.equal(budgetPolicy.planModelReservation({ settings: base, rateCard: { ...rateCard, output_cost_per_1k: 0 }, inputTokens: 100, maxOutputTokens: 20 }).allowed, true);
});

test('reserve request rejects free/unpriced work before invoking the SQL reservation', () => {
  assert.equal(budgetPolicy.validateReservationRequest({ companyId: 'tenant-a', aiCalls: 1, tokens: 100, estimatedCost: 0 }).reason, 'ai_cost_reservation_required');
  assert.equal(budgetPolicy.validateReservationRequest({ companyId: 'tenant-a', webQueries: 1, estimatedCost: 0 }).reason, 'web_query_price_missing');
  assert.equal(budgetPolicy.validateReservationRequest({ companyId: 'tenant-a', aiCalls: 1, tokens: -1, estimatedCost: 1 }).allowed, false);
  assert.equal(budgetPolicy.validateReservationRequest({ companyId: 'tenant-a', aiCalls: 1, tokens: 1, estimatedCost: Number.NaN }).allowed, false);
  assert.equal(budgetPolicy.validateReservationRequest({ companyId: 'tenant-a', aiCalls: 0, webQueries: 0 }).reason, 'budget_request_empty');
});

test('reservation includes maximum output and rounds monetary cost upward', () => {
  const plan = budgetPolicy.planModelReservation({ settings: { max_daily_ai_calls: 3, max_tokens_per_request: 1000, max_daily_ai_cost: 1, ai_budget_currency: 'USD' }, rateCard: { rate_version: 'test-v1', currency: 'USD', input_cost_per_1k: 0.000001, output_cost_per_1k: 0.000001 }, inputTokens: 101, maxOutputTokens: 50 });
  assert.equal(plan.allowed, true);
  assert.equal(plan.reserved_tokens, 151);
  assert.equal(plan.max_output_tokens, 50);
  assert.equal(plan.estimated_cost, 0.000001);
});

test('unknown external query price is denied and does not enter the monetary reserve', () => {
  const plan = budgetPolicy.planExternalReservation({ settings: { max_daily_ai_cost: 2, ai_budget_currency: 'USD' }, webQueries: 1 });
  assert.equal(plan.allowed, false);
  assert.equal(plan.reason, 'web_query_price_missing');
  assert.equal(budgetPolicy.planExternalReservation({ settings: { max_daily_ai_cost: Number.NaN, ai_budget_currency: 'USD' }, rateCard: { rate_version: 'v1', currency: 'USD', cost_per_query: 0.01 }, webQueries: 1 }).allowed, false);
  const policy = fs.readFileSync('supabase/functions/_shared/aiBudgetPolicy.js', 'utf8');
  const shared = fs.readFileSync('supabase/functions/_shared/aiObservability.ts', 'utf8');
  assert.match(shared, /reserve_ai_budget_v2/);
  assert.match(budgetMigration, /rate_card_missing_or_ambiguous/);
});

test('paid provider calls require a complete, internally consistent reservation response', () => {
  const data = { allowed: true, reservation_id: 'a8900000-0000-4000-8000-000000000001', rate_version: 'v1', currency: 'USD', reserved_cost: 0.01, reserved_tokens: 300, max_output_tokens: 200, reserved_external_queries: 0 };
  assert.deepEqual(budgetPolicy.validateReservationResult({ data, kind: 'model_tokens', inputTokens: 100, maxOutputTokens: 200 }), { allowed: true });
  assert.equal(budgetPolicy.validateReservationResult({ data: { ...data, reservation_id: null }, kind: 'model_tokens', inputTokens: 100, maxOutputTokens: 200 }).reason, 'reservation_response_invalid');
  assert.equal(budgetPolicy.validateReservationResult({ data: { ...data, reserved_cost: 0 }, kind: 'model_tokens', inputTokens: 100, maxOutputTokens: 200 }).allowed, false);
  assert.equal(budgetPolicy.validateReservationResult({ data: { ...data, reserved_tokens: 299 }, kind: 'model_tokens', inputTokens: 100, maxOutputTokens: 200 }).allowed, false);
  const external = { ...data, reserved_tokens: 0, max_output_tokens: 0, reserved_external_queries: 3 };
  assert.equal(budgetPolicy.validateReservationResult({ data: external, kind: 'external_query', externalQueries: 3 }).allowed, true);
  assert.equal(budgetPolicy.validateReservationResult({ data: external, kind: 'external_query', externalQueries: 2 }).allowed, false);
});

test('provider metrics are validated, over-reservation usage is measurable and missing metrics remain unknown', () => {
  assert.deepEqual(budgetPolicy.readProviderUsage({ prompt_tokens: 80, completion_tokens: 40 }, { reservedInputTokens: 100, maxOutputTokens: 50 }), { input_tokens: 80, output_tokens: 40, reported: true });
  assert.deepEqual(budgetPolicy.readProviderUsage({ prompt_tokens: 101, completion_tokens: 51 }, { reservedInputTokens: 100, maxOutputTokens: 50 }), { input_tokens: 101, output_tokens: 51, reported: true });
  assert.equal(budgetPolicy.readProviderUsage({ prompt: 'not numeric', completion: 4 }, { reservedInputTokens: 100, maxOutputTokens: 50 }).reported, false);
  assert.equal(budgetPolicy.readProviderUsage(undefined, { reservedInputTokens: 100, maxOutputTokens: 50 }).reported, false);
  assert.equal(budgetPolicy.readProviderUsage({ prompt_tokens: 0, completion_tokens: 0 }, { reservedInputTokens: 100, maxOutputTokens: 50 }).reported, false);
});

test('all generative providers cap output, and reservation remains company scoped and atomic', () => {
  const assistantSales = fs.readFileSync('supabase/functions/ai-sales-assistant/index.ts', 'utf8');
  const intelligence = fs.readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8');
  const supplier = fs.readFileSync('supabase/functions/supplier-intelligence/index.ts', 'utf8');
  assert.match(assistant, /max_tokens: MAX_PROVIDER_OUTPUT_TOKENS/);
  assert.match(assistantSales, /max_completion_tokens: MAX_PROVIDER_OUTPUT_TOKENS/);
  assert.doesNotMatch(assistantSales, /gpt-4o-mini/);
  assert.match(intelligence, /max_tokens: MAX_AI_OUTPUT_TOKENS/);
  assert.match(`${assistant}\n${assistantSales}\n${intelligence}\n${supplier}`, /AI_ENABLED[^\n]*!== 'true'/);
  assert.doesNotMatch(`${assistant}\n${assistantSales}\n${intelligence}\n${supplier}`, /\.rpc\('reserve_ai_budget'/);
  assert.match(budgetMigration, /pg_advisory_xact_lock\(hashtextextended\(target_company::text \|\| ':' \|\| day::text \|\| ':ai-budget-v2', 0\)\)/);
  const shared = fs.readFileSync('supabase/functions/_shared/aiObservability.ts', 'utf8');
  assert.match(shared, /requested_kind: 'model_tokens'/);
  assert.match(shared, /requested_kind: 'external_query'/);
  assert.match(shared, /settle_ai_budget_v2/);
  assert.match(shared, /mark_ai_budget_uncertain/);
});

test('failed or timed-out provider calls keep the conservative reservation; no unsafe refund path exists', () => {
  const functions = [
    fs.readFileSync('supabase/functions/ai-sales-assistant/index.ts', 'utf8'),
    assistant,
    fs.readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8'),
  ].join('\n');
  assert.doesNotMatch(functions, /release_ai_budget|refund_ai_budget|decrement_ai_cost/i);
  assert.match(functions, /AI_PROVIDER_TIMEOUT|AbortError/);
  assert.match(helper, /reserveAIModelBudget/);
  assert.match(assistant, /model_key: model/);
  assert.match(budgetMigration, /status='uncertain'/);
  assert.match(budgetMigration, /actual_cost > reservation\.reserved_cost_microunits/);
});

test('company research limits constrain the bounded research engine', () => {
  const research = fs.readFileSync('supabase/functions/_shared/webResearch.ts', 'utf8');
  assert.match(assistant, /limits:\s*\{\s*max_rounds:\s*maxResearchRounds,\s*max_web_queries:\s*maxWebQueriesPerRun\s*\}/);
  assert.match(research, /round < maxRounds/);
  assert.match(research, /max_web_queries:\s*maxQueries/);
});

test('assistant records the required trace stages and safe operational counts', () => {
  for (const stage of ['REQUEST_RECEIVED','CONTEXT_READY','TOOLS_SELECTED','RESEARCH_STARTED','RESEARCH_COMPLETED','DECISION_READY','POLICY_CHECKED','RESPONSE_CREATED','COMPLETED','FAILED']) assert.match(`${helper}\n${assistant}`, new RegExp(stage));
  for (const field of ['tool_names','query_count','source_domains','candidate_count','duration_ms','safe_error_code']) assert.match(helper, new RegExp(field));
});

test('health distinguishes evidence states without paid probes', () => {
  for (const state of ['HEALTHY','DEGRADED','ERROR','UNKNOWN']) assert.match(`${migration}\n${health}`, new RegExp(state));
  assert.doesNotMatch(health, /api\.openai\.com|api\.search\.brave\.com|graph\.facebook\.com/);
});

test('inspector requires authenticated admin or manager and returns no content fields', () => {
  assert.match(inspector, /AUTH_REQUIRED/);
  assert.match(inspector, /auth\.getUser\(token\)/);
  assert.match(inspector, /admin.*gestor/);
  assert.match(inspector, /\.eq\('company_id', companyId\)/);
  assert.doesNotMatch(inspector, /message_content|prompt|authorization|api_key|secret/i);
});

test('observability functions resolve the authenticated user before checking membership', () => {
  assert.match(health, /auth\.getUser\(token\)/);
  assert.match(inspector, /const token = auth\(req\)/);
  assert.match(health, /const token = auth\(req\)/);
});

test('supabase provider tolerates an invalid sort value without crashing the page', () => {
  const provider = fs.readFileSync('src/data/providers/supabaseProvider.js', 'utf8');
  assert.match(provider, /typeof sort === 'string'/);
  assert.match(provider, /normalizeSort\(sort/);
});
