import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const onboarding = fs.readFileSync('src/pages/Onboarding.jsx', 'utf8');
const login = fs.readFileSync('src/pages/Login.jsx', 'utf8');
const register = fs.readFileSync('src/pages/Register.jsx', 'utf8');
const auth = fs.readFileSync('src/auth/providers/supabaseAuthProvider.js', 'utf8');
const company = fs.readFileSync('src/contexts/CompanyContext.jsx', 'utf8');

test('new authenticated users can render onboarding without an Outlet context', () => {
  assert.match(onboarding, /const \{ company, createCompany \} = useCompany\(\)/);
  assert.doesNotMatch(onboarding, /useOutletContext/);
  assert.match(company, /create_company_with_owner/);
  assert.match(company, /await load\(\)/);
  assert.match(company, /if \(!authChecked\) return/);
  assert.match(company, /isAuthenticated/);
});

test('onboarding retries are idempotent at the database boundary', () => {
  const migration = fs.readFileSync('supabase/migrations/0048_resilient_onboarding.sql', 'utf8');
  assert.match(migration, /create or replace function public\.create_company_with_owner/);
  assert.match(migration, /member\.user_id = auth\.uid\(\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(auth\.uid\(\)::text, 0\)\)/);
  assert.ok(migration.indexOf('pg_advisory_xact_lock') < migration.indexOf('select c.* into created'));
  assert.match(migration, /if found then/);
  assert.match(migration, /grant execute .* authenticated/);
  assert.doesNotMatch(migration, /grant all/i);
});

test('email and Google auth use the Supabase provider without frontend secrets', () => {
  assert.match(login, /Continue with Google/);
  assert.match(register, /Continue with Google/);
  assert.match(auth, /signInWithOAuth/);
  assert.match(auth, /provider, options: \{ redirectTo \}/);
  assert.doesNotMatch(login + register + auth, /GOOGLE_CLIENT_SECRET|service_role|VITE_.*SECRET/i);
});
