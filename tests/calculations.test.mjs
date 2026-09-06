import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommission, calculateInstallments, calculateSaleTotals, roundMoney } from '../src/lib/calculations.js';
import { customerSchema, productSchema, saleSchema } from '../src/schemas/index.js';

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

test('requires company_id for customer and product data', () => {
  assert.equal(customerSchema.safeParse({ name: 'Cliente' }).success, false);
  assert.equal(productSchema.safeParse({ name: 'Produto', price: 10, cost: 5, stock: 1 }).success, false);
});

test('validates a sale with at least one valid item', () => {
  assert.equal(saleSchema.safeParse({ company_id: 'c1', items: [{ product_id: 'p1', qty: 1, price: 10 }] }).success, true);
  assert.equal(saleSchema.safeParse({ company_id: 'c1', items: [] }).success, false);
});

test('rejects invalid stock quantities in sale items', () => {
  assert.equal(saleSchema.safeParse({ company_id: 'c1', items: [{ product_id: 'p1', qty: 0, price: 10 }] }).success, false);
});

test('cancellation state is represented by a stable status constant', async () => {
  const { SALES_STATUS } = await import('../src/lib/statuses.js');
  assert.equal(SALES_STATUS.CANCELLED, 'cancelled');
});

test('empty sale produces zeroed totals', () => {
  assert.deepEqual(calculateSaleTotals(), { subtotal: 0, costTotal: 0, total: 0, profit: 0 });
});

test('zero commission is safe', () => {
  assert.equal(calculateCommission(100, 0), 0);
});

test('installment count is normalized to at least one', () => {
  assert.deepEqual(calculateInstallments(25, 0).map((item) => item.amount), [25]);
});
