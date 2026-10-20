import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { platformAdminCanAccessAction } from '../supabase/functions/_shared/platformAdminAccess.js';

const migration = fs.readFileSync('supabase/migrations/20261020151303_admin_plan_grants.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/platform-admin/index.ts', 'utf8');
const provider = fs.readFileSync('supabase/functions/_shared/webResearch.ts', 'utf8');
const grantsUi = fs.readFileSync('src/components/platform-admin/PlanGrantsAdmin.jsx', 'utf8');

test('manual plan grants are private, audited and independent of billing', () => {
  assert.match(migration, /create table public\.company_plan_grants/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.company_plan_grants from public, anon, authenticated/i);
  assert.match(migration, /company\.plan_grant\.created/i);
  assert.match(migration, /company\.plan_grant\.revoked/i);
  assert.match(migration, /grant_type = 'lifetime' and ends_at is null/i);
  assert.match(migration, /PLATFORM_PLAN_GRANT_OWNER_REQUIRED/i);
  assert.match(migration, /pg\.ends_at is null or pg\.ends_at > statement_timestamp\(\)/i);
  assert.match(migration, /left join lateral/i);
  assert.match(edge, /userClient\(jwt\)\.rpc\('platform_admin_create_plan_grant'/i);
  assert.match(edge, /company_plan_grants/);
  assert.doesNotMatch(migration, /insert into public\.(?:payments|invoices|billing_subscriptions)/i);
});

test('grant write actions are limited to global admins, with lifetime enforced by owner-only SQL', () => {
  for (const role of ['owner', 'admin']) {
    assert.equal(platformAdminCanAccessAction(role, 'create_plan_grant'), true);
    assert.equal(platformAdminCanAccessAction(role, 'revoke_plan_grant'), true);
  }
  for (const role of ['support', 'readonly', 'company_admin', 'member']) {
    assert.equal(platformAdminCanAccessAction(role, 'create_plan_grant'), false);
    assert.equal(platformAdminCanAccessAction(role, 'revoke_plan_grant'), false);
  }
});

test('Brave can use the backend-only secret name and remains pending without it', () => {
  assert.match(provider, /Deno\.env\.get\('BRAVE_SEARCH_API_KEY'\)/);
  assert.match(provider, /Deno\.env\.get\('WEB_SEARCH_API_KEY'\) \|\| braveKey/);
  assert.match(provider, /if \(!config\.key\).*WEB_SEARCH_NOT_CONFIGURED/s);
  assert.doesNotMatch(provider, /VITE_BRAVE_SEARCH_API_KEY/);
});

test('admin grant view separates raw paid status from the paid period and effective access', () => {
  assert.match(grantsUi, /const billingState =/);
  assert.match(grantsUi, /new Date\(deadline\)\.getTime\(\) <= Date\.now\(\)/);
  assert.match(grantsUi, /Validade do acesso/);
  assert.match(grantsUi, /Plano efetivo/);
});
