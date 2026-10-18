import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/Commerce.jsx', import.meta.url), 'utf8');
const architecture = fs.readFileSync(new URL('../docs/F7_COMMERCE_FOUNDATION.md', import.meta.url), 'utf8');
const meliConnector = fs.readFileSync(new URL('../src/components/commerce/MercadoLivreConnector.jsx', import.meta.url), 'utf8');
const meliService = fs.readFileSync(new URL('../src/services/mercadoLivreService.js', import.meta.url), 'utf8');
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
const membershipGateSource = fs.readFileSync(new URL('../src/lib/companyMembershipGate.js', import.meta.url), 'utf8')
  .replace(/\bexport\s+(?=function\s)/g, '');
const membershipGateContext = {};
vm.runInNewContext(`${membershipGateSource}\nthis.membershipGateExports = { companyMembershipGateState };`, membershipGateContext);
const { companyMembershipGateState } = membershipGateContext.membershipGateExports;

test('F7 Commerce is an authenticated central using the existing sales-channel permission', () => {
  assert.match(app, /path="\/f7-commerce" element=\{<RoleGuard permission="sales_channels\.view"><Commerce \/><\/RoleGuard>\}/);
  assert.match(sidebar, /to: '\/f7-commerce', label: 'F7 Commerce'.*permission: 'sales_channels\.view'/);
});

test('commerce overview points to existing modules and connects Mercado Livre through its real backend service', () => {
  for (const { links } of COMMERCE_WORKSPACES) {
    for (const { to, permission } of links) {
      assert.match(app, new RegExp(`path="${to}" element=\\{<RoleGuard permission="${permission.replaceAll('.', '\\.')}"`), `route ${to} must retain its individual guard`);
    }
  }
  assert.match(page, /Não conectado/);
  assert.match(page, /MercadoLivreConnector/);
  assert.match(meliConnector, /mercadoLivreAction\(companyId, 'status'\)/);
  assert.match(meliService, /invokeEdgeFunction\('mercadolivre-api'/);
  assert.doesNotMatch(meliConnector, /mock|fixture|simulat/i);
  assert.match(page, /useCompanyMembership\(company\?\.id\)/);
  assert.doesNotMatch(page, /from\('company_users'\)/);
});

test('membership state keeps pending, stale tenant, query errors, and inactive links distinct', () => {
  assert.equal(companyMembershipGateState({ loading: true }, 'company-a'), 'loading');
  assert.equal(companyMembershipGateState({ loading: false, companyId: 'company-b', active: true, role: 'admin' }, 'company-a'), 'loading');
  assert.equal(companyMembershipGateState({ loading: false, companyId: 'company-a', error: new Error('query failed') }, 'company-a'), 'error');
  assert.equal(companyMembershipGateState({ loading: false, companyId: 'company-a', active: false, role: '' }, 'company-a'), 'inactive');
  assert.equal(companyMembershipGateState({ loading: false, companyId: 'company-a', active: true, role: 'admin' }, 'company-a'), 'active');
});

test('authorized roles remain distinct from roles without marketplace view permission', () => {
  const { can } = permissionContext.permissionExports;
  assert.equal(can({ role: 'admin' }, 'sales_channels.view'), true);
  assert.equal(can({ role: 'vendedor' }, 'sales_channels.view'), true);
  assert.equal(can({ role: 'atendimento' }, 'sales_channels.view'), false);
  assert.match(meliConnector, /can\(\{ role: memberRole \}, 'sales_channels\.view'\)/);
  assert.match(app, /membershipState === 'active' && can\(\{ role: membership\.role \}, permission\)/);
});

test('Commerce waits for the active company membership before mounting the marketplace connector', () => {
  assert.match(page, /membershipState === 'loading'[\s\S]*Verificando vínculo e permissões/);
  assert.match(page, /membershipState === 'error'[\s\S]*Nenhuma integração foi consultada/);
  assert.match(page, /membership\.refresh/);
  assert.match(page, /membershipState === 'active'[\s\S]*<MercadoLivreConnector memberRole=\{currentMemberRole\}/);
  assert.match(app, /companyMembershipGateState\(membership, company\?\.id\)/);
  assert.match(app, /membershipState === 'error'[\s\S]*Nenhum acesso foi liberado/);
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
  assert.match(architecture, /MERCADOLIVRE-CONNECTOR\.md/);
  assert.doesNotMatch(meliConnector, /access_token|refresh_token|client_secret/i);
});
