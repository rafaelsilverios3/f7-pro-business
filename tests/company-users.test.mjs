import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/0018_company_user_access_hardening.sql', 'utf8');

test('0018 revokes direct membership writes', () => {
  assert.match(sql, /revoke insert, update, delete on table public\.company_users from authenticated/i);
  assert.match(sql, /grant select on table public\.company_users to authenticated/i);
});

test('only admin can change roles and create invites', () => {
  assert.match(sql, /actor_role <> 'admin'/i);
  assert.match(sql, /create or replace function public\.create_company_invite/i);
  assert.match(sql, /current_company_role\(target_company\) <> 'admin'/i);
});

test('self role and self deactivation are blocked', () => {
  assert.match(sql, /target_user = auth\.uid\(\).*Não é permitido alterar o próprio papel/is);
  assert.match(sql, /target_user = auth\.uid\(\).*Não é permitido desativar o próprio usuário/is);
});

test('last active administrator is protected', () => {
  assert.match(sql, /pelo menos um administrador ativo/i);
  assert.match(sql, /count\(\*\).*role = 'admin'.*active/is);
});

test('audit records member and invite changes without token data', () => {
  assert.match(sql, /member\.role_changed/i);
  assert.match(sql, /member\.deactivated/i);
  assert.match(sql, /invite\.created/i);
  assert.match(sql, /invite\.cancelled/i);
  assert.doesNotMatch(sql, /jsonb_build_object\([^)]*token/i);
});
