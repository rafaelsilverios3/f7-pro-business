import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildCustomerRelationshipFacts, buildCustomerRelationshipIndex } from '../src/lib/customerRelationship.js';

const company = 'company-a';
const sale = (id, date, total = 100, status = 'completed', items = [{ product_id: 'p1', name: 'Filtro', quantity: 1, total }]) => ({ id, company_id: company, customer_id: 'c1', sale_date: date, total, status, items });

test('relação comercial ignora venda cancelada e calcula padrão somente com histórico válido', () => {
  const facts = buildCustomerRelationshipFacts({ customer: { id: 'c1' }, sales: [sale('s1', '2026-03-01'), sale('s2', '2026-04-01'), sale('s3', '2026-05-01'), sale('cancelled', '2026-06-01', 900, 'cancelled')], now: new Date('2026-05-15T12:00:00Z') });
  assert.equal(facts.purchases, 3);
  assert.equal(facts.revenue, 300);
  assert.equal(facts.purchase_pattern.sufficient_history, true);
  assert.equal(facts.purchase_pattern.median_interval_days, 30.5);
  assert.equal(facts.overdue_repurchase, false);
  assert.equal(facts.products[0].purchase_count, 3);
});

test('recompra atrasada exige pelo menos três compras e ultrapassa a mediana', () => {
  const facts = buildCustomerRelationshipFacts({ customer: { id: 'c1' }, sales: [sale('s1', '2026-01-01'), sale('s2', '2026-01-31'), sale('s3', '2026-03-02')], now: new Date('2026-05-01T12:00:00Z') });
  assert.equal(facts.purchase_pattern.median_interval_days, 30);
  assert.equal(facts.overdue_repurchase, true);
  const insufficient = buildCustomerRelationshipFacts({ customer: { id: 'c1' }, sales: [sale('s1', '2026-01-01'), sale('s2', '2026-01-31')], now: new Date('2026-05-01T12:00:00Z') });
  assert.equal(insufficient.purchase_pattern.sufficient_history, false);
  assert.equal(insufficient.overdue_repurchase, false);
  assert.match(insufficient.purchase_pattern.explanation, /insuficiente/i);
});

test('compra recente sem atividade vira apenas sinal para CTA manual', () => {
  const facts = buildCustomerRelationshipFacts({ customer: { id: 'c1' }, sales: [sale('s1', '2026-09-05')], activities: [], now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(facts.is_recent_purchase, true);
  assert.equal(facts.without_post_sale_followup, true);
  const followed = buildCustomerRelationshipFacts({ customer: { id: 'c1' }, sales: [sale('s1', '2026-09-05')], activities: [{ customer_id: 'c1', status: 'CONCLUIDA', completed_at: '2026-09-06T12:00:00Z' }], now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(followed.without_post_sale_followup, false);
});

test('índice é tenant-scoped e agrega sem consulta por cliente', () => {
  const index = buildCustomerRelationshipIndex({ companyId: company, customers: [{ company_id: company, id: 'c1' }, { company_id: 'other', id: 'c2' }], sales: [sale('s1', '2026-09-01'), { ...sale('other', '2026-09-01'), company_id: 'other', customer_id: 'c2' }], now: new Date('2026-09-13T12:00:00Z') });
  assert.deepEqual([...index.keys()], ['c1']);
  assert.equal(index.get('c1').purchases, 1);
});

test('Sales Hub usa fatos do relacionamento sem infraestrutura CRM duplicada ou envio externo', () => {
  const model = fs.readFileSync('src/lib/salesHub.js', 'utf8');
  const page = fs.readFileSync('src/pages/SalesHub.jsx', 'utf8');
  const service = fs.readFileSync('src/services/salesHubService.js', 'utf8');
  assert.match(model, /buildCustomerRelationshipIndex/);
  assert.match(model, /overdue_repurchase/);
  assert.match(page, /customer-filter/);
  assert.doesNotMatch(page, /whatsapp-send|sendMessage|fetch\(/i);
  assert.match(service, /Promise\.all/);
  assert.doesNotMatch(model, /phone|email|document/);
});
