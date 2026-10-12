import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const app = await readFile(new URL('src/App.jsx', root), 'utf8');
const runner = await readFile(new URL('src/pages/HomologationRestRunner.jsx', root), 'utf8');

test('homologation REST runner is gated to the exact homolog Supabase URL', () => {
  assert.match(app, /import\.meta\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(app, /import\.meta\.env\.VERCEL_GIT_COMMIT_REF !== HOMOLOGATION_VERCEL_BRANCH/);
  assert.match(app, /codex\/harden-multi-tenant-isolation/);
  assert.match(app, /VITE_DATA_PROVIDER !== 'supabase'/);
  assert.match(app, /https:\/\/vwylnjmapixtzhryiutt\.supabase\.co/);
  assert.match(app, /location\.pathname === '\/__homologation\/rest-check'/);
  assert.match(runner, /https:\/\/vwylnjmapixtzhryiutt\.supabase\.co/);
  assert.match(runner, /import\.meta\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(runner, /import\.meta\.env\.VERCEL_GIT_COMMIT_REF !== HOMOLOGATION_VERCEL_BRANCH/);
  assert.match(runner, /new URL\(import\.meta\.env\.VITE_SUPABASE_URL\)\.origin === HOMOLOGATION_URL/);
});

test('Vite injects only the non-secret Vercel deployment scope metadata needed by the route guard', async () => {
  const vite = await readFile(new URL('vite.config.js', root), 'utf8');
  assert.match(vite, /'import\.meta\.env\.VERCEL_ENV': JSON\.stringify\(process\.env\.VERCEL_ENV \|\| ''\)/);
  assert.match(vite, /'import\.meta\.env\.VERCEL_GIT_COMMIT_REF': JSON\.stringify\(process\.env\.VERCEL_GIT_COMMIT_REF \|\| ''\)/);
  assert.doesNotMatch(vite, /import\.meta\.env\.(?:VITE_)?(?:SERVICE_ROLE|SECRET|TOKEN)/i);
});

test('runner accepts only the three homolog identities and expected tenant roles', () => {
  assert.match(runner, /f7group7@gmail\.com/);
  assert.match(runner, /rafaelsilverio\.s3@gmail\.com/);
  assert.match(runner, /f7group7\+vendedor@gmail\.com/);
  assert.match(runner, /company_users/);
  assert.match(runner, /memberships\[0\]\.role === expected\.role/);
});

test('runner uses existing Supabase session for read-only checks and never handles credentials', () => {
  assert.match(runner, /supabase\.auth\.getUser\(\)/);
  assert.match(runner, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(runner, /company_has_feature/);
  assert.doesNotMatch(runner, /service_role|signInWithPassword|password\s*:/i);
  assert.match(runner, /function validateOperationSession/);
  assert.match(runner, /memberships\[0\]\.company_id !== ownCompany\.id/);
});

test('writes are opt-in, constrained to uniquely marked customer fixtures, and revalidate real tenant membership', () => {
  assert.match(runner, /F7_HOMOLOG_REST_/);
  assert.match(runner, /Create fixture fictícia própria|Criar fixture fictícia própria/);
  assert.match(runner, /validateOperationSession\(supabase, \['admin'\]\)/);
  assert.match(runner, /company_id: guard\.ownCompany\.id, name: marker/);
  assert.match(runner, /cross-tenant fixture read/);
  assert.match(runner, /\.insert\(\{ company_id: other\.id, name: attackMarker \}\)/);
  assert.match(runner, /\.eq\('id', id\)\.eq\('company_id', other\.id\)\.eq\('name', marker\)/);
  assert.match(runner, /if \(stop\) return;/);
  assert.match(runner, /\.delete\(\)\s*\.eq\('id', id\)\.eq\('company_id', other\.id\)\.eq\('name', marker\)/);
});

test('seller administrative checks exercise REST grants and admin-only RPC authorization without sending invitations', () => {
  assert.match(runner, /runSellerAdministrativeChecks/);
  assert.match(runner, /update\(\{ role: 'admin' \}\)/);
  assert.match(runner, /update_company_member_role/);
  assert.match(runner, /somente administradores podem alterar papéis/i);
  assert.match(runner, /create_company_invite/);
  assert.match(runner, /example\.invalid/);
  assert.doesNotMatch(runner, /fetch\([^)]*(?:invite|email|whatsapp)/i);
});

test('cancel idempotency checks identify one exact cancelled homolog fixture and compare ledgers around both RPC calls', () => {
  assert.match(runner, /Produto fictício F7 A - teste de rascunho 0087/);
  assert.match(runner, /eq\('items->0->>name', productMarker\)/);
  assert.match(runner, /sales\.length !== 1/);
  assert.match(runner, /stock_movements/);
  assert.match(runner, /financial_entries/);
  assert.match(runner, /commissions/);
  assert.match(runner, /supabase\.rpc\('cancel_sale', \{ target_sale: sale\.id \}\)/);
  assert.match(runner, /JSON\.stringify\(after\) === JSON\.stringify\(before\)/);
  assert.match(runner, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
});
