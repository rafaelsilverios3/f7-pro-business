import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0034_whatsapp_send_membership_permissions.sql', 'utf8');
const page = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');

test('whatsapp-send can read membership without granting user writes', () => {
  assert.match(migration, /grant select on table public\.company_users to service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)/i);
  assert.doesNotMatch(migration, /authenticated|anon/);
});

test('inbox exposes the safe send stage and internal code', () => {
  assert.match(page, /Falha no envio \(\$\{error\.stage/);
  assert.match(page, /error\.code/);
  assert.doesNotMatch(page, /WHATSAPP_ACCESS_TOKEN|service_role/);
});
