import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeriodContext } from '../src/lib/metrics.js';
import { buildMarketingIntelligenceContext, buildMarketingModel, getMarketingSegment, toCampaignDraft } from '../src/lib/marketing.js';
import fs from 'node:fs';

const companyId = 'company-a';
const period = createPeriodContext({ companyId, periodKey: 'month', now: new Date('2026-09-13T12:00:00Z'), timezone: 'UTC' });
const customers = [
  { company_id: companyId, id: 'c1', name: 'Cliente ativo', status: 'active', email: 'private@example.com', phone: '+55000000000' },
  { company_id: companyId, id: 'c2', name: 'Cliente inativo', status: 'active' },
  { company_id: companyId, id: 'c3', name: 'Cliente em queda', status: 'active' },
  { company_id: 'other', id: 'other-customer', name: 'Outro tenant', status: 'active' },
];
const products = [
  { company_id: companyId, id: 'p1', name: 'Produto A', category: 'Categoria A', price: 100, stock: 4, item_type: 'product' },
  { company_id: companyId, id: 'p2', name: 'Produto B', category: 'Categoria B', price: 200, stock: 0, item_type: 'product' },
  { company_id: 'other', id: 'other-product', name: 'Produto de outro tenant', price: 999, stock: 9, item_type: 'product' },
];
const sales = [
  { company_id: companyId, id: 's1', customer_id: 'c1', sale_date: '2026-09-05', total: 100, status: 'completed', items: [{ product_id: 'p1', name: 'Produto A', quantity: 1, total: 100 }] },
  { company_id: companyId, id: 's2', customer_id: 'c1', sale_date: '2026-08-05', total: 100, status: 'completed', items: [{ product_id: 'p1', name: 'Produto A', quantity: 1, total: 100 }] },
  { company_id: companyId, id: 's3', customer_id: 'c2', sale_date: '2026-05-01', total: 300, status: 'completed', items: [{ product_id: 'p2', name: 'Produto B', quantity: 1, total: 300 }] },
  { company_id: companyId, id: 's4', customer_id: 'c3', sale_date: '2026-08-02', total: 200, status: 'completed', items: [{ product_id: 'p1', name: 'Produto A', quantity: 2, total: 200 }] },
  { company_id: companyId, id: 's5', customer_id: 'c3', sale_date: '2026-09-02', total: 100, status: 'completed', items: [{ product_id: 'p1', name: 'Produto A', quantity: 1, total: 100 }] },
  { company_id: companyId, id: 'cancelled', customer_id: 'c1', sale_date: '2026-09-06', total: 900, status: 'cancelled', items: [{ product_id: 'p2', name: 'Produto B', quantity: 9, total: 900 }] },
  { company_id: 'other', id: 'other-sale', customer_id: 'other-customer', sale_date: '2026-09-06', total: 9999, status: 'completed', items: [{ product_id: 'other-product', name: 'Produto de outro tenant', quantity: 1, total: 9999 }] },
];

test('marketing segments are deterministic, tenant-scoped and exclude cancelled sales', () => {
  const model = buildMarketingModel({ companyId, customers, sales, products, opportunities: [{ company_id: companyId, id: 'opp-c2', customer_id: 'c2', title: 'Reativar cliente', status: 'open' }], periodContext: period, now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(model.profiles.length, 3);
  assert.equal(model.overview.active, 2);
  assert.equal(model.overview.inactive, 1);
  assert.equal(getMarketingSegment(model, 'opportunity').rows[0].id, 'c2');
  assert.equal(getMarketingSegment(model, 'bought_product', 'p1').rows.length, 2);
  assert.equal(getMarketingSegment(model, 'not_bought_product', 'p2').rows.length, 2);
  assert.ok(model.profiles.find((row) => row.id === 'c1').historical_revenue < 1000);
  assert.equal(model.products.some((row) => row.id === 'other-product'), false);
});

test('marketing intelligence context is aggregated and contains no customer PII', () => {
  const model = buildMarketingModel({ companyId, customers, sales, products, opportunities: [], periodContext: period, now: new Date('2026-09-13T12:00:00Z') });
  const segment = getMarketingSegment(model, 'active');
  const context = buildMarketingIntelligenceContext(model, segment, { objective: 'reativação', channel: 'Manual' });
  const serialized = JSON.stringify(context);
  assert.match(serialized, /segment_summary/);
  assert.doesNotMatch(serialized, /private@example\.com|\+55000000000|document/);
  assert.equal(context.mode, 'internal');
  const generated = toCampaignDraft({ answer: 'Texto baseado nos dados internos.', recommendations: ['Revisar evidências'], risks: [] }, { objective: 'reativação', cta: '' }, context);
  assert.equal(generated.status, 'RASCUNHO');
  assert.equal(generated.prepared_only, true);
  assert.equal(generated.channel_versions.whatsapp, generated.main_message);
});

test('marketing reuses Intelligence and never adds send or campaign persistence infrastructure', () => {
  const service = fs.readFileSync('src/services/marketingService.js', 'utf8');
  const page = fs.readFileSync('src/pages/Marketing.jsx', 'utf8');
  const edge = fs.readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8');
  assert.match(service, /intelligenceService\.query/);
  assert.match(service, /Promise\.all/);
  assert.match(page, /Sem envio automático/);
  assert.doesNotMatch(page, /send|whatsapp-send|fetch\(/i);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
  assert.match(edge, /marketing_context/);
  assert.match(edge, /source_module: 'marketing'/);
});
