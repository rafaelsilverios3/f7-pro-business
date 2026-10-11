import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAbcRows, buildRevenueSeries, createPeriodContext } from '../src/lib/metrics.js';
import { buildCustomerRelationshipFacts } from '../src/lib/customerRelationship.js';
import { isRevenueSale, saleItemTotal } from '../src/lib/saleStatus.js';

const companyId = 'homolog-company-a';
const context = createPeriodContext({ companyId, periodKey: 'all' });

test('draft and cancelled sales are excluded from revenue, customer history, and product rankings', () => {
  const sales = [
    { id: 'draft', company_id: companyId, customer_id: 'customer-a', status: 'draft', sale_date: '2026-10-11', total: 100, profit: 50, items: [{ name: 'Draft item', total: 100 }] },
    { id: 'cancelled', company_id: companyId, customer_id: 'customer-a', status: 'cancelled', sale_date: '2026-10-11', total: 200, profit: 100, items: [{ name: 'Cancelled item', total: 200 }] },
    { id: 'paid', company_id: companyId, customer_id: 'customer-a', status: 'paid', sale_date: '2026-10-11', total: 30, profit: 10, items: [{ name: 'Paid item', total: 30 }] },
  ];

  assert.deepEqual(sales.map(isRevenueSale), [false, false, true]);
  assert.deepEqual(buildRevenueSeries(sales, context).current.map((row) => row.faturamento), [30]);
  assert.deepEqual(buildAbcRows(sales, context).map((row) => row.name), ['Paid item']);
  const relationship = buildCustomerRelationshipFacts({ customer: { id: 'customer-a' }, sales, now: new Date('2026-10-12T12:00:00Z') });
  assert.equal(relationship.purchases, 1);
  assert.equal(relationship.revenue, 30);
});

test('draft line totals fall back to quantity times price when the RPC omits total', () => {
  assert.equal(saleItemTotal({ qty: 3, price: 4.5 }), 13.5);
  assert.equal(saleItemTotal({ quantity: 2, price: 5, total: 12 }), 12);
  assert.equal(saleItemTotal({ qty: 'bad', price: 5 }), 0);
});

test('sales page labels drafts, excludes them from KPIs and hides unsafe cancellation until migration 0088', () => {
  const page = fs.readFileSync('src/pages/Vendas.jsx', 'utf8');
  assert.match(page, /items\.filter\(isRevenueSale\)/);
  assert.match(page, /draft: 'Rascunho'/);
  assert.match(page, /saleItemTotal\(i\)/);
  assert.match(page, /s\.status !== 'draft'/);
});

test('draft cancellation migration returns before any stock or commercial-ledger reversal', () => {
  const migration = fs.readFileSync('supabase/migrations/0088_cancel_draft_sale_without_stock_reversal.sql', 'utf8');
  const draftBranch = migration.indexOf("if result.status = 'draft' then");
  const stockLoop = migration.indexOf('for item in select * from jsonb_array_elements(result.items) loop');
  assert.ok(draftBranch >= 0 && stockLoop > draftBranch, 'draft branch must precede reversal loop');
  const draftBody = migration.slice(draftBranch, stockLoop);
  assert.match(draftBody, /status = 'cancelled'/i);
  assert.match(draftBody, /sale\.draft_cancelled/i);
  assert.doesNotMatch(draftBody, /public\.(products|product_variants|stock_movements|financial_entries|commissions|customers)/i);
  assert.match(migration, /is_company_member\(company_id\)/i);
  assert.match(migration, /current_company_role\(result\.company_id\) not in/i);
  assert.match(migration, /revoke all on function public\.cancel_sale\(uuid\) from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.cancel_sale\(uuid\) to authenticated/i);
  assert.match(migration, /conceptual rollback/i);
});
