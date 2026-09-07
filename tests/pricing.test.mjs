import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRealCost, calculateMargin, calculateMarkup, calculateMinimumPrice, priceForMargin, psychologicalPrice, buildPricingSummary } from '../src/lib/pricing.js';

const input = { purchaseCost: 100, freight: 8, packaging: 3, otherCosts: 4, taxPct: 5, financialFeePct: 2, commissionPct: 3, channelFeePct: 0 };

test('calculates real cost from fixed components', () => assert.equal(calculateRealCost(input), 115));
test('separates markup from margin', () => { const price = 200; assert.equal(Number(calculateMarkup(price, 100).toFixed(2)), 100); assert.equal(Number(calculateMargin(price, 100, 10).toFixed(2)), 40); });
test('calculates price needed for target margin with variable fees', () => { const price = priceForMargin(30, input); assert.ok(price > 0); assert.ok(calculateMargin(price, calculateRealCost(input), 10) >= 29.9); });
test('minimum price does not produce a loss after variable costs', () => { const minimum = calculateMinimumPrice(input); assert.ok(calculateMargin(minimum, calculateRealCost(input), 10) >= -0.01); });
test('psychological rounding never falls below minimum', () => { const rounded = psychologicalPrice(103.27, 103.5); assert.ok(rounded >= 103.5); assert.equal(Math.round(rounded * 10) % 10, 9); });
test('impossible margin never becomes a zero price', () => { assert.equal(priceForMargin(50, { purchaseCost: 100, taxPct: 60, financialFeePct: 40 }), null); assert.equal(calculateMinimumPrice({ purchaseCost: 100, taxPct: 100 }), null); assert.equal(buildPricingSummary({ purchaseCost: 100, taxPct: 100 }).feasible, false); });
