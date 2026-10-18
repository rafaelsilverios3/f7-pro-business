import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { platformAdminCanAccessAction } from '../supabase/functions/_shared/platformAdminAccess.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const entitlement = read('supabase/migrations/0085_tenant_commercial_access_hardening.sql');
const catalog = read('supabase/migrations/20261016151752_plan_marketplace_integrations_entitlements.sql');
const admin = read('supabase/functions/platform-admin/index.ts');
const platformAccess = read('supabase/functions/_shared/platformAdminAccess.js');
const ui = read('src/pages/PlatformAdmin.jsx');
const access = read('supabase/functions/_shared/mercadolivreAccess.ts');

test('the canonical plan catalog grants marketplace integrations to paid plans and explicitly excludes Free', () => {
  assert.match(catalog, /insert into public\.plan_features\s*\(plan_id, feature, enabled\)/i);
  assert.match(catalog, /p\.code in \('pro', 'business', 'premium'\)/i);
  assert.match(catalog, /where p\.code in \('free', 'pro', 'business', 'premium'\)/i);
  assert.match(catalog, /on conflict \(plan_id, feature\)\s*do update set enabled = excluded\.enabled/i);
  assert.match(catalog, /p\.code in \('pro', 'business', 'premium'\)\s+from public\.plans/i);
  assert.doesNotMatch(catalog, /update public\.(plans|company_subscriptions|company_feature_overrides)/i);
});

test('the central entitlement resolver keeps subscription lifecycle gates before plan_features', () => {
  assert.match(entitlement, /if subscription_status = 'trial'[\s\S]*?return false;[\s\S]*?from public\.company_feature_overrides[\s\S]*?from public\.plan_features[\s\S]*?else false/i);
  assert.match(entitlement, /where p\.code = plan_name\s+and p\.active\s+and pf\.feature = lower\(trim\(\$2\)\)/i);
  assert.match(entitlement, /'expired', 'cancelled', 'suspended', 'past_due'/i);
  assert.doesNotMatch(entitlement, /when 'marketplace_integrations' then true/i);
});

test('browser plan projection agrees with the commercial marketplace matrix', async () => {
  const { FEATURE_PLANS, canUseFeature, canUseSubscriptionFeature } = await import('../src/services/planService.js');
  assert.equal(FEATURE_PLANS.marketplace_integrations, 'pro');
  for (const plan of ['pro', 'business', 'premium']) assert.equal(canUseFeature(plan, 'marketplace_integrations'), true, `${plan} should include marketplaces`);
  assert.equal(canUseFeature('free', 'marketplace_integrations'), false);
  assert.equal(canUseSubscriptionFeature({ plan: 'pro', status: 'active' }, 'marketplace_integrations'), true);
  assert.equal(canUseSubscriptionFeature({ plan: 'free', status: 'active' }, 'marketplace_integrations'), false);
  assert.equal(canUseSubscriptionFeature({ plan: 'pro', status: 'trial' }, 'marketplace_integrations'), false);
  assert.equal(canUseSubscriptionFeature({ plan: 'premium', status: 'expired' }, 'marketplace_integrations'), false);
});

test('company override remains behind platform-admin role authorization and audited server update', () => {
  assert.match(admin, /assertCapability\(adminRow\.data\.role, action\)/);
  assert.match(platformAccess, /const WRITE_ACTIONS = new Set\([\s\S]*?'update_feature'[\s\S]*?\)/);
  assert.equal(platformAdminCanAccessAction('owner', 'update_feature'), true);
  assert.equal(platformAdminCanAccessAction('admin', 'update_feature'), true);
  assert.equal(platformAdminCanAccessAction('support', 'update_feature'), false);
  assert.equal(platformAdminCanAccessAction('readonly', 'update_feature'), false);
  assert.equal(platformAdminCanAccessAction('company_admin', 'update_feature'), false);
  assert.match(admin, /company_feature_overrides'\)\.upsert/);
  assert.match(admin, /company\.feature\.enabled/);
  assert.match(admin, /company\.feature\.removed/);
});

test('platform admin UI can grant and revoke the specific homologation override without changing plan or price', () => {
  assert.match(ui, /feature: 'marketplace_integrations'/);
  assert.match(ui, /enabled: enabling \? true : null/);
  assert.match(ui, /canManageFeatures=\{\['owner', 'admin'\]\.includes\(access\.role\)\}/);
  assert.match(ui, /data\.subscription\?\.status !== 'active'/);
  assert.match(ui, /não altera o catálogo de planos nem os preços/i);
  assert.match(ui, /não há expiração automática/i);
});

test('connector still authorizes each request by active company membership and central entitlement', () => {
  assert.match(access, /from\('company_users'\)[\s\S]*?eq\('company_id', companyId\)[\s\S]*?eq\('user_id', user\.id\)/);
  assert.match(access, /company_has_feature_internal/);
  assert.match(access, /MARKETPLACE_ENTITLEMENT = 'marketplace_integrations'/);
  assert.match(access, /FEATURE_NOT_AVAILABLE/);
});

