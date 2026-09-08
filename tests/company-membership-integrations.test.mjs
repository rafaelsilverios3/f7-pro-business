import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hook = fs.readFileSync('src/hooks/useCompanyMembership.js', 'utf8');
const page = fs.readFileSync('src/pages/Integracoes.jsx', 'utf8');
const connect = fs.readFileSync('supabase/functions/whatsapp-connect/index.ts', 'utf8');

test('membership resolves role from the selected company and current user', () => {
  assert.match(hook, /from\('company_users'\)/);
  assert.match(hook, /eq\('company_id', companyId\)/);
  assert.match(hook, /eq\('user_id', user\.id\)/);
  assert.match(hook, /select\('role, active'\)/);
});

test('integration management allows only active admin or gestor membership', () => {
  assert.match(page, /useCompanyMembership\(company\?\.id\)/);
  assert.match(page, /membershipActive && \['admin', 'gestor'\]\.includes\(memberRole\)/);
  assert.doesNotMatch(page, /user\?\.role/);
});

test('membership loading is distinct from denied permission', () => {
  assert.match(page, /Verificando permissões/);
  assert.match(page, /!membershipLoading && !canManage/);
});

test('company membership query is scoped and cannot reuse another company', () => {
  assert.match(hook, /eq\('company_id', companyId\)[\s\S]*eq\('user_id', user\.id\)/);
});

test('backend remains the final authority for WhatsApp management', () => {
  assert.match(connect, /company_users/);
  assert.match(connect, /\['admin', 'gestor'\]/);
  assert.match(connect, /AUTH_REQUIRED|FORBIDDEN/);
});

test('AI remains disabled and WhatsApp actions stay feature-flagged', () => {
  assert.doesNotMatch(page, /VITE_AI_ENABLED/);
  assert.match(page, /VITE_WHATSAPP_ENABLED/);
  assert.match(page, /assistantMode|company_has_feature/);
});
