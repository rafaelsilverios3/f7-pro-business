import test from 'node:test';
import assert from 'node:assert/strict';
import { priceForBillingPeriod } from '../src/services/billingPricing.js';

test('billing price derives monthly and annual totals from the backend catalog amount', () => {
  const plan = { price_minor: 6990, billing_period: 'month' };
  assert.equal(priceForBillingPeriod(plan, 'month'), 6990);
  assert.equal(priceForBillingPeriod(plan, 'year'), 83880);
});

test('billing price never invents a monthly price from a yearly-only catalog entry', () => {
  const plan = { price_minor: 79900, billing_period: 'year' };
  assert.equal(priceForBillingPeriod(plan, 'year'), 79900);
  assert.equal(priceForBillingPeriod(plan, 'month'), null);
});

test('billing price fails closed for invalid values and overflow', () => {
  assert.equal(priceForBillingPeriod({ price_minor: null, billing_period: 'month' }, 'month'), null);
  assert.equal(priceForBillingPeriod({ price_minor: 0, billing_period: 'month' }, 'year'), null);
  assert.equal(priceForBillingPeriod({ price_minor: Number.MAX_SAFE_INTEGER, billing_period: 'month' }, 'year'), null);
  assert.equal(priceForBillingPeriod({ price_minor: 100, billing_period: 'month' }, 'week'), null);
});
