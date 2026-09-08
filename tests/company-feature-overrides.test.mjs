import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/0036_company_feature_overrides.sql', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');

test('company feature overrides remain scoped and do not change the global plan', () => {
  assert.match(sql, /company_feature_overrides/);
  assert.match(sql, /primary key \(company_id, feature\)/i);
  assert.match(sql, /company_id = target_company/);
  assert.match(sql, /when 'ai' then plan_name = 'premium'/);
  assert.match(sql, /override_enabled is not null/);
  assert.match(sql, /revoke insert, update, delete .*authenticated/i);
  assert.match(sql, /grant select, insert, update, delete .*service_role/i);
  assert.match(assistant, /company_has_feature/);
  assert.match(assistant, /feature: 'ai'/);
});

test('test-company enablement is an explicit manual SQL operation', () => {
  assert.doesNotMatch(sql, /62835558-c5af-4897-9457-d89684c7702f/);
  assert.doesNotMatch(sql, /insert into .*company_feature_overrides/i);
});
