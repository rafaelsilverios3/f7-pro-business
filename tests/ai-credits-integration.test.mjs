import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261018210000_f7_ai_credits.sql');
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
