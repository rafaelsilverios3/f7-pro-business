import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const entitlement = read('supabase/migrations/0085_tenant_commercial_access_hardening.sql');
const admin = read('supabase/functions/platform-admin/index.ts');
const ui = read('src/pages/PlatformAdmin.jsx');
const access = read('supabase/functions/_shared/mercadolivreAccess.ts');

 test('marketplace entitlement fails closed until the canonical plan catalog or company override grants it', () => {
  assert.match(entitlement, /if subscription_status = 'trial'[\s\S]*?return false;[\s\S]*?from public\.company_feature_overrides[\s\S]*?from public\.plan_features[\s\S]*?else false/i);
  assert.doesNotMatch(entitlement, /when 'marketplace_integrations' then true/i);
});

test('company override remains behind platform-admin role authorization and audited server update', () => {
  assert.match(admin, /function isWrite\(action: string\).*update_feature/);
  assert.match(admin, /const WRITE_ROLES = \['owner', 'admin'\]/);
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

