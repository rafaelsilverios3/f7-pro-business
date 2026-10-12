import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessSupplierOfferForPricing, buildSupplierOfferPricingScenario, classifySupplierOffersForPricing } from '../src/lib/supplierOfferPricing.js';

const companyId = 'company-a';
const productId = 'product-a';
const offer = {
  id: 'offer-a', company_id: companyId, product_id: productId, supplier_name: 'Fornecedor teste',
  unit_cost: 100, currency: 'BRL', supplier_quantity: 30, minimum_order_quantity: 5,
  lead_time_days: 7, status: 'approved', verified_at: '2026-10-01T12:00:00Z', verified_by: 'user-admin',
  approved_at: '2026-10-02T12:00:00Z', approved_by: 'user-admin', valid_until: '2026-12-31',
};
const scope = { companyId, productId, today: '2026-10-12' };

test('only same-company, same-product, verified, approved, current BRL offer is eligible', () => {
  assert.deepEqual(assessSupplierOfferForPricing(offer, scope), { eligible: true, reasons: [] });
  assert.equal(classifySupplierOffersForPricing([offer], scope)[0].eligible, true);
});

test('ineligible offers retain explicit reasons and never qualify as a pricing source', () => {
  const cases = [
    [{ ...offer, status: 'suspended' }, /não está aprovada/],
    [{ ...offer, verified_at: null, verified_by: null }, /verificação humana/],
    [{ ...offer, approved_at: null, approved_by: null }, /aprovação humana/],
    [{ ...offer, valid_until: '2026-10-11' }, /vencida/],
    [{ ...offer, valid_until: null }, /data de validade/],
    [{ ...offer, currency: 'USD' }, /sem conversão válida/],
    [{ ...offer, company_id: 'company-b' }, /empresa ativa/],
    [{ ...offer, product_id: 'product-b' }, /outro produto/],
  ];
  for (const [candidate, reason] of cases) {
    const result = assessSupplierOfferForPricing(candidate, scope);
    assert.equal(result.eligible, false);
    assert.match(result.reasons.join(' '), reason);
  }
});

test('classification drops other tenant/product rows before showing context', () => {
  const rows = classifySupplierOffersForPricing([
    offer,
    { ...offer, id: 'other-company', company_id: 'company-b' },
    { ...offer, id: 'other-product', product_id: 'product-b' },
  ], scope);
  assert.deepEqual(rows.map(({ offer: item }) => item.id), ['offer-a']);
});

test('quantity below MOQ has no margin/price result and exposes minimum commitment', () => {
  const result = buildSupplierOfferPricingScenario(offer, { ...scope, quantity: 2, costs: { freightTotal: 12 }, price: 200, targetMargin: 30 });
  assert.equal(result.feasible, false);
  assert.equal(result.summary, null);
  assert.equal(result.targetPrice, null);
  assert.equal(result.minimumOrderInvestment, 500);
  assert.equal(result.orderInvestment, null);
  assert.match(result.reasons.join(' '), /pedido mínimo/);
});

test('scenario allocates order freight per unit and reuses the existing Pricing formulas', () => {
  const result = buildSupplierOfferPricingScenario(offer, {
    ...scope,
    quantity: 10,
    costs: { freightTotal: 50, packaging: 2, otherCosts: 3, additionalCost: 4, taxPct: 10, financialFeePct: 2, commissionPct: 3 },
    confidence: { freightTotal: 'known', packaging: 'known', otherCosts: 'known', additionalCost: 'known', taxPct: 'estimated', financialFeePct: 'known', commissionPct: 'known', channelFeePct: 'known' },
    channelFeePct: 5,
    price: 200,
    targetMargin: 30,
  });
  assert.equal(result.feasible, true);
  assert.equal(result.freightPerUnit, 5);
  assert.equal(result.minimumOrderInvestment, 500);
  assert.equal(result.orderInvestment, 1050);
  assert.equal(result.summary.realCost, 114);
  assert.equal(result.summary.variableRate, 20);
  assert.equal(result.summary.margin, 23);
  assert.equal(result.targetPrice, 228);
  assert.equal(result.confidenceLabel, 'Simulação com estimativas');
});

test('missing costs are marked incomplete even though the deterministic formula treats them as zero', () => {
  const result = buildSupplierOfferPricingScenario(offer, { ...scope, quantity: 5, costs: { freightTotal: '', packaging: '' }, confidence: {}, price: 200 });
  assert.equal(result.feasible, true);
  assert.ok(result.missing.includes('freightTotal'));
  assert.ok(result.missing.includes('taxPct'));
  assert.equal(result.confidenceLabel, 'Estimativa incompleta');
});

test('scenario helper independently rejects non-eligible and non-BRL offers', () => {
  for (const candidate of [{ ...offer, status: 'suspended' }, { ...offer, currency: 'USD' }, { ...offer, company_id: 'company-b' }]) {
    const result = buildSupplierOfferPricingScenario(candidate, { ...scope, quantity: 5, costs: {}, confidence: {}, price: 100 });
    assert.equal(result.feasible, false);
    assert.equal(result.summary, null);
    assert.equal(result.targetPrice, null);
  }
});

test('known zero costs are distinguishable from missing inputs', () => {
  const result = buildSupplierOfferPricingScenario(offer, {
    ...scope,
    quantity: 5,
    costs: { freightTotal: 0, packaging: 0, otherCosts: 0, additionalCost: 0, taxPct: 0, financialFeePct: 0, commissionPct: 0, channelFeePct: 0 },
    confidence: { freightTotal: 'known', packaging: 'known', otherCosts: 'known', additionalCost: 'known', taxPct: 'known', financialFeePct: 'known', commissionPct: 'known', channelFeePct: 'known' },
    price: 200,
  });
  assert.equal(result.missing.length, 0);
  assert.equal(result.confidenceLabel, 'Simulação com valores informados');
});

test('a blank input cannot be marked known and mislabeled as a complete scenario', () => {
  const result = buildSupplierOfferPricingScenario(offer, {
    ...scope,
    quantity: 5,
    costs: { freightTotal: '', packaging: '' },
    confidence: { freightTotal: 'known', packaging: 'known' },
    price: 200,
  });
  assert.ok(result.missing.includes('freightTotal'));
  assert.ok(result.missing.includes('packaging'));
  assert.equal(result.confidenceLabel, 'Estimativa incompleta');
});

test('invalid cost inputs are rejected instead of silently becoming zero', () => {
  const result = buildSupplierOfferPricingScenario(offer, {
    ...scope,
    quantity: 5,
    costs: { freightTotal: '-12' },
    confidence: { freightTotal: 'known' },
    price: 200,
  });
  assert.equal(result.feasible, false);
  assert.equal(result.summary, null);
  assert.equal(result.targetPrice, null);
  assert.match(result.reasons.join(' '), /valor informado para freightTotal é inválido/);
});

test('supplier-offer selection stays simulation-only and does not call the catalog write path', async () => {
  const dialog = await readFile(new URL('../src/components/pricing/PricingDialog.jsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/components/pricing/SupplierOfferPricingPanel.jsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/Precificacao.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /if \(selectedOffer\) \{ setError\(/);
  assert.match(dialog, /selectedOffer \? <Button type="button" disabled>/);
  assert.match(dialog, /buildSupplierOfferPricingScenario\(selectedOffer, \{\s*companyId,\s*productId: product\?\.id/);
  assert.match(panel, /classifySupplierOffersForPricing/);
  assert.match(panel, /onSelectOffer\(selectedOfferId === offer\.id \? null : offer\)/);
  assert.match(page, /supplierOffersService\.list\(requestedCompanyId\)/);
  assert.match(page, /can\(\{ role \}, 'purchases\.view'\)/);
  assert.match(page, /referencesAreCurrent = referencesCompanyId === company\?\.id && membershipReady/);
  assert.match(page, /setReferencesCompanyId\(requestedCompanyId\);\s*setSupplierOffersError/);
});
