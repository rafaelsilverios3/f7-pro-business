import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { platformAdminCanAccessAction } from '../supabase/functions/_shared/platformAdminAccess.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261019003000_f7_ai_credits.sql');
const recoveryMigration = read('../supabase/migrations/20261019130000_ai_credit_uncertain_reconciliation.sql');
const outputTokenCapMigration = read('../supabase/migrations/20261019140000_ai_budget_output_token_cap.sql');
const generationHandlers = [
  ['../supabase/functions/ai-sales-assistant/index.ts', 'await reserveAIForOwnerOrCredits(sb', 'generated = await modelRouter.generateStructured'],
  ['../supabase/functions/intelligence-query/index.ts', 'await reserveAIForOwnerOrCredits(sb', "const generated: any = await modelRouter.generateStructured('openai_compatible', { query"],
  ['../supabase/functions/assistant-suggest/index.ts', 'await reserveAIForOwnerOrCredits(sb', 'const providerSuggestion: any = await modelRouter.generateStructured'],
];

test('credit persistence is private, nonnegative, auditable, and executable only through guarded RPCs', () => {
  for (const table of ['ai_credit_wallets', 'ai_credit_operations', 'ai_credit_ledger', 'ai_credit_purchase_sessions']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /revoke all on public\.[\s\S]*from public,anon,authenticated,service_role/i);
  assert.match(migration, /monthly_remaining integer not null default 0 check \(monthly_remaining >= 0\)/i);
  assert.match(migration, /extra_balance integer not null default 0 check \(extra_balance >= 0\)/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(target_company::text\|\|':'\|\|request_key,0\)\)/i);
  assert.match(migration, /platform_admin_audit_logs\([\s\S]*ai_credits\.company_adjusted/i);
  assert.match(migration, /platform_admin_audit_logs\([\s\S]*ai_credits\.package\.updated/i);
  assert.match(migration, /platform_owner_required/i);
  assert.match(migration, /effective_from<=now\(\)/i);
  assert.match(migration, /status in \('reserved','settled','uncertain'\)/i);
  assert.match(migration, /credit_cycle_start timestamptz not null/i);
});

test('all live model-generation entry points reserve credits before provider request and settle reported usage', () => {
  for (const [path, reserve, providerCall] of generationHandlers) {
    const source = read(path);
    const reserveAt = source.indexOf(reserve);
    const providerAt = source.indexOf(providerCall, reserveAt);
    assert.notEqual(reserveAt, -1, `${path} must reserve credits`);
    assert.notEqual(providerAt, -1, `${path} must contain provider request after the reservation`);
    assert.ok(reserveAt < providerAt, `${path} must reserve before provider call`);
    assert.match(source, /settleAIForOwnerOrCredits\(sb/);
    assert.match(source, /AI_CREDITS_CONFIRMATION_REQUIRED/);
    assert.match(source, /releaseAIForOwnerOrCredits/);
  }
});

test('package checkout is server-priced and only the verified billing webhook settles credits', () => {
  const checkout = read('../supabase/functions/billing-checkout/index.ts');
  const webhook = read('../supabase/functions/billing-webhook/index.ts');
  assert.match(checkout, /create_ai_credit_purchase_v1/);
  assert.match(checkout, /purchase\.amount_minor/);
  assert.match(checkout, /external_reference:\s*purchase\.id/);
  assert.match(checkout, /body\?\.billing_model\s*&&\s*body\.billing_model\s*!==\s*'one_time'/);
  assert.match(webhook, /settle_ai_credit_purchase_v1/);
  assert.match(webhook, /normalized\.activationEligible\s*\?\s*'approved'/);
  assert.match(migration, /AI_CREDIT_PURCHASE_PAYMENT_MISMATCH/);
});

test('credit confirmation binds backend quote to request and cancellation does not invoke generation', () => {
  for (const [path] of generationHandlers) {
    const source = read(path);
    assert.match(source, /ai_credit_quote_id/);
    assert.match(source, /confirm_ai_credits/);
    assert.match(source, /AI_CREDITS_CONFIRMATION_REQUIRED/);
  }
  const dialog = read('../src/components/ai/AICreditConfirmationDialog.jsx');
  assert.match(dialog, /Custo máximo autorizado/);
  assert.match(dialog, /Saldo atual/);
  assert.match(dialog, /Saldo mínimo após a análise/);
  assert.match(dialog, /Cancelar/);
  assert.match(dialog, /Confirmar análise/);
});

test('uncertain credit recovery is Owner-only, evidence-bound, auditable, and idempotent', () => {
  assert.match(recoveryMigration, /status in \('quoted','reserved','settled','cancelled','uncertain','expired','released'\)/i);
  assert.match(recoveryMigration, /role='owner' and a\.status='active' and a\.expires_at is null/i);
  assert.match(recoveryMigration, /p_resolution is null or p_resolution not in \('provider_not_sent','usage_confirmed'\)/i);
  assert.match(recoveryMigration, /Unknown provider outcomes must remain held/i);
  assert.match(recoveryMigration, /for update/i);
  assert.match(recoveryMigration, /uncertain-release:'\|\|op\.id/i);
  assert.match(recoveryMigration, /on conflict\(company_id,entry_type,reference_key\) do nothing/i);
  assert.match(recoveryMigration, /platform_admin_audit_logs/i);
  assert.match(recoveryMigration, /reconciliation_evidence_ref=safe_evidence then[\s\S]*duplicate.*true/i);
  assert.match(recoveryMigration, /platform_admin_ai_credit_uncertain_list_v1/i);
  assert.match(recoveryMigration, /grant execute on function public\.platform_admin_ai_credit_uncertain_list_v1\(\) to authenticated/i);
  assert.match(recoveryMigration, /revoke all on function public\.platform_admin_ai_credit_uncertain_list_v1\(\) from public,anon,service_role/i);
  assert.match(recoveryMigration, /AI_CREDITS_CEILING_BREACHED/i);
  const admin = read('../supabase/functions/platform-admin/index.ts');
  assert.match(admin, /caller\.rpc\('platform_admin_ai_credit_uncertain_list_v1'\)/);
  assert.doesNotMatch(admin, /service\.from\('ai_credit_operations'\)/);
  const policy = read('../supabase/functions/_shared/platformAdminAccess.js');
  assert.match(policy, /AI_CREDIT_RECOVERY_ACTIONS/);
  assert.match(policy, /AI_CREDIT_RECOVERY_ACTIONS\.has\(action\) && role !== 'owner'/);
  assert.equal(platformAdminCanAccessAction('owner', 'ai_credits_uncertain_list'), true);
  for (const role of ['admin', 'support', 'readonly']) {
    assert.equal(platformAdminCanAccessAction(role, 'ai_credits_uncertain_list'), false);
    assert.equal(platformAdminCanAccessAction(role, 'ai_credits_uncertain_resolve'), false);
  }
  const panel = read('../src/components/platform-admin/AiCreditsAdmin.jsx');
  assert.match(panel, /Se o resultado for desconhecido, cancele e mantenha a reserva/);
  assert.match(panel, /evidências verificáveis provam que o provedor NÃO recebeu/);
});

test('AI financial budget caps requested output while reserving full input and output cost', () => {
  assert.match(outputTokenCapMigration, /requested_output_tokens > cfg\.max_tokens_per_request/);
  assert.match(outputTokenCapMigration, /'output_tokens_exceeded'/);
  assert.doesNotMatch(outputTokenCapMigration, /reserved_tokens > cfg\.max_tokens_per_request/);
  assert.match(outputTokenCapMigration, /reserved_tokens := requested_input_tokens::bigint \+ requested_output_tokens::bigint/);
  assert.match(outputTokenCapMigration, /rate\.input_cost_per_1k \* requested_input_tokens \+ rate\.output_cost_per_1k \* requested_output_tokens/);
  assert.match(outputTokenCapMigration, /'reserved_tokens',reserved_tokens,'max_output_tokens',requested_output_tokens/);
  assert.match(outputTokenCapMigration, /revoke all on function public\.reserve_ai_budget_v2[\s\S]*from public,anon,authenticated/);
  assert.match(outputTokenCapMigration, /grant execute on function public\.reserve_ai_budget_v2[\s\S]*to service_role/);
});
