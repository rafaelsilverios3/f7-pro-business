import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivePlanCatalog } from '../src/services/billingPlanCatalog.js';

const plan = (overrides = {}) => ({
  id: 'plan-pro', code: 'pro', name: 'Pro', price_minor: '6990', currency: 'BRL',
  billing_period: 'month', active: true, ...overrides,
});

test('catalog uses exact database price/currency and attaches features by plan id', () => {
  const result = buildActivePlanCatalog([plan()], [{ plan_id: 'plan-pro', feature: 'pricing', enabled: true, usage_limit: null }]);
  assert.equal(result[0].price_minor, 6990);
  assert.equal(result[0].currency, 'BRL');
  assert.deepEqual(result[0].features, [{ feature: 'pricing', enabled: true, usage_limit: null }]);
});

test('catalog accepts an explicit unconfigured price without inventing a value', () => {
  const [result] = buildActivePlanCatalog([plan({ price_minor: null })]);
  assert.equal(result.price_minor, null);
});

test('catalog fails closed for missing, duplicate, malformed or unsafe prices', () => {
  for (const plans of [
    [],
    [plan(), plan()],
    [plan({ price_minor: '-1' })],
    [plan({ price_minor: 'not-a-price' })],
    [plan({ price_minor: Number.MAX_SAFE_INTEGER + 1 })],
    [plan({ currency: 'REAL' })],
    [plan({ billing_period: 'week' })],
  ]) assert.throws(() => buildActivePlanCatalog(plans), { message: 'PLAN_CATALOG_UNAVAILABLE' });
});

test('catalog never accepts a feature response with the wrong shape', () => {
  assert.throws(() => buildActivePlanCatalog([plan()], null), { message: 'PLAN_CATALOG_UNAVAILABLE' });
});
