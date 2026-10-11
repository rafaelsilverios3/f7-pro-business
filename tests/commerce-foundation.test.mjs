import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/Commerce.jsx', import.meta.url), 'utf8');
const architecture = fs.readFileSync(new URL('../docs/F7_COMMERCE_FOUNDATION.md', import.meta.url), 'utf8');
const stylesheet = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const permissionsSource = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8')
  .replace(/^import .*;?\s*$/gm, '')
  .replace(/\bexport\s+(?=(?:const|function)\s)/g, '');
const permissionContext = {};
vm.runInNewContext(`${permissionsSource}\nthis.permissionExports = { can, ROLE_PERMISSIONS };`, permissionContext);
const navigationSource = fs.readFileSync(new URL('../src/lib/commerceNavigation.js', import.meta.url), 'utf8')
  .replace(/^import .*;?\s*$/gm, '')
  .replace(/\bexport\s+(?=(?:const|function)\s)/g, '');
const navigationContext = { can: permissionContext.permissionExports.can };
vm.runInNewContext(`${navigationSource}\nthis.navigationExports = { COMMERCE_WORKSPACES, getVisibleCommerceWorkspaces };`, navigationContext);
const { COMMERCE_WORKSPACES, getVisibleCommerceWorkspaces } = navigationContext.navigationExports;

test('F7 Commerce is an authenticated central using the existing sales-channel permission', () => {
  assert.match(app, /path="\/f7-commerce" element=\{<RoleGuard permission="sales_channels\.view"><Commerce \/><\/RoleGuard>\}/);
  assert.match(sidebar, /to: '\/f7-commerce', label: 'F7 Commerce'.*permission: 'sales_channels\.view'/);
});

test('commerce overview points to existing commercial modules and does not simulate integrations', () => {
  for (const { links } of COMMERCE_WORKSPACES) {
    for (const { to, permission } of links) {
      assert.match(app, new RegExp(`path="${to}" element=\\{<RoleGuard permission="${permission.replaceAll('.', '\\.')}"`), `route ${to} must retain its individual guard`);
    }
  }
  assert.match(page, /Não conectado/);
  assert.match(page, /ainda não estão implementados/);
  assert.doesNotMatch(page, /fetch\s*\(|functions\.invoke|localStorage/);
  assert.match(page, /from\('company_users'\)/);
});

test('commerce links are filtered using the same permissions as their guarded destination routes', () => {
  const seller = { role: 'vendedor' };
  const visibleSellerLinks = getVisibleCommerceWorkspaces(seller.role).flatMap(({ links }) => links);
  assert.ok(visibleSellerLinks.length > 0);
  assert.ok(visibleSellerLinks.every(({ permission }) => permissionContext.permissionExports.can(seller, permission)));
  assert.ok(!visibleSellerLinks.some(({ to }) => ['/compras', '/supplier-intelligence', '/estoque', '/precificacao', '/market-intelligence'].includes(to)));
  const commercial = getVisibleCommerceWorkspaces('comercial').flatMap(({ links }) => links);
  assert.ok(commercial.every(({ permission }) => permissionContext.permissionExports.can({ role: 'comercial' }, permission)));
  assert.ok(!commercial.some(({ to }) => ['/compras', '/estoque'].includes(to)));
  assert.match(app, /path="\/f7-commerce" element=\{<RoleGuard permission="sales_channels\.view"><Commerce \/><\/RoleGuard>\}/);
});

test('commerce marketplace and muted labels have explicit light and dark theme styles', () => {
  assert.match(page, /data-commerce/);
  assert.match(page, /commerce-marketplace-section/);
  assert.match(stylesheet, /\.app-shell \[data-commerce\] \.commerce-marketplace-section/);
  assert.match(stylesheet, /body\.light-theme \.app-shell \[data-commerce\] \.commerce-marketplace-section/);
  assert.match(stylesheet, /\.commerce-status/);
  assert.match(stylesheet, /\.commerce-muted-icon/);
});

test('future marketplace credentials are explicitly excluded from frontend metadata', () => {
  assert.match(architecture, /Não gravar access tokens, refresh tokens, client secrets ou chaves em `VITE_\*`, no navegador, em logs ou em `SalesChannel\.metadata`/);
  assert.match(architecture, /não (?:estão )?implementados nesta etapa/);
});
