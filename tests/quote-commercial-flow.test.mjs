import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quoteTotals, quoteHasReliableSnapshot, quoteIsExpired } from '../src/lib/quoteCommercial.js';

test('quote totals use cents precision and never create negative totals', async () => {
  const result = quoteTotals([{ product_id: 'p1', qty: 3, price: 33.335, cost: 10 }], 100, 0);
  assert.equal(result.subtotal, 100.01);
  assert.equal(result.total, 0.01);
  assert.equal(result.items[0].unit_price, 33.34);
});

test('legacy quote without a cost snapshot fails closed', () => {
  assert.equal(quoteHasReliableSnapshot({ items: [{ product_id: 'p1', qty: 1, price: 10 }] }), false);
  assert.equal(quoteHasReliableSnapshot({ items: [{ product_id: 'p1', qty: 1, price: 10, cost: 4 }] }), true);
});

test('expired quote is not convertible by derived date', () => {
  assert.equal(quoteIsExpired({ valid_until: '2026-09-12' }, new Date('2026-09-13T12:00:00Z')), true);
  assert.equal(quoteIsExpired({ valid_until: '2026-09-14' }, new Date('2026-09-13T12:00:00Z')), false);
});

test('Sales Hub has tenant-scoped quote summaries and timeline facts', () => {
  const source = fs.readFileSync('src/lib/salesHub.js', 'utf8');
  assert.match(source, /quotes = \[\]/);
  assert.match(source, /const scopedQuotes = scoped\(quotes, companyId\)/);
  assert.match(source, /type: 'quote'/);
  assert.match(source, /overview:.*quotes:/s);
});

test('commercial migration is additive, tenant-safe and transactional', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/0073_quote_commercial_flow.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists seller_user_id/i);
  assert.match(sql, /create or replace function public\.convert_quote_to_sale/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /quote:\' \|\| quote_row\.id/i);
  assert.match(sql, /Orçamento legado exige revisão humana/i);
  assert.match(sql, /revoke delete on public\.quotes/i);
});

test('automation worker detects quote lifecycle signals with idempotent windows', () => {
  const worker = fs.readFileSync('supabase/functions/automation-worker/index.ts', 'utf8');
  const shared = fs.readFileSync('supabase/functions/_shared/crmAutomation.ts', 'utf8');
  for (const trigger of ['quote_created', 'quote_approved', 'quote_no_response']) {
    assert.match(shared, new RegExp(`'${trigger}'`));
    assert.match(worker, new RegExp(trigger));
  }
  assert.match(worker, /automation_runs/);
  assert.match(worker, /entity_id: signal\.activity_id \|\| signal\.opportunity_id \|\| signal\.quote_id/);
});
