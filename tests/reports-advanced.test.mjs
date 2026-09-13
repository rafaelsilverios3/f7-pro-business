import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createPeriodContext } from '../src/lib/metrics.js';
import { canUseFeature } from '../src/services/planService.js';

const page = fs.readFileSync('src/pages/Relatorios.jsx', 'utf8');
const service = fs.readFileSync('src/services/reportsService.js', 'utf8');

test('reports preserve the single route and use server-side advanced_reports entitlement', () => {
  assert.match(page, /company_has_feature/);
  assert.match(page, /advanced_reports/);
  assert.match(page, /setGate\('blocked'\)/);
  assert.doesNotMatch(page, /relatorios-v2|advanced-reports|executive-reports/);
});

test('advanced reports keep the commercial plan matrix', () => {
  assert.equal(canUseFeature('free', 'advanced_reports'), false);
  assert.equal(canUseFeature('pro', 'advanced_reports'), false);
  assert.equal(canUseFeature('business', 'advanced_reports'), true);
  assert.equal(canUseFeature('premium', 'advanced_reports'), true);
});

test('reports cover all supported period contracts and reject inverted custom ranges', () => {
  for (const periodKey of ['today', '7d', '30d', 'month', 'quarter', 'year', 'all']) {
    const context = createPeriodContext({ companyId: 'company-a', periodKey, now: new Date('2026-09-13T12:00:00Z'), timezone: 'UTC' });
    assert.equal(context.company_id, 'company-a');
  }
  assert.throws(() => createPeriodContext({ companyId: 'company-a', periodKey: 'custom', startDate: '2026-09-14', endDate: '2026-09-13', timezone: 'UTC' }), /anterior|igual/);
});

test('reports keep tenant scoping, cancelled-sale exclusion, comparison and stale-request protections', () => {
  assert.match(service, /row\?\.company_id === companyId/);
  assert.match(service, /status !== 'cancelled'/);
  assert.match(service, /previousPeriodContext/);
  assert.match(page, /requestId/);
  assert.match(page, /current !== requestId\.current/);
});

test('report intelligence context is minimized and explicitly internal', () => {
  assert.match(service, /research_mode: 'internal'/);
  assert.match(service, /rows_preview/);
  assert.match(service, /key !== 'search'/);
  assert.match(service, /kpis: \{ revenue/);
});

test('reports provide filtered exports and contextual empty/error states', () => {
  assert.match(page, /serializeCsv/);
  assert.match(page, /buildPrintableHtml/);
  assert.match(page, /Limpar filtros/);
  assert.match(page, /Nenhum registro encontrado para os filtros selecionados/);
  assert.match(page, /não foi possível carregar este relatório/i);
});
