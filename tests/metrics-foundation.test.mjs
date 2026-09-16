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
import { getActionableMetrics, getDashboardMetrics, getCustomerCompositionMetrics, getCriticalStockMetrics, getDecliningCustomerMetrics, getDemandLowStockMetrics, getInactiveCustomerMetrics, getNoTurnoverProductMetrics, getOpportunityOriginMetrics, getOpportunityPriorityMetrics, getPaymentMethodMetrics, getPriorityOpportunityMetrics, getSalesStatusMetrics, getStockHealthMetrics, getTopCustomerMetrics, getTopProductMetrics } from '../src/services/metricsService.js';
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
  assert.match(dashboard, /Olá, \{firstName\}!/);
  assert.match(dashboard, /profileName/);
  assert.doesNotMatch(dashboard, /user\?\.email \|\|/);
  assert.match(dashboard, /Aqui está o resumo do seu negócio em tempo real/);
  assert.match(dashboard, /Array\.from\(\{ length: 8 \}/);
  assert.match(dashboard, /m\.partialErrors\.length > 0/);
  assert.match(dashboard, /Indisponível/);
  assert.match(dashboard, /Number\(m\.margem \|\| 0\)\.toFixed/);
  assert.match(dashboard, /data-dashboard-loading/);
  assert.match(dashboard, /Tente novamente em instantes/);
  assert.match(dashboard, /requestId !== dashboardRequest\.current/);
});

test('dashboard revenue evolution stays a temporal line chart', () => {
  const dashboard = fs.readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /<LineChart data=\{m\.charts\.revenue\.rows\}/);
  assert.match(dashboard, /<Line type="monotone" dataKey="faturamento"/);
  assert.match(dashboard, /dataKey="faturamento_anterior"[^>]*strokeDasharray="5 5"/);
  assert.doesNotMatch(dashboard, /<AreaChart data=\{m\.charts\.revenue\.rows\}/);
});

test('dashboard period controls and actionable rows stay usable on narrow viewports', () => {
  const dashboard = fs.readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /aria-label="Período do dashboard"/);
  assert.match(dashboard, /overflow-x-auto/);
  assert.match(dashboard, /whitespace-nowrap/);
  assert.match(dashboard, /flex min-w-0 flex-wrap items-center gap-3 rounded-xl/);
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
  assert.deepEqual(getSalesStatusMetrics(companyId, sales, context).rows.map((row) => row.status).sort(), ['Canceladas', 'Concluídas', 'Pagas']);
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

test('actionable dashboard rankings are deterministic, tenant-scoped and avoid false declines', () => {
  const context = createPeriodContext({ companyId, periodKey: 'custom', startDate: '2026-09-01', endDate: '2026-09-30', timezone: 'UTC' });
  const customers = [
    { company_id: companyId, id: 'c1', name: 'Cliente em queda', status: 'active', created_date: '2025-01-01' },
    { company_id: companyId, id: 'c2', name: 'Oscilação irrelevante', status: 'active', created_date: '2025-01-01' },
    { company_id: companyId, id: 'c3', name: 'Cliente novo', status: 'active', created_date: '2026-09-01' },
    { company_id: companyId, id: 'inactive', name: 'Cliente inativo', status: 'active', created_date: '2025-01-01' },
    { company_id: 'other', id: 'foreign', name: 'Outro tenant', status: 'active', created_date: '2025-01-01' },
  ];
  const products = [
    { company_id: companyId, id: 'p1', name: 'Filtro campeão', item_type: 'product', stock: 1, minimum_stock: 2 },
    { company_id: companyId, id: 'p2', name: 'Produto parado', item_type: 'product', stock: 5, minimum_stock: 1 },
    { company_id: companyId, id: 'p3', name: 'Produto zerado', item_type: 'product', stock: 0, minimum_stock: 2 },
    { company_id: companyId, id: 'service', name: 'Serviço', item_type: 'service', stock: 0, minimum_stock: 0 },
    { company_id: 'other', id: 'foreign-product', name: 'Produto estrangeiro', item_type: 'product', stock: 0, minimum_stock: 2 },
  ];
  const sales = [
    { company_id: companyId, customer_id: 'c1', sale_date: '2026-09-05', status: 'completed', total: 20, items: [{ product_id: 'p1', name: 'Filtro campeão', qty: 5, total: 20 }] },
    { company_id: companyId, customer_id: 'c1', sale_date: '2026-08-05', status: 'completed', total: 200, items: [{ product_id: 'p2', name: 'Produto parado', qty: 2, total: 200 }] },
    { company_id: companyId, customer_id: 'c2', sale_date: '2026-09-06', status: 'completed', total: 99, items: [{ product_id: 'p1', name: 'Filtro campeão', qty: 1, total: 99 }] },
    { company_id: companyId, customer_id: 'c2', sale_date: '2026-08-06', status: 'completed', total: 100, items: [{ product_id: 'p1', name: 'Filtro campeão', qty: 1, total: 100 }] },
    { company_id: companyId, customer_id: 'c3', sale_date: '2026-09-07', status: 'completed', total: 300, items: [{ product_id: 'p1', name: 'Filtro campeão', qty: 3, total: 300 }] },
    { company_id: companyId, customer_id: 'inactive', sale_date: '2026-01-01', status: 'completed', total: 40, items: [{ product_id: 'p2', name: 'Produto parado', qty: 1, total: 40 }] },
    { company_id: 'other', customer_id: 'foreign', sale_date: '2026-09-05', status: 'completed', total: 9999, items: [{ product_id: 'foreign-product', name: 'Produto estrangeiro', qty: 99, total: 9999 }] },
  ];
  const opportunities = [
    { company_id: companyId, id: 'opp-c1', title: 'Reativar cliente', status: 'descoberta', opportunity_score: 80, metadata: { entity_type: 'customer', entity_id: 'c1', priority: 'ALTA', radar_state: 'NOVA' } },
    { company_id: companyId, id: 'opp-p1', title: 'Repor filtro', status: 'descoberta', opportunity_score: 90, metadata: { entity_type: 'product', entity_id: 'p1', priority: 'CRÍTICA', radar_state: 'NOVA' } },
    { company_id: companyId, id: 'closed', title: 'Resolvida', status: 'convertida_em_produto', metadata: { entity_type: 'product', entity_id: 'p1' } },
    { company_id: companyId, id: 'snoozed', title: 'Adiada', status: 'descoberta', metadata: { entity_type: 'product', entity_id: 'p2', snooze_until: '2099-01-01T00:00:00Z' } },
    { company_id: 'other', id: 'foreign-opp', title: 'Outro tenant', status: 'descoberta', metadata: { entity_type: 'product', entity_id: 'foreign-product', priority: 'CRÍTICA' } },
  ];
  const topCustomers = getTopCustomerMetrics(companyId, customers, sales, opportunities, context);
  assert.deepEqual(topCustomers.rows.map((row) => row.customer_id), ['c3', 'c2', 'c1']);
  assert.equal(topCustomers.rows[0].average_ticket, 300);
  const decline = getDecliningCustomerMetrics(companyId, customers, sales, opportunities, context);
  assert.deepEqual(decline.rows.map((row) => row.customer_id), ['c1']);
  assert.equal(decline.rows[0].variation_percent, -90);
  assert.equal(decline.rows.some((row) => row.customer_id === 'c2'), false);
  assert.equal(decline.rows.some((row) => row.variation_percent === Infinity || Number.isNaN(row.variation_percent)), false);
  const inactive = getInactiveCustomerMetrics(companyId, customers, sales, opportunities, context);
  assert.equal(inactive.rows[0].customer_id, 'inactive');
  assert.equal(inactive.rows[0].last_purchase, '2026-01-01');
  const topProducts = getTopProductMetrics(companyId, products, sales, opportunities, context);
  assert.equal(topProducts.rows[0].product_id, 'p1');
  assert.equal(Math.round(topProducts.rows.reduce((sum, row) => sum + row.share, 0)), 100);
  assert.equal(topProducts.rows.some((row) => row.product_id === 'foreign-product'), false);
  const noTurnover = getNoTurnoverProductMetrics(companyId, products, sales, opportunities, context);
  assert.equal(noTurnover.rows[0].product_id, 'p2');
  const critical = getCriticalStockMetrics(companyId, products, sales, opportunities, context);
  assert.deepEqual(critical.rows.map((row) => row.product_id), ['p3', 'p1']);
  const demandLowStock = getDemandLowStockMetrics(companyId, products, sales, opportunities, context);
  assert.deepEqual(demandLowStock.rows.map((row) => row.product_id), ['p1']);
  const prioritized = getPriorityOpportunityMetrics(companyId, opportunities, context);
  assert.deepEqual(prioritized.rows.map((row) => row.id), ['opp-p1', 'opp-c1']);
  assert.equal(prioritized.rows.some((row) => row.id === 'closed' || row.id === 'snoozed' || row.id === 'foreign-opp'), false);
  const actionable = getActionableMetrics(companyId, { customers, products, sales, opportunities }, context);
  assert.equal(actionable.topCustomers.rows.length, 3);
  assert.equal(actionable.priorityOpportunities.rows.length, 2);
});

test('actionable dashboard UI exposes positive empty states and no per-row repository calls', () => {
  const dashboard = fs.readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /Clientes que mais compram/);
  assert.match(dashboard, /Nenhum cliente com queda relevante/);
  assert.match(dashboard, /Produtos sem giro/);
  assert.match(dashboard, /Demanda \+ estoque baixo/);
  assert.match(dashboard, /Oportunidades prioritárias/);
  assert.doesNotMatch(dashboard, /rows\.map\([^)]*repository/);
});
