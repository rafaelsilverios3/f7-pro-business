import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzePurchaseNeeds } from '../src/lib/purchaseIntelligence.js';
const purchaseService = fs.readFileSync('src/services/purchasesService.js', 'utf8');

const companyId = 'company-a';
const product = (id, stock, minimum_stock = 0, name = id, company_id = companyId) => ({ id, company_id, name, stock, minimum_stock, item_type: 'product' });
const sale = (id, product_id, quantity, status = 'completed', company_id = companyId, sale_date = '2026-09-10') => ({ id, company_id, status, sale_date, items: [{ product_id, qty: quantity, price: 10, total: quantity * 10 }] });
const purchase = (id, status, supplier_id, company_id = companyId) => ({ id, company_id, status, supplier_id, created_at: '2026-09-09', total: 100 });
const item = (purchase_id, product_id, quantity, cost = 5, company_id = companyId) => ({ purchase_id, product_id, quantity, cost, company_id });

test('estoque zero com demanda recebe prioridade alta e quantidade mínima factual', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 0, 10)], sales: [sale('s1', 'p1', 3)], now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(result.rows[0].priority, 'Alta');
  assert.equal(result.rows[0].suggested_quantity, 10);
  assert.match(result.rows[0].reason, /Foram vendidas 3/);
});

test('abaixo do mínimo sem demanda permanece alerta contextual e não recompra cega', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 3, 10)], now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(result.rows[0].priority, 'Baixa');
  assert.equal(result.rows[0].suggested_quantity, null);
  assert.match(result.rows[0].reason, /sem vendas recentes/);
});

test('mínimo ausente não inventa valor ou quantidade', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 0, 0)], sales: [sale('s1', 'p1', 2)] });
  assert.equal(result.rows[0].minimum_stock, null);
  assert.equal(result.rows[0].suggested_quantity, null);
});

test('compra aberta é descontada da quantidade mínima sugerida', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 2, 10)], sales: [sale('s1', 'p1', 2)], purchases: [purchase('po1', 'pending', 'sup1')], purchaseItems: [item('po1', 'p1', 8)] });
  assert.equal(result.rows[0].open_purchase_quantity, 8);
  assert.equal(result.rows[0].projected_stock, 10);
  assert.equal(result.rows[0].suggested_quantity, 0);
});

test('último custo usa somente compra recebida, nunca pedido pendente ou cancelado', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 0, 10)], sales: [sale('s1', 'p1', 1)], purchases: [purchase('cancelled', 'cancelled', 'sup1'), purchase('pending', 'pending', 'sup1'), purchase('received', 'received', 'sup1')], purchaseItems: [item('cancelled', 'p1', 4, 1), item('pending', 'p1', 4, 2), item('received', 'p1', 4, 3)], suppliers: [{ id: 'sup1', company_id: companyId, name: 'Fornecedor' }] });
  assert.equal(result.rows[0].last_purchase.cost, 3);
});

test('recebimento parcial sem saldo persistido não é contado cegamente', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 2, 10)], purchases: [purchase('po1', 'partial', 'sup1')], purchaseItems: [item('po1', 'p1', 8)] });
  assert.equal(result.partial_receipt_supported, false);
  assert.equal(result.rows[0].partial_receipt_unknown, true);
  assert.equal(result.rows[0].projected_stock, null);
  assert.equal(result.rows[0].suggested_quantity, null);
});

test('vendas canceladas e registros de outro tenant não viram demanda ou fornecedor', () => {
  const result = analyzePurchaseNeeds({ companyId, products: [product('p1', 0, 10), product('other', 0, 10, 'Outro', 'company-b')], sales: [sale('cancelled', 'p1', 9, 'cancelled'), sale('foreign', 'other', 9, 'completed', 'company-b')], suppliers: [{ id: 'sup1', company_id: 'company-b', name: 'Fora' }] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].demand_quantity, 0);
  assert.equal(result.rows[0].suppliers.length, 0);
});

test('página de compras mantém ação humana, handoff e filtros sem arquitetura paralela', () => {
  const page = fs.readFileSync('src/pages/Compras.jsx', 'utf8');
  assert.match(page, /Reposição inteligente/);
  assert.match(page, /Preparar compra/);
  assert.match(page, /supplier-intelligence/);
  assert.match(page, /source_module: 'purchases'/);
  assert.match(page, /intelligence/);
  assert.match(page, /purchases\.manage/);
  assert.match(page, /useCompanyMembership/);
  assert.match(page, /company_users|membership\.active/);
  assert.doesNotMatch(page, /\['pending', 'partial', 'approved', 'sent'\]/);
  assert.match(page, /Não é criada automaticamente|Nenhuma compra é criada automaticamente/);
  assert.doesNotMatch(page, /compras-v2|procurement-v2|reposicao-v2/);
});

test('consulta itens de compra usa coluna existente do schema e não presume created_at', () => {
  assert.match(purchaseService, /purchaseItemsRepository\.list\(companyId, 'purchase_id', 2000\)/);
  assert.doesNotMatch(purchaseService, /purchaseItemsRepository\.list\(companyId, '-created_date'/);
});
