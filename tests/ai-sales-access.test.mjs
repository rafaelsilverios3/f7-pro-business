import assert from 'node:assert/strict';
import test from 'node:test';
import { permissionsForTool, providerConfiguration, roleHasAiSalesPermissions, sanitizeAiSalesProviderData } from '../supabase/functions/_shared/aiSalesAccess.js';
import { assessSupplierOfferForPricing, buildSupplierOfferPricingScenario } from '../src/lib/supplierOfferPricing.js';

test('permissões do servidor são por ferramenta e fail closed para papéis desconhecidos', () => {
  assert.equal(roleHasAiSalesPermissions('atendimento'), true);
  assert.equal(roleHasAiSalesPermissions('atendimento', permissionsForTool('stock')), false);
  assert.equal(roleHasAiSalesPermissions('vendedor', permissionsForTool('customer')), true);
  assert.equal(roleHasAiSalesPermissions('vendedor', permissionsForTool('supplier_offer_pricing')), false);
  assert.equal(roleHasAiSalesPermissions('gestor', permissionsForTool('supplier_offer_pricing')), true);
  assert.equal(roleHasAiSalesPermissions('unknown'), false);
});

test('configuração do provedor exige opt-in explícito e nunca equivale a teste de conectividade', () => {
  assert.deepEqual(providerConfiguration({ enabled: 'false', apiKey: 'secret', apiUrl: '' }), { configured: false, reason: 'disabled' });
  assert.deepEqual(providerConfiguration({ enabled: 'true', apiKey: '', apiUrl: '' }), { configured: false, reason: 'missing_key' });
  assert.deepEqual(providerConfiguration({ enabled: 'true', apiKey: 'secret', apiUrl: 'http://example.test' }), { configured: false, reason: 'invalid_endpoint' });
  assert.deepEqual(providerConfiguration({ enabled: 'true', apiKey: 'secret', apiUrl: '' }), { configured: true, reason: 'configured_unverified' });
});

test('contexto enviado ao provedor exclui PII, IDs comerciais e fontes privadas', () => {
  const rows = [
    { id: 'customer-1', name: 'Ana Teste', email: 'ana@example.test', phone: '+55 11 99999-0000', document: '12345678900', total_purchased: 500, sale_count: 3 },
  ];
  const providerData = sanitizeAiSalesProviderData('buscar_cliente', rows);
  const encoded = JSON.stringify(providerData);
  assert.deepEqual(providerData, { matching_customer_count: 1, aggregate_purchase_value: 500, aggregate_sale_count: 3 });
  for (const secret of ['Ana Teste', 'ana@example.test', '+55 11 99999-0000', '12345678900', 'customer-1']) assert.equal(encoded.includes(secret), false);
});

test('contexto do provedor de ofertas mantém só fatos mínimos e não inclui fornecedor, ID ou URL', () => {
  const providerData = sanitizeAiSalesProviderData('analisar_ofertas_fornecedor', {
    product_name: 'Produto QA', currency: 'BRL',
    offers: [{ id: 'offer-1', supplier_name: 'Fornecedor Pessoa Física', source_url: 'https://private.example.test', unit_cost: 42.5, minimum_order_quantity: 10, quantity: 10, margin_estimate_percent: 12, missing: ['freightPerUnit'] }],
    contextual_offers: [{ id: 'offer-2', source_url: 'https://private.example.test', status: 'draft', currency: 'USD', reasons: ['não aprovada'] }],
  });
  const encoded = JSON.stringify(providerData);
  for (const secret of ['offer-1', 'offer-2', 'Fornecedor Pessoa Física', 'private.example.test']) assert.equal(encoded.includes(secret), false);
  assert.equal(providerData.eligible_offers[0].unit_cost, 42.5);
  assert.equal(providerData.contextual_offers[0].currency, 'USD');
});

test('Supplier Offers só fornece simulação quando aprovação, verificação, validade, escopo e BRL passam', () => {
  const today = '2026-10-12';
  const offer = { company_id: 'company-a', product_id: 'product-a', status: 'approved', verified_at: today, verified_by: 'user-a', approved_at: today, approved_by: 'user-a', valid_until: '2026-10-20', currency: 'BRL', unit_cost: 42.5, minimum_order_quantity: 10 };
  assert.equal(assessSupplierOfferForPricing(offer, { companyId: 'company-a', productId: 'product-a', today }).eligible, true);
  for (const changes of [
    { company_id: 'company-b' }, { product_id: 'product-b' }, { status: 'draft' },
    { verified_by: null }, { approved_at: null }, { valid_until: '2026-10-11' }, { currency: 'USD' },
  ]) assert.equal(assessSupplierOfferForPricing({ ...offer, ...changes }, { companyId: 'company-a', productId: 'product-a', today }).eligible, false);
});

test('cenário reusa cálculos Pricing, deixa custos ausentes explícitos e não altera a oferta', () => {
  const offer = { company_id: 'company-a', product_id: 'product-a', status: 'approved', verified_at: '2026-10-12', verified_by: 'user-a', approved_at: '2026-10-12', approved_by: 'user-a', valid_until: '2026-10-20', currency: 'BRL', unit_cost: 42.5, minimum_order_quantity: 10 };
  const before = structuredClone(offer);
  const scenario = buildSupplierOfferPricingScenario(offer, { companyId: 'company-a', productId: 'product-a', today: '2026-10-12', quantity: 10, costs: {}, confidence: {}, price: 100, targetMargin: 30, channelFeePct: 0 });
  assert.equal(scenario.feasible, true);
  assert.ok(scenario.summary);
  assert.ok(scenario.missing.includes('freightPerUnit'));
  assert.ok(scenario.missing.includes('channelFeePct'));
  assert.deepEqual(offer, before);
});
