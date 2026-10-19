import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { platformAdminCanAccessAction } from '../supabase/functions/_shared/platformAdminAccess.js';

const migration = readFileSync('supabase/migrations/20261019010927_f7_ai_owner_credit_limits.sql', 'utf8');
const edge = readFileSync('supabase/functions/platform-admin/index.ts', 'utf8');
const credits = readFileSync('supabase/functions/_shared/aiCredits.ts', 'utf8');
const sales = readFileSync('supabase/functions/ai-sales-assistant/index.ts', 'utf8');
const intelligence = readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8');
const suggest = readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const wallet = readFileSync('src/components/ai/AICreditsWallet.jsx', 'utf8');
const adminUi = readFileSync('src/components/platform-admin/AiCreditsAdmin.jsx', 'utf8');
const integrationsUi = readFileSync('src/pages/Integracoes.jsx', 'utf8');

test('Owner exemption derives only from active permanent platform owner record and active company membership', () => {
  assert.match(migration, /a\.role='owner' and a\.status='active' and a\.expires_at is null/i);
  assert.match(migration, /m\.company_id=p_company and m\.user_id=p_user and m\.active/i);
  assert.doesNotMatch(migration, /rafaelsilverio|f7group7|email/i);
  assert.match(credits, /owner\.is_owner === true/);
  assert.match(credits, /if \(ownerError \|\| owner\?\.ok !== true\) return \{ allowed: false/);
});

test('only the Owner can adjust personal limits, and customer roles cannot escalate to global controls', () => {
  assert.equal(platformAdminCanAccessAction('owner', 'ai_owner_usage_update'), true);
  for (const role of ['admin', 'support', 'readonly']) assert.equal(platformAdminCanAccessAction(role, 'ai_owner_usage_update'), false);
  assert.equal(platformAdminCanAccessAction('owner', 'ai_owner_usage_read'), true);
  assert.equal(platformAdminCanAccessAction('admin', 'ai_owner_usage_read'), true); // RPC independently rejects non-Owner.
  assert.match(migration, /PLATFORM_OWNER_REQUIRED/);
  assert.match(migration, /grant execute on function public\.platform_owner_ai_usage_policy_update_v1\([^;]+ to authenticated/i);
  assert.match(edge, /userClient\(jwt\)/);
  assert.match(adminUi, /ownerAIUsagePolicy\(\)/);
  assert.match(adminUi, /updateOwnerAIUsagePolicy/);
  assert.match(adminUi, /const snapshot = result\?\.policy \|\| \{\}; setData\(snapshot\); const policy = snapshot\?\.policy \|\| \{\}/);
  assert.match(integrationsUi, /platformAdminService\.access\(\)/);
  assert.match(integrationsUi, /isGlobalOwner === true \|\|/);
});

test('Owner plan exemption is server-derived after company role checks and leaves other AI feature gates intact', () => {
  for (const source of [sales, intelligence, suggest]) {
    assert.match(source, /hasPermanentGlobalOwnerAccess\(sb/);
    assert.match(source, /globalOwner\.is_owner/);
  }
  assert.ok(sales.indexOf('roleHasAiSalesPermissions(member.role)') < sales.indexOf('hasPermanentGlobalOwnerAccess(sb'));
  assert.ok(intelligence.indexOf('ALLOWED_ROLES.has(member.role)') < intelligence.indexOf('hasPermanentGlobalOwnerAccess(sb'));
  assert.ok(suggest.indexOf("feature: 'external_product_intelligence'") !== -1);
  assert.match(suggest, /feature: 'external_product_intelligence'[\s\S]{0,500}if \(!researchAllowed\)/);
  assert.match(credits, /data\?\.role === 'owner' && data\?\.status === 'active' && data\?\.expires_at === null/);
});

test('personal daily limits default to five calls, zero web, and five BRL without affecting commercial plan tables', () => {
  assert.match(migration, /temporary_limits_enabled boolean not null default true/);
  assert.match(migration, /daily_call_limit integer not null default 5/);
  assert.match(migration, /daily_web_query_limit integer not null default 0 check \(daily_web_query_limit = 0\)/);
  assert.match(migration, /daily_budget_brl numeric\(18,6\) not null default 5/);
  assert.match(migration, /used_calls>=policy_row\.daily_call_limit/);
  assert.match(migration, /if used_cost\+max_brl>policy_row\.daily_budget_brl/);
  assert.doesNotMatch(migration, /temporary_limits_enabled and used_cost\+max_brl/);
  assert.match(migration, /check_platform_owner_web_policy_v1/);
  assert.doesNotMatch(migration, /update public\.ai_credit_plans|delete from public\.ai_credit_plans/i);
  assert.match(wallet, /Owner Global · isento de créditos comerciais/);
  assert.match(wallet, /!ownerUsage/);
  assert.match(adminUi, /teto financeiro diário pessoal continua obrigatório/);
});

test('owner spend ledger is isolated, private, idempotent, and retains actual and reserved usage separately', () => {
  assert.match(migration, /create table if not exists public\.platform_owner_ai_usage_operations/);
  assert.match(migration, /unique\(owner_user_id,request_key\)/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_user::text\|\|':'\|\|day_utc::text\|\|':owner-ai-usage',0\)\)/i);
  assert.match(migration, /alter table public\.platform_owner_ai_usage_operations enable row level security/i);
  assert.match(migration, /from public,anon,authenticated,service_role/i);
  assert.match(migration, /actual_cost_brl/);
  assert.match(migration, /reserved_brl/);
  assert.match(migration, /status='uncertain'/);
  assert.match(migration, /released_cost_brl/);
});
