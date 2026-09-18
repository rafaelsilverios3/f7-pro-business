import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingProgress, isNewCompany, isOperationalCompany, ONBOARDING_STEPS, visibleOnboardingSteps } from '../src/services/onboardingService.js';

const company = { id: 'tenant-a', onboarding_completed: false };

test('onboarding defines independent commerce, services and production journeys', () => {
  assert.ok(ONBOARDING_STEPS.commerce.some((step) => step.id === 'inventory'));
  assert.ok(!ONBOARDING_STEPS.services.some((step) => step.id === 'inventory'));
  assert.ok(ONBOARDING_STEPS.production.some((step) => step.id === 'raw_material'));
  const result = buildOnboardingProgress(ONBOARDING_STEPS.production.filter((step) => step.id === 'raw_material'), { company, products: [{ id: 'm', company_id: company.id, item_type: 'material' }] });
  assert.equal(result.completed.raw_material, true);
});

test('progress is derived from tenant evidence instead of click flags', () => {
  const steps = ONBOARDING_STEPS.commerce.filter((step) => ['customer', 'product', 'pricing', 'quote', 'sale', 'inventory'].includes(step.id));
  const result = buildOnboardingProgress(steps, { company, customers: [{ id: 'c', company_id: company.id }], products: [{ id: 'p', company_id: company.id, sale_price: 45 }], quotes: [{ id: 'q' }], sales: [{ id: 's', status: 'completed' }], movements: [] });
  assert.equal(result.completed.customer, true);
  assert.equal(result.completed.product, true);
  assert.equal(result.completed.pricing, true);
  assert.equal(result.completed.quote, true);
  assert.equal(result.completed.sale, true);
  assert.equal(result.completed.inventory, false);
});

test('cancelled sales and other tenants never complete operational steps', () => {
  const steps = ONBOARDING_STEPS.commerce.filter((step) => ['customer', 'sale'].includes(step.id));
  const result = buildOnboardingProgress(steps, { company, customers: [{ id: 'other', company_id: 'tenant-b' }], sales: [{ id: 'cancelled', status: 'cancelled' }, { id: 'other', status: 'completed', company_id: 'tenant-b' }] });
  assert.equal(result.completed.customer, false);
  assert.equal(result.completed.sale, false);
});

test('new-company detection is factual and old operational companies are not forced into onboarding', () => {
  assert.equal(isNewCompany(company, { customers: [], products: [], sales: [], quotes: [], purchases: [], movements: [] }), true);
  assert.equal(isNewCompany(company, { customers: [{ id: 'c' }], products: [], sales: [], quotes: [], purchases: [], movements: [] }), false);
  assert.equal(isOperationalCompany({ customers: [], products: [{ id: 'p' }] }), true);
});

test('permission filtering removes impossible tasks without changing journey definitions', () => {
  const visible = visibleOnboardingSteps('commerce', { canAccess: (permission) => permission !== 'inventory.view' });
  assert.equal(visible.some((step) => step.id === 'inventory'), false);
  assert.equal(ONBOARDING_STEPS.commerce.some((step) => step.id === 'inventory'), true);
});

test('plan-gated educational tasks are not presented as mandatory when unavailable', () => {
  const visible = visibleOnboardingSteps('commerce', { canAccess: () => true, featureEnabled: () => false });
  assert.equal(visible.some((step) => step.id === 'intelligence'), false);
});

test('Etapa 20 follows the audited first-use order for each operational journey', () => {
  const expected = {
    commerce: ['company', 'customer', 'product', 'pricing', 'inventory', 'quote', 'sale', 'crm', 'dashboard_reports', 'intelligence'],
    services: ['company', 'customer', 'service', 'pricing', 'quote', 'sale', 'crm', 'dashboard_reports', 'intelligence'],
    production: ['company', 'customer', 'raw_material', 'product', 'pricing', 'inventory', 'quote', 'sale', 'crm', 'dashboard_reports', 'intelligence'],
  };
  for (const [journey, ids] of Object.entries(expected)) {
    assert.deepEqual(ONBOARDING_STEPS[journey].map((step) => step.id), ids);
    assert.equal(ONBOARDING_STEPS[journey][0].route, '/configuracoes');
  }
  const progress = buildOnboardingProgress(ONBOARDING_STEPS.commerce.slice(0, 2), { company });
  assert.equal(progress.completed.company, true);
  assert.equal(progress.completed.customer, false);
});
