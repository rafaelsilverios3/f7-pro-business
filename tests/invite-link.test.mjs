import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/invite-user/index.ts', 'utf8');
const core = fs.readFileSync('supabase/functions/_shared/core.ts', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const invite = fs.readFileSync('src/pages/Invite.jsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0055_invite_link_hardening.sql', 'utf8');

test('invite links require explicit matching HTTPS app origins and use the acceptance route', () => {
  assert.doesNotMatch(edge, /supabase\.co.*\/invite/);
  assert.match(edge, /Deno\.env\.get\('APP_URL'\)/);
  assert.match(edge, /Deno\.env\.get\('APP_ORIGIN'\)/);
  assert.match(edge, /url\.origin !== origin\.origin/);
  assert.match(edge, /APP_ORIGIN_NOT_CONFIGURED/);
  assert.doesNotMatch(edge, /https:\/\/f7business\.com\.br/);
  assert.ok(edge.indexOf('APP_ORIGIN_NOT_CONFIGURED') < edge.indexOf("rpc('create_company_invite'"), 'misconfiguration is rejected before creating the invite');
  assert.match(edge, /\/aceitar-convite\?token=/);
  assert.match(app, /path="\/aceitar-convite"/);
});

test('Edge Function CORS fails closed without APP_ORIGIN and rejects non-HTTPS remote origins', () => {
  assert.match(core, /if \(!configured\) return 'null'/);
  assert.match(core, /origin\.protocol !== 'https:' && !loopbackHttp/);
  assert.match(core, /origin\.pathname !== '\/'/);
  assert.match(core, /Access-Control-Allow-Origin":configuredCorsOrigin\(\)/);
  assert.doesNotMatch(core, /Deno\.env\.get\('APP_ORIGIN'\)\s*\|\|\s*['"]\*['"]/);
});

test('invite acceptance keeps token server-side as a hash and preserves login return', () => {
  assert.match(invite, /SHA-256/);
  assert.match(invite, /accept_company_invite/);
  assert.match(invite, /navigateToLogin/);
  assert.doesNotMatch(invite, /role=.*searchParams/);
});

test('preview and acceptance are idempotent, email-bound and role comes from persisted invite', () => {
  assert.match(migration, /get_company_invite_preview/);
  assert.match(migration, /auth\.users/);
  assert.match(migration, /Este convite pertence a outro e-mail/);
  assert.match(migration, /Convite já utilizado/);
  assert.match(migration, /on conflict \(company_id,user_id\)/);
  assert.match(migration, /grant execute on function public\.get_company_invite_preview\(text\) to anon, authenticated/);
  assert.doesNotMatch(migration, /disable row level security/i);
});
