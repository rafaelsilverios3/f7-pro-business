import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateAiRateCard, validateAiRateCardEnabled, validateCompanyAiBudget, SUPPORTED_AI_CURRENCIES } from '../supabase/functions/_shared/platformAiFinancialPolicy.js';

const migration = fs.readFileSync('supabase/migrations/20261016232326_20261016170000_platform_ai_financial_admin_controls.sql', 'utf8');
const lifecycleMigration = fs.readFileSync('supabase/migrations/20261016233851_platform_admin_temporary_expiry.sql', 'utf8');
const budgetMigration = fs.readFileSync('supabase/migrations/20261014234651_ai_budget_reservations_and_settlement.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/platform-admin/index.ts', 'utf8');
const accessPolicy = fs.readFileSync('supabase/functions/_shared/platformAdminAccess.js', 'utf8');
const ui = fs.readFileSync('src/components/platform-admin/AiFinancialControls.jsx', 'utf8');
const service = fs.readFileSync('src/services/platformAdminService.js', 'utf8');

const validBudget = { consumption_enabled: true, daily_calls: 30, daily_web_queries: 20, daily_budget: 8, currency: 'USD', max_tokens_per_request: 12000, reason: 'Approved limited pilot' };
const validRate = { rate_kind: 'model_tokens', provider_key: 'https://api.openai.com', model_key: 'test-model-v1', rate_version: '2026-10-v1', currency: 'USD', input_cost_per_1k: 0.1, output_cost_per_1k: 0.4, source_reference: 'https://provider.example/pricing', effective_from: new Date(Date.now() + 60_000).toISOString(), enabled: false, reason: 'Tariff review 2026' };

test('budget policy accepts bounded explicit pilot input and safe disable', () => {
  assert.deepEqual(validateCompanyAiBudget(validBudget), { allowed: true });
  assert.deepEqual(validateCompanyAiBudget({ consumption_enabled: false, reason: 'Pause the AI spend' }), { allowed: true });
  for (const patch of [
    { daily_calls: 0 }, { daily_calls: 1001 }, { daily_web_queries: -1 },
    { daily_budget: 0 }, { daily_budget: 1000.01 }, { daily_budget: 'NaN' }, { currency: 'XYZ' },
    { currency: 'usd' }, { currency: 'USDX' }, { max_tokens_per_request: 255 },
    { max_tokens_per_request: 100001 }, { reason: 'short' },
  ]) assert.equal(validateCompanyAiBudget({ ...validBudget, ...patch }).allowed, false, JSON.stringify(patch));
});

test('rate policy rejects invalid tariff, model, currency, and unsafe source URLs', () => {
  assert.deepEqual(validateAiRateCard(validRate), { allowed: true });
  assert.deepEqual(validateAiRateCard({ ...validRate, rate_kind: 'external_query', provider_key: 'brave', model_key: null, input_cost_per_1k: null, output_cost_per_1k: null, cost_per_query: 0.01 }), { allowed: true });
  assert.deepEqual(validateAiRateCardEnabled({ rate_card_id: 'rate-card-id', enabled: false, reason: 'Retire tariff' }), { allowed: true });
  for (const patch of [
    { input_cost_per_1k: -0.01 }, { output_cost_per_1k: 'Infinity' },
    { input_cost_per_1k: 0, output_cost_per_1k: 0 }, { currency: 'US' }, { currency: 'XYZ' },
    { model_key: '' }, { source_reference: 'http://provider.example/pricing' },
    { source_reference: 'https://user:password@provider.example/pricing' },
    { source_reference: 'https://provider.example/pricing?token=secret' },
    { provider_key: 'https://api.openai.com/v1/chat/completions' },
    { effective_until: new Date(Date.now()).toISOString() },
  ]) assert.equal(validateAiRateCard({ ...validRate, ...patch }).allowed, false, JSON.stringify(patch));
  assert.equal(validateAiRateCardEnabled({ rate_card_id: 'x', enabled: true, reason: 'ok' }).allowed, false);
  assert.deepEqual(SUPPORTED_AI_CURRENCIES, ['BRL', 'EUR', 'USD']);
});

test('database keeps AI pricing and reservation ledger private and exposes only guarded RPCs', () => {
  assert.match(migration, /create trigger company_assistant_settings_guard_ai_financial[\s\S]*before insert or update on public\.company_assistant_settings/i);
  assert.match(migration, /new\.max_daily_ai_cost > old\.max_daily_ai_cost/i);
  assert.match(migration, /new\.max_daily_ai_calls > old\.max_daily_ai_calls/i);
  assert.match(migration, /new\.ai_budget_currency is distinct from old\.ai_budget_currency and new\.ai_budget_currency is not null/i);
  assert.match(migration, /AI_FINANCIAL_LIMITS_PLATFORM_ADMIN_ONLY/);
  assert.match(migration, /public\.platform_admin_ai_assert_financial_admin\(\)[\s\S]*pa\.status = 'active'[\s\S]*pa\.role in \('owner','admin'\)/i);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.platform_admin_ai_set_company_budget\([^;]+ from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.platform_admin_ai_set_company_budget\([^;]+ to authenticated/i);
  assert.match(migration, /ai_rate_cards[\s\S]*select 1 from public\.ai_rate_cards/i);
  assert.match(migration, /grant execute on function public\.platform_admin_ai_list_rate_cards\(\) to authenticated/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(target_company::text \|\| ':' \|\| current_date::text \|\| ':ai-budget-v2', 0\)\)/);
  assert.match(migration, /platform_admin_audit_logs\([\s\S]*company\.ai_financial_budget\.changed/);
  assert.match(lifecycleMigration, /platform_admin_ai_assert_financial_admin\(\)[\s\S]*pa\.role = 'owner'/i);
  assert.match(lifecycleMigration, /platform_admin_ai_assert_financial_reader\(\)[\s\S]*pa\.role in \('owner','admin','support','readonly'\)/i);
  assert.match(budgetMigration, /ai_rate_cards_prevent_repricing/);
  assert.match(migration, /AI_FINANCIAL_RATE_OVERLAP/);
  assert.equal((migration.match(/target_currency not in \('BRL','EUR','USD'\)/g) || []).length, 2);
  assert.doesNotMatch(migration, /AI_ENABLED|ALTER SYSTEM|dblink/i);
});

test('Edge financial actions use caller JWT RPCs and exclude limits from generic settings updates', () => {
  assert.match(accessPolicy, /AI_FINANCIAL_ACTIONS[\s\S]*ai_financial_budget/);
  assert.match(edge, /userClient\(jwt\)/);
  assert.match(edge, /platform_admin_ai_set_company_budget/);
  assert.match(edge, /platform_admin_ai_create_rate_card/);
  const genericUpdate = edge.slice(edge.indexOf("if (action === 'update_ai')"), edge.indexOf("if (action === 'ai_financial_rates'"));
  assert.doesNotMatch(genericUpdate, /max_daily_ai_calls|max_daily_web_queries|max_tokens_per_request|max_daily_ai_cost|ai_budget_currency/);
  assert.match(edge, /PLATFORM_ADMIN_REQUIRED/);
  assert.match(edge, /adminRow\.data\.role/);
  const genericAiRead = edge.slice(edge.indexOf("if (action === 'ai')"), edge.indexOf("if (action === 'update_ai')"));
  assert.doesNotMatch(genericAiRead, /max_daily_ai_cost|ai_budget_currency/);
  const companySummary = edge.slice(edge.indexOf('async function companySummary'), edge.indexOf('Deno.serve'));
  assert.doesNotMatch(companySummary, /max_daily_ai_cost|ai_budget_currency/);
  assert.match(service, /aiFinancialUsage/);
  assert.match(service, /updateAiFinancialBudget/);
});

test('admin UI exposes bounded tariff, company budget, pause, and sanitized reservation controls', () => {
  for (const label of ['Tarifas de IA', 'Modelo exato', 'Entrada por 1.000 tokens', 'Saída por 1.000 tokens', 'Orçamento de geração da empresa', 'Teto diário na moeda escolhida', 'Consumo por geração habilitado', 'Consumo e reservas']) assert.ok(ui.includes(label), label);
  assert.match(ui, /disabled=\{!canManage/);
  assert.match(ui, /request keys não são exibidos/);
  assert.match(ui, /não ativa AI_ENABLED/i);
  assert.match(ui, /const aiCurrencies = \['BRL', 'USD', 'EUR'\]/);
  assert.match(ui, /Buscar empresa por nome ou identificador/);
  assert.match(ui, /platformAdminService\.companies\(\{ search: query, page: 1, page_size: 100 \}\)/);
  assert.match(ui, /const loadUsage = useCallback\(async \(\) => \{ if \(!canRead\) return;/);
  assert.match(ui, /const budgetSettings = usage\.budget/);
  assert.doesNotMatch(ui, /data\?\.rows \|\| \[\]/);
});
