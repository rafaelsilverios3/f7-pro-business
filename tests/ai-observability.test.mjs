import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const migration = fs.readFileSync('supabase/migrations/0046_ai_observability_cost_health.sql', 'utf8');
const helper = fs.readFileSync('supabase/functions/_shared/aiObservability.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const health = fs.readFileSync('supabase/functions/platform-health/index.ts', 'utf8');
const inspector = fs.readFileSync('supabase/functions/ai-run-inspector/index.ts', 'utf8');

test('AI runs and events are company scoped, RLS protected and safe', () => {
  for (const table of ['ai_runs', 'ai_run_events', 'integration_health_snapshots']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.doesNotMatch(migration, /prompt|message_content|authorization|api_key/i);
  assert.doesNotMatch(helper, /prompt|headers|api[_ -]?key/i);
});

test('budget reservation is atomic and enforces every company limit', () => {
  for (const field of ['max_daily_ai_calls','max_daily_web_queries','max_research_rounds','max_tokens_per_request','max_daily_ai_cost']) assert.match(migration, new RegExp(field));
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /daily_ai_calls_exceeded/);
  assert.match(migration, /daily_web_queries_exceeded/);
  assert.match(migration, /request_tokens_exceeded/);
  assert.match(migration, /daily_ai_cost_exceeded/);
  assert.match(assistant, /reserveAIBudget/);
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
