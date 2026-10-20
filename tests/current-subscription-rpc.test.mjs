import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0076_current_subscription_rpc.sql', 'utf8');
const grantMigration = fs.readFileSync('supabase/migrations/20261020154400_fix_lifetime_grant_subscription_validity.sql', 'utf8');
const service = fs.readFileSync('src/services/subscriptionService.js', 'utf8');

test('current subscription RPC returns only the canonical minimum and checks active membership', () => {
  for (const field of ['company_id', 'plan', 'status', 'trial_ends_at', 'current_period_start', 'current_period_end']) assert.match(migration, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public/i);
  assert.match(migration, /auth\.uid\(\) is not null/i);
  assert.match(migration, /company_users/);
  assert.match(migration, /cu\.company_id = s\.company_id/);
  assert.match(migration, /cu\.user_id = auth\.uid\(\)/);
  assert.match(migration, /cu\.active = true/);
  assert.match(migration, /revoke all on function public\.get_current_subscription\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.get_current_subscription\(uuid\) to authenticated/i);
  assert.doesNotMatch(migration, /market_payment|access_token|webhook|provider/i);
});

test('frontend calls the tenant-safe RPC and never selects subscription rows directly', () => {
  assert.match(service, /rpc\('get_current_subscription', \{ target_company: companyId \}\)/);
  assert.doesNotMatch(service, /from\('company_subscriptions'\)/);
  assert.doesNotMatch(service, /rpc\('sync_company_trial'/);
  assert.match(service, /Array\.isArray\(data\) \? data\[0\]/);
});

test('subscription loading is keyed by the selected company and has no UI-side mutation', () => {
  assert.match(service, /loadSubscription\(companyId\)/);
  assert.match(service, /target_company: companyId/);
  assert.doesNotMatch(service, /insert\(|update\(|upsert\(|delete\(/);
});

test('RPC contract is fail-closed for cross-tenant, inactive, anonymous and missing membership cases', () => {
  for (const pattern of [
    /where s\.company_id = target_company/i,
    /auth\.uid\(\) is not null/i,
    /cu\.company_id = s\.company_id/i,
    /cu\.user_id = auth\.uid\(\)/i,
    /cu\.active = true/i,
  ]) assert.match(migration, pattern);
  assert.match(migration, /grant execute on function public\.get_current_subscription\(uuid\) to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.get_current_subscription\(uuid\) to anon/i);
});

test('effective lifetime grants keep a null end date instead of inheriting expired billing validity', () => {
  assert.match(grantMigration, /case when g\.id is not null then g\.ends_at else s\.current_period_end end/i);
  assert.match(grantMigration, /case when g\.id is not null then g\.starts_at else s\.current_period_start end/i);
  assert.match(grantMigration, /auth\.uid\(\) is not null/i);
  assert.match(grantMigration, /cu\.active = true/i);
  assert.match(grantMigration, /revoke all on function public\.get_current_subscription\(uuid\) from public, anon/i);
  assert.match(grantMigration, /grant execute on function public\.get_current_subscription\(uuid\) to authenticated/i);
});
