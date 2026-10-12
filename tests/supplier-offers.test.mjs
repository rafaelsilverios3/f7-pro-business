import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareSupplierOffers, getSupplierOfferDisplayStatus, prepareSupplierOfferInput } from '../src/lib/supplierOffers.js';

const migration = await readFile(new URL('../supabase/migrations/20261012150226_supplier_offers_foundation.sql', import.meta.url), 'utf8');
const sqlTests = await readFile(new URL('../supabase/tests/supplier_offers_foundation.sql', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/services/supplierOffersService.js', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/compras/SupplierOffersPanel.jsx', import.meta.url), 'utf8');
const purchasesPage = await readFile(new URL('../src/pages/Compras.jsx', import.meta.url), 'utf8');
const permissions = await readFile(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');

const validForm = {
  supplier_id: 'supplier-a', product_id: 'product-a', unit_cost: '12.3456', currency: 'brl',
  supplier_quantity: '18', minimum_order_quantity: '2', lead_time_days: '5', source_type: 'manual',
  source_url: 'https://supplier.example/offer/1', source_note: 'Cotação recebida por e-mail',
  observed_at: '2026-10-12', valid_until: '2026-11-12',
};

test('normaliza e valida os campos da oferta sem confundir quantidade externa com estoque', () => {
  const result = prepareSupplierOfferInput(validForm);
  assert.equal(result.unit_cost, 12.3456);
  assert.equal(result.currency, 'BRL');
  assert.equal(result.supplier_quantity, 18);
  assert.equal(result.minimum_order_quantity, 2);
  assert.equal(result.lead_time_days, 5);
  assert.equal(result.source_type, 'manual');
  assert.equal(result.valid_until, '2026-11-12');
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, supplier_quantity: '-1' }), /Quantidade informada pelo fornecedor/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, minimum_order_quantity: '0' }), /pedido mínimo/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, lead_time_days: '2.5' }), /inteiro/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, currency: 'REAL' }), /três letras/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, source_url: 'http://unsafe.example' }), /HTTPS/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, source_url: 'https://user:secret@supplier.example/offer' }), /sem credenciais/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, source_url: 'https://supplier.example/offer?token=secret' }), /sem credenciais/);
  assert.throws(() => prepareSupplierOfferInput({ ...validForm, observed_at: '2026-11-13', valid_until: '2026-11-12' }), /anteceder/);
});

test('expiração de oferta é derivada da validade e não altera dados de estoque', () => {
  assert.equal(getSupplierOfferDisplayStatus({ status: 'approved', valid_until: '2026-10-11' }, '2026-10-12'), 'expired');
  assert.equal(getSupplierOfferDisplayStatus({ status: 'verified', valid_until: '2026-10-12' }, '2026-10-12'), 'verified');
  assert.equal(getSupplierOfferDisplayStatus({ status: 'suspended', valid_until: null }, '2026-10-12'), 'suspended');
});

test('comparação separa moedas e não escolhe oferta vencedora', () => {
  const groups = compareSupplierOffers([
    { id: '1', product_id: 'p1', currency: 'BRL', unit_cost: 10 },
    { id: '2', product_id: 'p1', currency: 'BRL', unit_cost: 8 },
    { id: '3', product_id: 'p1', currency: 'USD', unit_cost: 2 },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.currency).sort(), ['BRL', 'USD']);
  assert.ok(groups.every((group) => !Object.hasOwn(group, 'winner')));
});

test('migration protege tenant, integridade referencial, estados e trilha de auditoria', () => {
  assert.match(migration, /create table public\.supplier_offers/i);
  assert.match(migration, /foreign key \(company_id, supplier_id\)[\s\S]*?references public\.suppliers\(company_id, id\)/i);
  assert.match(migration, /foreign key \(company_id, product_id\)[\s\S]*?references public\.products\(company_id, id\)/i);
  assert.match(migration, /references public\.suppliers\(company_id, id\) on delete restrict/i);
  assert.match(migration, /references public\.products\(company_id, id\) on delete restrict/i);
  assert.match(migration, /alter table public\.supplier_offers enable row level security/i);
  assert.match(migration, /create policy supplier_offers_tenant_read[\s\S]*?current_company_role\(company_id\) in \('admin', 'gestor', 'estoque'\)/i);
  assert.match(migration, /revoke all on table public\.supplier_offers from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select on table public\.supplier_offers to authenticated/i);
  assert.match(migration, /approved[\s\S]*?valid_until is not null and previous\.valid_until >= current_date/i);
  assert.match(migration, /p_next_status = 'expired'[\s\S]*?previous\.valid_until < current_date/i);
  assert.match(migration, /insert into public\.audit_logs[\s\S]*?supplier_offer\.created/i);
  assert.match(migration, /insert into public\.audit_logs[\s\S]*?supplier_offer\.updated/i);
  assert.match(migration, /insert into public\.audit_logs[\s\S]*?supplier_offer\.status_changed/i);
  assert.match(migration, /revoke all on function public\.create_supplier_offer[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.create_supplier_offer[\s\S]*?to authenticated/i);
  assert.match(migration, /set search_path = pg_catalog, public, pg_temp/i);
  assert.match(migration, /actor_role is null or actor_role not in \('admin', 'gestor', 'estoque'\)/i);
  assert.match(migration, /Conceptual rollback/i);
  assert.match(sqlTests, /Company A cannot read Company B offers/);
  assert.match(sqlTests, /A cannot create an offer in company B/);
  assert.match(sqlTests, /Seller role cannot create offers/);
  assert.match(sqlTests, /Authenticated TRUNCATE is unavailable/);
  assert.match(sqlTests, /Authenticated trigger management is unavailable/);
});

test('camada de serviço grava exclusivamente pelas RPCs autorizadas', () => {
  assert.match(service, /rpc\('create_supplier_offer'/);
  assert.match(service, /rpc\('update_supplier_offer'/);
  assert.match(service, /rpc\('transition_supplier_offer'/);
  assert.match(service, /\.eq\('company_id', companyId\)/);
  assert.doesNotMatch(service, /from\('supplier_offers'\)\s*\.(?:insert|update|delete)/);
  assert.match(service, /VITE_DATA_PROVIDER !== 'supabase'/);
});

test('ofertas são integradas em Compras e usam as permissões já existentes', () => {
  assert.match(purchasesPage, /\['offers', 'Ofertas'\]/);
  assert.match(purchasesPage, /<SupplierOffersPanel company=\{company\} canManage=\{canManage\}/);
  assert.match(purchasesPage, /const canManage = can\('purchases\.manage'\)/);
  assert.match(permissions, /gestor: \[[^\]]*'purchases\.\*'/);
  assert.match(permissions, /estoque: \[[^\]]*'purchases\.\*'/);
  assert.match(panel, /A quantidade exibida é declarada pelo fornecedor e não altera o estoque próprio/);
  assert.match(panel, /Aprovar uso comercial/);
  assert.match(panel, /O menor custo não é tratado como melhor opção/);
});
