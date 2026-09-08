import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/0037_assistant_backend_permissions.sql', 'utf8');
const contextSql = fs.readFileSync('supabase/migrations/0038_assistant_context_backend_permissions.sql', 'utf8');
const webhookSql = fs.readFileSync('supabase/migrations/0029_whatsapp_webhook_backend_permissions.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const core = fs.readFileSync('supabase/functions/_shared/core.ts', 'utf8');

test('assistant backend receives only SELECT on the settings tables it reads', () => {
  for (const table of ['company_assistant_settings', 'company_quick_replies', 'company_handoff_rules']) {
    assert.match(sql, new RegExp(`grant select on table public\\.${table} to service_role`, 'i'));
    assert.match(edge, new RegExp(`from\\(['"]${table}['"]\\)`, 'i'));
  }
  assert.doesNotMatch(sql, /grant\s+(?:all|select,\s*)?(?:insert|update|delete)/i);
  assert.doesNotMatch(sql, /to\s+(?:anon|authenticated)/i);
});

test('assistant-suggest uses the privileged server-side client and keeps company filters', () => {
  assert.match(core, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /\.eq\('company_id', conversation\.company_id\)/g);
  assert.doesNotMatch(edge, /VITE_SUPABASE_SERVICE_ROLE|VITE_SERVICE_ROLE|service_role.*frontend/i);
});

test('context permissions grant only read access to the catalog table', () => {
  assert.match(contextSql, /grant select on table public\.products to service_role/i);
  assert.doesNotMatch(contextSql, /grant\s+(?:all|select,\s*)?(?:insert|update|delete)/i);
  assert.doesNotMatch(contextSql, /to\s+(?:anon|authenticated)/i);
});

test('context audit covers every query resource and keeps existing message access read-only', () => {
  assert.match(webhookSql, /grant select, insert, update on table public\.messages to service_role/i);
  assert.match(sql, /grant select on table public\.company_quick_replies to service_role/i);
  assert.match(sql, /grant select on table public\.company_handoff_rules to service_role/i);
  assert.doesNotMatch(contextSql, /grant\s+(?:all|select,\s*)?(?:insert|update|delete)/i);
});
