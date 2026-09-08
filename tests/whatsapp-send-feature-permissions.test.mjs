import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/0035_whatsapp_send_feature_permissions.sql', 'utf8');
test('whatsapp-send can execute feature and rate limit checks server-side', () => {
  assert.match(sql, /grant execute on function public\.company_has_feature\(uuid, text\) to service_role/);
  assert.match(sql, /grant execute on function public\.consume_rate_limit\(uuid, uuid, text, integer, integer\) to service_role/);
  assert.doesNotMatch(sql, /to (anon|authenticated)/i);
});
