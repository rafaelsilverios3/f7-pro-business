import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAbcRows,
  buildCrmFunnel,
  createPeriodContext,
  compareMetric,
  matchesPeriod,
  previousPeriodContext,
  projectionForPeriod,
  safeMargin,
} from '../src/lib/metrics.js';
import { getDashboardMetrics, getCustomerCompositionMetrics, getOpportunityOriginMetrics, getOpportunityPriorityMetrics, getPaymentMethodMetrics, getSalesStatusMetrics, getStockHealthMetrics } from '../src/services/metricsService.js';
import { buildRevenueSeries } from '../src/lib/metrics.js';
import { buildPrintableHtml, escapeCsvCell, escapeHtml, serializeCsv } from '../src/lib/exporters.js';
import { canUseFeature } from '../src/services/planService.js';

const companyId = 'company-a';

test('period all includes historical records and periodKey all is not empty', () => {
  const context = createPeriodContext({ companyId, periodKey: 'all', timezone: 'America/Cuiaba' });
  assert.equal(matchesPeriod('2019-01-01', context), true);
});

test('custom range and tenant timezone use the tenant calendar date', () => {
  const context = createPeriodContext({ companyId, periodKey: 'custom', startDate: '2026-09-13', endDate: '2026-09-13', timezone: 'America/Cuiaba' });
  assert.equal(matchesPeriod('2026-09-13T03:30:00Z', context), true);
  assert.equal(matchesPeriod('2026-09-14T03:30:00Z', context), false);
});

test('ABC with zero sales returns an empty, finite result', () => {
  const context = createPeriodContext({ companyId, periodKey: 'all' });
  const rows = buildAbcRows([{ company_id: companyId, sale_date: '2026-01-01', status: 'paid', items: [{ name: 'A', total: 0 }] }], context);
  assert.equal(rows[0].share, 0);
  assert.equal(Number.isNaN(rows[0].share), false);
});

test('sales margin has explicit sales semantics and zero revenue is safe', () => {
  assert.equal(safeMargin(25, 100), 25);
  assert.equal(safeMargin(10, 0), 0);
});

test('projection follows the selected period instead of always being monthly', () => {
  const day = projectionForPeriod(100, createPeriodContext({ companyId, periodKey: 'day' }));
  const month = projectionForPeriod(100, createPeriodContext({ companyId, periodKey: 'month' }));
  assert.equal(day.semantic_type, 'period_total');
  assert.equal(month.label, 'Projeção do mês');
});

test('CRM funnel applies one temporal context to comparable stages', () => {
  const context = createPeriodContext({ companyId, periodKey: 'custom', startDate: '2026-09-01', endDate: '2026-09-30' });
  const funnel = buildCrmFunnel({ companyId, periodContext: context,
    customers: [{ company_id: companyId, status: 'lead', created_date: '2026-09-10' }, { company_id: companyId, status: 'active', created_date: '2025-01-01' }],
    opportunities: [{ company_id: companyId, stage: 'new', created_date: '2026-09-11' }],
    sales: [{ company_id: companyId, status: 'paid', sale_date: '2026-09-12' }],
  });
  assert.deepEqual({ leads: funnel.leads, ativos: funnel.ativos, oportunidades: funnel.oportunidades, vendas: funnel.vendas }, { leads: 1, ativos: 0, oportunidades: 1, vendas: 1 });
});

test('CSV escapes quotes, separators, CR/LF and formula prefixes', () => {
  const csv = serializeCsv(['Nome'], [['a;"b\nlinha'], ['=SUM(A1:A2)']]);
  assert.match(csv, /"a;""b\nlinha"/);
  assert.match(csv, /'=SUM/);
  assert.match(csv, /\r\n/);
  assert.equal(escapeCsvCell('+cmd'), "'+cmd");
});

test('HTML/PDF export escapes user-controlled content', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const html = buildPrintableHtml('<img src=x>', '<td onclick="evil()">x</td>');
  assert.doesNotMatch(html, /<img src=x>/);
});

test('reports advanced gate matches commercial plan matrix', () => {
  assert.equal(canUseFeature('free', 'advanced_reports'), false);
  assert.equal(canUseFeature('pro', 'advanced_reports'), false);
  assert.equal(canUseFeature('business', 'advanced_reports'), true);
  assert.equal(canUseFeature('premium', 'advanced_reports'), true);
});

test('metric inputs cannot silently mix companies', () => {
  const context = createPeriodContext({ companyId, periodKey: 'all' });
  const funnel = buildCrmFunnel({ companyId, periodContext: context, customers: [{ company_id: 'other', status: 'lead' }], sales: [{ company_id: 'other', status: 'paid' }] });
  assert.equal(funnel.leads, 0);
  assert.equal(funnel.vendas, 0);
});

test('period context always requires company_id', () => {
  assert.throws(() => createPeriodContext({ periodKey: 'month' }), /company_id/);
});

test('executive dashboard metrics cover flow, snapshots and safe zero values', () => {
  const context = createPeriodContext({ companyId, periodKey: 'month', timezone: 'America/Cuiaba', now: new Date('2026-09-13T12:00:00Z') });
  const metrics = getDashboardMetrics(companyId, {
    sales: [
      { company_id: companyId, customer_id: 'customer-a', sale_date: '2026-09-03', status: 'paid', total: 100, profit: 25 },
      { company_id: companyId, customer_id: 'customer-a', sale_date: '2026-08-03', status: 'paid', total: 50, profit: 10 },
      { company_id: 'other', customer_id: 'other-customer', sale_date: '2026-09-03', status: 'paid', total: 900, profit: 500 },
    ],
    customers: [{ company_id: companyId, id: 'customer-a', status: 'active', created_date: '2026-09-01' }],
    products: [{ company_id: companyId, stock: 1, minimum_stock: 2 }],
    opportunities: [
      { company_id: companyId, status: 'validada', value: 200 },
      { company_id: companyId, status: 'descartada', value: 300 },
      { company_id: companyId, status: 'validada', value: 400, metadata: { snooze_until: '2099-01-01T00:00:00Z' } },
    ],
    fin: [],
  }, context);
  assert.equal(metrics.sales.revenue, 100);
  assert.equal(metrics.sales.count, 1);
  assert.equal(metrics.sales.average_ticket, 100);
  assert.equal(metrics.sales.margin, 25);
  assert.equal(metrics.customers.active, 1);
  assert.equal(metrics.products.critical, 1);
  assert.equal(metrics.opportunities.open, 1);
  assert.equal(metrics.finance.available, false);
  assert.equal(metrics.comparisons.revenue.state, 'positive');
  assert.equal(metrics.comparisons.revenue.delta_percent, 100);
});

test('executive comparison handles previous zero and all-time without Infinity', () => {
  assert.deepEqual(compareMetric(10, 0), { current: 10, previous: 0, delta: 10, delta_percent: null, state: 'new' });
  assert.equal(compareMetric(0, 0).state, 'neutral');
  const all = createPeriodContext({ companyId, periodKey: 'all' });
  assert.equal(previousPeriodContext(all), null);
  const previous = previousPeriodContext(createPeriodContext({ companyId, periodKey: 'month', now: new Date('2026-09-13T12:00:00Z') }));
  assert.equal(previous.start_date, '2026-08-02');
  assert.equal(previous.end_date, '2026-08-31');
});

test('snapshot opportunity states exclude closed and active snoozed records', () => {
  const context = createPeriodContext({ companyId, periodKey: 'all' });
  const metrics = getDashboardMetrics(companyId, { opportunities: [
    { company_id: companyId, status: 'validada' },
    { company_id: companyId, status: 'convertida_em_produto' },
    { company_id: companyId, status: 'validada', metadata: { snooze_until: '2099-01-01T00:00:00Z' } },
  ] }, context);
  assert.equal(metrics.opportunities.open, 1);
});

test('executive dashboard has explicit loading, partial-error and empty-safe UI states', () => {
  const dashboard = fs.readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /Array\.from\(\{ length: 8 \}/);
  assert.match(dashboard, /m\.partialErrors\.length > 0/);
  assert.match(dashboard, /Indisponível/);
  assert.match(dashboard, /Number\(m\.margem \|\| 0\)\.toFixed/);
});

test('executive charts aggregate real periods and keep cancelled sales out of revenue', () => {
  const sales = [
    { company_id: companyId, customer_id: 'new', sale_date: '2026-09-02T10:00:00Z', status: 'paid', total: 100, payment_method: 'PIX' },
    { company_id: companyId, customer_id: 'recurring', sale_date: '2026-09-03', status: 'completed', total: 50, payment_method: 'Cartão' },
    { company_id: companyId, customer_id: 'recurring', sale_date: '2026-08-03', status: 'paid', total: 25, payment_method: 'PIX' },
    { company_id: companyId, sale_date: '2026-09-04', status: 'cancelled', total: 999, payment_method: 'PIX' },
    { company_id: 'other', sale_date: '2026-09-02', status: 'paid', total: 1000 },
  ];
  for (const periodKey of ['day', '7d', '30d', 'month', 'quarter', 'year', 'all']) {
    const context = createPeriodContext({ companyId, periodKey, timezone: 'America/Cuiaba', now: new Date('2026-09-13T12:00:00Z') });
    const series = buildRevenueSeries(sales, context);
    const expected = { day: 0, '7d': 0, '30d': 150, month: 150, quarter: 175, year: 175, all: 175 }[periodKey];
    assert.equal(series.rows.reduce((sum, row) => sum + row.faturamento, 0), expected);
    assert.equal(series.rows.some((row) => row.faturamento >= 999), false);
    if (periodKey === 'all') assert.equal(series.comparable, false);
  }
  const context = createPeriodContext({ companyId, periodKey: 'month', timezone: 'America/Cuiaba', now: new Date('2026-09-13T12:00:00Z') });
  assert.deepEqual(getSalesStatusMetrics(companyId, sales, context).rows.map((row) => row.status).sort(), ['cancelled', 'completed', 'paid']);
  const payments = getPaymentMethodMetrics(companyId, sales, context);
  assert.equal(payments.available, true);
  assert.equal(Math.round(payments.rows.reduce((sum, row) => sum + row.percent, 0)), 100);
  const customers = getCustomerCompositionMetrics(companyId, sales, context);
  assert.deepEqual({ active: customers.active, novo: customers.novo, recorrente: customers.recorrente }, { active: 2, novo: 1, recorrente: 1 });
});

test('executive charts expose opportunity origins and stock health as snapshots', () => {
  const context = createPeriodContext({ companyId, periodKey: 'month' });
  const origins = getOpportunityOriginMetrics(companyId, [
    { company_id: companyId, status: 'validada', source: 'estoque' },
    { company_id: companyId, status: 'validada', metadata: { entity_type: 'cliente' } },
    { company_id: companyId, status: 'descartada', source: 'externa' },
    { company_id: 'other', status: 'validada', source: 'fornecedor' },
  ], context);
  assert.deepEqual(origins.rows.map((row) => row.origin).sort(), ['cliente', 'estoque']);
  assert.deepEqual(getOpportunityPriorityMetrics(companyId, [
    { company_id: companyId, status: 'validada', confidence_level: 'HIGH' },
    { company_id: companyId, status: 'validada', metadata: { priority: 'baixa' } },
  ], context).rows, [{ priority: 'Alta', count: 1 }, { priority: 'Baixa', count: 1 }]);
  const stock = getStockHealthMetrics(companyId, [
    { company_id: companyId, item_type: 'product', stock: 0, minimum_stock: 2 },
    { company_id: companyId, item_type: 'product', stock: 1, minimum_stock: 2 },
    { company_id: companyId, item_type: 'product', stock: 5, minimum_stock: 2 },
    { company_id: companyId, item_type: 'service', stock: 0, minimum_stock: 0 },
    { company_id: 'other', item_type: 'product', stock: 0, minimum_stock: 2 },
  ], context);
  assert.deepEqual(Object.fromEntries(stock.rows.map((row) => [row.health, row.count])), { normal: 1, baixo: 1, zerado: 1 });
});
