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

test('runner uses existing Supabase session and contains read-only API calls', () => {
  assert.match(runner, /supabase\.auth\.getUser\(\)/);
  assert.match(runner, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(runner, /company_has_feature/);
  assert.doesNotMatch(runner, /\.\s*(insert|update|delete|upsert)\s*\(/i);
  assert.doesNotMatch(runner, /service_role|signInWithPassword|password\s*:/i);
});
