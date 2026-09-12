import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/lib/opportunityRadarDetectors.js', 'utf8');
const { detectRadarSignals, scoreRadarSignal, toRadarOpportunity } = await import('../src/lib/opportunityRadarDetectors.js');

const company = 'company-a'; const other = 'company-b'; const now = new Date('2026-09-12T12:00:00Z');
const sale = (id, customer_id, sale_date, items = []) => ({ id, company_id: company, customer_id, sale_date, status: 'completed', items });

test('detects recurring customer past its dynamic repurchase window', () => {
  const rows = detectRadarSignals({ companyId: company, now, customers: [{ id: 'c1', company_id: company, name: 'Maria' }], sales: [sale('s1', 'c1', '2026-04-01'), sale('s2', 'c1', '2026-05-01'), sale('s3', 'c1', '2026-06-01')] });
  assert.equal(rows.length, 1); assert.equal(rows[0].signal_type, 'possible_repurchase'); assert.match(rows[0].description, /Maria/); assert.ok(rows[0].evidence.days_since_purchase > 45);
});

test('detects stock risk and stagnant product from real periods', () => {
  const rows = detectRadarSignals({ companyId: company, now, products: [{ id: 'p1', company_id: company, name: 'Filtro', stock: 2, minimum_stock: 5, active: true }, { id: 'p2', company_id: company, name: 'Peça parada', stock: 10, minimum_stock: 1, active: true }], sales: [sale('s1', null, '2026-07-20', [{ product_id: 'p2', qty: 3 }])] });
  assert.deepEqual(new Set(rows.map((row) => row.signal_type)), new Set(['stock_below_min', 'stagnant_product']));
});

test('does not leak another tenant or invent a signal without dated history', () => {
  const rows = detectRadarSignals({ companyId: company, now, customers: [{ id: 'c1', company_id: other, name: 'Outro' }, { id: 'c2', company_id: company, name: 'Sem histórico' }], products: [{ id: 'p1', company_id: other, name: 'Outro', stock: 0, minimum_stock: 5, active: true }], sales: [sale('s1', 'c1', '2026-01-01')] });
  assert.equal(rows.length, 0);
});

test('score and priority are bounded, explainable and deterministic', () => {
  const scored = scoreRadarSignal({ impact: 100, urgency: 100, confidence: 95, recurrence: 70, freshness: 100 });
  assert.deepEqual(scored, { score: 93, priority: 'CRÍTICA' });
  const opportunity = toRadarOpportunity({ radar_key: 'product:stock_below_min:p1', title: 'Estoque crítico', description: 'x', entity_type: 'product', entity_id: 'p1', signal_type: 'stock_below_min', evidence: { stock: 2 }, suggested_action: 'Consultar fornecedor', confidence: 95, impact: 80, urgency: 85, recurrence: 70, freshness: 100 });
  assert.equal(opportunity.metadata.radar_key, 'product:stock_below_min:p1'); assert.equal(opportunity.metadata.radar_state, 'NOVA'); assert.equal(opportunity.source_type, 'INTERNA');
});

test('policy keeps detection advisory and scheduler explicit', () => {
  assert.match(source, /deterministic/i); assert.match(source, /requires_human_approval: true/); assert.match(source, /scheduler: 'server_side'/);
});
