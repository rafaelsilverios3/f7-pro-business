import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const layout = fs.readFileSync('src/components/layout/Layout.jsx', 'utf8');
const profileDialog = fs.readFileSync('src/components/layout/ProfileDialog.jsx', 'utf8');

test('Supabase header role comes from the active company membership', () => {
  assert.match(layout, /useCompanyMembership\(company\?\.id\)/);
  assert.match(layout, /import\.meta\.env\.VITE_DATA_PROVIDER === 'supabase'[\s\S]*?membership\.role/);
  assert.match(layout, /membership\.active \? membership\.role : ''/);
  assert.match(layout, /roleLabels\[roleKey\]/);
  assert.doesNotMatch(layout, /: 'Administrador'\s*;/);
});

test('global search fails closed until the active tenant role is resolved', () => {
  assert.match(layout, /const role = import\.meta\.env\.VITE_DATA_PROVIDER === 'supabase'[\s\S]*?membership\.active \? membership\.role : ''/);
  assert.doesNotMatch(layout, /user\?\.user_metadata\?\.role[\s\S]*?\|\| 'admin'/);
});

test('Supabase profile never labels a generic authenticated session as administrator', () => {
  assert.match(layout, /role=\{roleKey\}/);
  assert.match(profileDialog, /roleLabels\[role\].*'Função indisponível'/);
  assert.doesNotMatch(profileDialog, /roleLabels\[role\] \|\| role \|\| 'Administrador'/);
});
