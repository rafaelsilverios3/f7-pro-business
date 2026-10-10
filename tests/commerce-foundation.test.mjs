import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/Commerce.jsx', import.meta.url), 'utf8');
const architecture = fs.readFileSync(new URL('../docs/F7_COMMERCE_FOUNDATION.md', import.meta.url), 'utf8');

test('F7 Commerce is an authenticated central using the existing sales-channel permission', () => {
  assert.match(app, /path="\/f7-commerce" element=\{<RoleGuard permission="sales_channels\.view"><Commerce \/><\/RoleGuard>\}/);
  assert.match(sidebar, /to: '\/f7-commerce', label: 'F7 Commerce'.*permission: 'sales_channels\.view'/);
});

test('commerce overview points to existing commercial modules and does not simulate integrations', () => {
  for (const route of ['/sales-hub', '/compras', '/supplier-intelligence', '/produtos', '/estoque', '/precificacao', '/vendas', '/orcamentos', '/opportunities', '/market-intelligence', '/opportunity-radar']) {
    assert.ok(page.includes(`to: '${route}'`) || page.includes(`to="${route}"`), `expected a link to existing route ${route}`);
  }
  assert.match(page, /Não conectado/);
  assert.match(page, /ainda não estão implementados/);
  assert.doesNotMatch(page, /fetch\s*\(|functions\.invoke|supabaseProvider|localStorage/);
});

test('future marketplace credentials are explicitly excluded from frontend metadata', () => {
  assert.match(architecture, /Não gravar access tokens, refresh tokens, client secrets ou chaves em `VITE_\*`, no navegador, em logs ou em `SalesChannel\.metadata`/);
  assert.match(architecture, /não (?:estão )?implementados nesta etapa/);
});
