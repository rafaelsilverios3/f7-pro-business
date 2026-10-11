import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/0085_tenant_commercial_access_hardening.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8');
test('whatsapp-send uses the service-role-only entitlement resolver', () => {
  assert.match(sql, /grant execute on function public\.company_has_feature_internal\(uuid, text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.company_has_feature_internal\(uuid, text\) from public, anon, authenticated/i);
  assert.match(edge, /rpc\('company_has_feature_internal'/);
  assert.doesNotMatch(sql, /grant execute on function public\.company_has_feature_internal[^;]*to (anon|authenticated)/i);
});
