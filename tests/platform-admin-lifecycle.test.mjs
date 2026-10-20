import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isPlatformAdminCurrent,
  normalizePlatformAdminExpiry,
  platformAdminCanAccessAction,
} from '../supabase/functions/_shared/platformAdminAccess.js';

const edge = fs.readFileSync('supabase/functions/platform-admin/index.ts', 'utf8');
const adminUi = fs.readFileSync('src/pages/PlatformAdmin.jsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261016233851_platform_admin_temporary_expiry.sql', 'utf8');
const aiMigration = fs.readFileSync('supabase/migrations/20261016232326_20261016170000_platform_ai_financial_admin_controls.sql', 'utf8');

test('owner and owner-authorized operational admins can be permanent independently of company state', () => {
  assert.equal(isPlatformAdminCurrent({ role: 'owner', status: 'active', expires_at: null }), true);
  assert.equal(isPlatformAdminCurrent({ role: 'owner', status: 'active' }), false);
  assert.equal(isPlatformAdminCurrent({ role: 'owner', status: 'active', expires_at: undefined }), false);
  assert.equal(isPlatformAdminCurrent({ role: 'owner', status: 'disabled', expires_at: null }), false);
  assert.equal(isPlatformAdminCurrent({ role: 'owner', status: 'active', expires_at: '2027-01-01T00:00:00Z' }), false);
  assert.equal(isPlatformAdminCurrent({ role: 'admin', status: 'active', expires_at: null }), true);
  assert.equal(isPlatformAdminCurrent({ role: 'admin', status: 'active' }), false);
  assert.equal(isPlatformAdminCurrent({ role: 'admin', status: 'active', expires_at: undefined }), false);
});

test('temporary admins and non-admin global roles require a future expiry and lose access when it passes', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  assert.equal(isPlatformAdminCurrent({ role: 'admin', status: 'active', expires_at: '2026-10-16T12:01:00.000Z' }, now), true);
  assert.equal(isPlatformAdminCurrent({ role: 'admin', status: 'active', expires_at: '2026-10-16T11:59:00.000Z' }, now), false);
  assert.equal(isPlatformAdminCurrent({ role: 'support', status: 'active', expires_at: '2026-10-16T11:59:00.000Z' }, now), false);
  assert.equal(isPlatformAdminCurrent({ role: 'readonly', status: 'active', expires_at: null }, now), false);
  assert.equal(isPlatformAdminCurrent({ role: 'admin', status: 'disabled', expires_at: '2026-10-17T00:00:00Z' }, now), false);
  assert.equal(isPlatformAdminCurrent({ role: 'company_admin', status: 'active', expires_at: '2026-10-17T00:00:00Z' }, now), false);
  assert.equal(isPlatformAdminCurrent({ role: 'support', status: 'active', expires_at: 'invalid' }, now), false);
});

test('expiry input is future-dated; permanent grants require explicit owner choice in the handler', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  assert.deepEqual(normalizePlatformAdminExpiry('2026-10-17T12:00:00Z', { required: true, now }), { valid: true, value: '2026-10-17T12:00:00.000Z' });
  assert.equal(normalizePlatformAdminExpiry(undefined, { required: true, now }).valid, false);
  assert.equal(normalizePlatformAdminExpiry(null, { required: true, now }).valid, false);
  assert.equal(normalizePlatformAdminExpiry('not-a-date', { now }).valid, false);
  assert.equal(normalizePlatformAdminExpiry('2026-10-16T12:00:00Z', { now }).valid, false);
  assert.deepEqual(normalizePlatformAdminExpiry(undefined, { now }), { valid: true, value: undefined });
  assert.deepEqual(normalizePlatformAdminExpiry(null, { allowPermanent: true, now }), { valid: true, value: null });
  assert.equal(normalizePlatformAdminExpiry(null, { now }).valid, false);
});

test('finance readers can inspect AI controls but only owner can change tariffs or budgets', () => {
  assert.equal(platformAdminCanAccessAction('company_admin', 'access'), false);
  assert.equal(platformAdminCanAccessAction('readonly', 'overview'), true);
  assert.equal(platformAdminCanAccessAction('readonly', 'users'), false);
  assert.equal(platformAdminCanAccessAction('support', 'company'), true);
  assert.equal(platformAdminCanAccessAction('support', 'data'), false);
  assert.equal(platformAdminCanAccessAction('readonly', 'ai_financial_rates'), true);
  assert.equal(platformAdminCanAccessAction('readonly', 'ai_financial_usage'), true);
  assert.equal(platformAdminCanAccessAction('support', 'ai_financial_usage'), true);
  assert.equal(platformAdminCanAccessAction('support', 'update_company_plan'), false);
  assert.equal(platformAdminCanAccessAction('admin', 'ai_financial_usage'), true);
  assert.equal(platformAdminCanAccessAction('admin', 'ai_financial_budget'), false);
  assert.equal(platformAdminCanAccessAction('admin', 'ai_financial_rate_create'), false);
  assert.equal(platformAdminCanAccessAction('readonly', 'ai_financial_budget'), false);
  assert.equal(platformAdminCanAccessAction('support', 'ai_financial_rate_enable'), false);
  assert.equal(platformAdminCanAccessAction('admin', 'create_platform_admin'), false);
  assert.equal(platformAdminCanAccessAction('owner', 'create_platform_admin'), true);
  assert.equal(platformAdminCanAccessAction('owner', 'ai_financial_budget'), true);
});

test('Edge Function enforces expiry, explicit permanent grants, owner-only administration, and audit', () => {
  assert.match(edge, /isPlatformAdminCurrent\(adminRow\.data\)/);
  assert.match(edge, /input\.permanent === true/);
  assert.match(edge, /permanentRequestValid/);
  assert.match(edge, /PLATFORM_OWNER_MUST_BE_PERMANENT/);
  assert.match(edge, /ACTIVE_PLATFORM_ADMIN_REQUIRES_FUTURE_EXPIRY/);
  assert.match(edge, /PERMANENT_ADMIN_REQUIRES_OWNER_CONFIRMATION/);
  assert.match(edge, /role !== 'owner'.*PLATFORM_OWNER_REQUIRED/);
  assert.match(edge, /platform_admin\.read/);
  assert.match(edge, /expires_at,created_at,created_by,last_access_at/);
});

test('migration supports permanent owner/admin, expires temporary roles, and limits financial writes to owner', () => {
  assert.match(migration, /add column if not exists expires_at timestamptz/i);
  assert.match(migration, /check \(role <> 'owner' or expires_at is null\)/i);
  assert.match(migration, /check \(role in \('owner','admin'\) or status <> 'active' or expires_at is not null\)/i);
  assert.match(migration, /pa\.role <> 'owner' and pa\.expires_at > statement_timestamp\(\)/i);
  assert.match(migration, /create or replace function public\.is_platform_admin\(\)/i);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.is_platform_admin\(\) from public, anon/i);
  assert.match(migration, /platform_admin_ai_assert_financial_reader\(\)/i);
  assert.match(migration, /platform_admin_ai_assert_financial_admin\(\)[\s\S]*pa\.role = 'owner'/i);
  assert.match(migration, /platform_admin_ai_list_rate_cards\([\s\S]*assert_financial_reader/i);
  assert.match(migration, /platform_admin_ai_company_financial_usage\([\s\S]*assert_financial_reader/i);
  assert.match(aiMigration, /platform_admin_ai_assert_financial_admin/);
});

test('bootstrap uses the SQL owner, grants only temporary readonly, and never impersonates its beneficiary in audit', () => {
  assert.match(migration, /platform_admin_bootstrap_readonly[\s\S]*security invoker/i);
  assert.match(migration, /current_user <> 'postgres'/i);
  assert.match(migration, /interval '2 hours'/i);
  assert.match(migration, /set role = 'readonly', status = 'active', expires_at = target_expires_at/i);
  assert.match(migration, /admin_user_id, actor_kind, actor_reference, action/i);
  assert.match(migration, /null, 'bootstrap_operator', 'supabase_sql_editor'/i);
  assert.match(migration, /platform_admin_bootstrap_revoke[\s\S]*set role = 'admin', status = 'disabled', expires_at = null/i);
  assert.match(migration, /revoke all on function public\.platform_admin_bootstrap_readonly\([^;]+ from public, anon, authenticated, service_role/i);
  assert.match(migration, /platform_admin_audit_actor_attribution_check/i);
  assert.match(migration, /ACTIVE_SCOPED_PLATFORM_ADMIN_REQUIRES_EXPLICIT_EXPIRY/);
  assert.match(migration, /BOOTSTRAP_TARGET_CHANGED_SINCE_ACTIVATION/);
  assert.match(migration, /actor_kind,\s*actor_reference/);
  assert.match(edge, /actor_kind,actor_reference,company_id,action/);
});

test('database serializes owner-set changes and protects the last permanent active owner', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('platform-admin-owner-set', 0\)\)/i);
  assert.match(migration, /platform_admins_guard_last_owner/i);
  assert.match(migration, /perform id from public\.platform_admins[\s\S]*for update/i);
  assert.match(migration, /LAST_PLATFORM_OWNER_PROTECTED/);
  assert.match(edge, /LAST_OWNER_PROTECTED/);
  assert.match(edge, /adminRow\.data\.role !== 'owner'.*PLATFORM_OWNER_REQUIRED/);
});

test('platform admin overview separates plan entitlement, assistant setup, provider readiness, and automation state', () => {
  assert.match(edge, /getCompanyAiOverview/);
  assert.match(edge, /from\('plan_features'\).*ai.*ai_sales/i);
  assert.match(edge, /from\('company_feature_overrides'\).*ai.*ai_sales/i);
  assert.match(edge, /AI_API_KEY.*AI_MODEL/);
  assert.match(edge, /ai_overview: aiOverview/);
  assert.match(adminUi, /IA incluída no plano/);
  assert.match(adminUi, /Entitlement efetivo/);
  assert.match(adminUi, /provider_ready \? 'Disponível' : 'Indisponível'/);
  assert.match(adminUi, /assistant_configured \? 'Configurado' : 'Não configurado'/);
  assert.match(adminUi, /Pendente de configuração/);
  assert.match(adminUi, /Assistentes prontos no modo assistido/);
  assert.match(adminUi, /automatic_reply_configured/);
});
