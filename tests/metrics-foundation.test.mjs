import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAbcRows,
  buildCrmFunnel,
  createPeriodContext,
  matchesPeriod,
  projectionForPeriod,
  safeMargin,
} from '../src/lib/metrics.js';
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
