import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommission, calculateInstallments, calculateSaleTotals, roundMoney } from '../src/lib/calculations.js';

test('rounds monetary values to two decimal places', () => {
  assert.equal(roundMoney(10.005), 10.01);
});

test('calculates sale subtotal, cost and profit', () => {
  assert.deepEqual(calculateSaleTotals([{ qty: 2, price: 19.99, cost: 10 }], 5, 1), {
    subtotal: 39.98, costTotal: 20, total: 35.98, profit: 15.98,
  });
});

test('never returns a negative sale total', () => {
  assert.equal(calculateSaleTotals([{ qty: 1, price: 10 }], 50).total, 0);
});

test('splits installments and corrects the final rounding remainder', () => {
  assert.deepEqual(calculateInstallments(100, 3).map((item) => item.amount), [33.33, 33.33, 33.34]);
});

test('calculates percentage commission', () => {
  assert.equal(calculateCommission(199.99, 7.5), 15);
});
