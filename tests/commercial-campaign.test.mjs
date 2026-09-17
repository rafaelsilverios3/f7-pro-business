import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildCampaignPreview, calculateCanonicalValues, matchCustomer, matchProduct, reconcileCampaignValues, summarizeCampaignUniverses } from '../src/lib/commercialCampaign.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/0077_commercial_campaigns.sql', import.meta.url), 'utf8');
const sourcePotentialMigration = fs.readFileSync(new URL('../supabase/migrations/0078_commercial_campaign_source_potential.sql', import.meta.url), 'utf8');

test('migration aditiva cria núcleo transversal com RLS e isolamento por tenant', () => {
  for (const table of ['commercial_campaigns', 'commercial_campaign_imports', 'commercial_campaign_facts', 'commercial_campaign_targets', 'commercial_campaign_outcomes']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.match(migration, /validate_commercial_campaign_tenant/);
  assert.match(migration, /confirmed recovery requires linked sale/);
  assert.match(migration, /unique \(company_id, import_id, idempotency_key\)/);
  assert.match(sourcePotentialMigration, /add column if not exists source_potential/);
});

test('F7 recalcula diferença, percentual e potencial sem sobrescrever origem', () => {
  assert.deepEqual(calculateCanonicalValues(100, 75), { base: 100, compare: 75, difference: -25, variationPct: -0.25, potential: 25, valid: true });
  const result = reconcileCampaignValues({ baseValue: 100, compareValue: 75, sourceDifference: -20, sourcePotential: 20, sourceVariationPct: -0.2 });
  assert.equal(result.divergence, true);
  assert.equal(result.difference, -25);
  assert.equal(result.sourceDifference, -20);
  assert.equal(result.potential, 25);
});

test('matching não faz merge silencioso e separa provável, ambíguo e novo', () => {
  const customers = [{ id: 'c1', company_id: 'a', name: 'ACME LTDA' }, { id: 'c2', company_id: 'a', name: 'Acme Ltda' }, { id: 'c3', company_id: 'b', name: 'Outro' }];
  assert.equal(matchCustomer('Acme Ltda', customers).status, 'ambiguous');
  assert.equal(matchCustomer('Cliente novo', customers).status, 'new');
  assert.equal(matchCustomer('Acme Ltda', customers.filter((row) => row.id === 'c1')).status, 'probable');
  const products = [{ id: 'p1', sku: 'CQM20204', name: 'JD PLUS 50 II 15W40 20L' }, { id: 'p2', sku: 'TY25274', name: 'HY-GARD 20L' }];
  assert.equal(matchProduct({ code: 'CQM20204', name: 'outro' }, products).status, 'exact');
  assert.equal(matchProduct({ code: '', name: 'JD PLUS 50 II 15W40 20L' }, products).status, 'probable');
  assert.equal(matchProduct({ code: 'NAO-EXISTE', name: 'Novo' }, products).status, 'new');
});

test('prévia classifica fatos e mantém importação em memória', () => {
  const preview = buildCampaignPreview({
    customers: [{ id: 'c1', name: 'Cliente A' }],
    products: [{ id: 'p1', sku: 'SKU-1', name: 'Produto A' }],
    rows: [{ sheet: 'Plano de Acao', sourceRow: 2, priority: 'P1 - ALTA', customer: 'Cliente A', code: 'SKU-1', product: 'Produto A', baseValue: 100, compareValue: 50, sourceDifference: -40, sourcePotential: 50, sourceVariationPct: -0.4 }],
  });
  assert.equal(preview.total, 1);
  assert.equal(preview.counts.probable, 1);
  assert.equal(preview.counts.divergences, 1);
  assert.equal(preview.facts[0].reconciliation.potential, 50);
  assert.equal(preview.persisted, false);
});

test('prévia separa clientes, produtos, histórico, plano de ação e divergência da fonte', () => {
  const preview = summarizeCampaignUniverses({
    customerRows: [{ name: 'Cliente A' }, { name: 'Cliente B' }],
    productRows: [{ sku: 'SKU-1', name: 'Produto A' }, { sku: 'SKU-2', name: 'Produto B' }],
    customers: [{ id: 'c1', name: 'Cliente A' }],
    products: [{ id: 'p1', sku: 'SKU-1', name: 'Produto A' }],
    historyRows: [
      { customer: 'Cliente A', code: 'SKU-1', product: 'Produto A', baseValue: 100, compareValue: 50 },
      { customer: 'Cliente B', code: 'SKU-2', product: 'Produto B', baseValue: 100, compareValue: 20 },
    ],
    actionRows: [
      { customer: 'Cliente A', code: 'SKU-1', product: 'Produto A', priority: 'P1', baseValue: 100, compareValue: 50 },
      { customer: 'Cliente B', code: 'SKU-2', product: 'Produto B', priority: 'P2', baseValue: 80, compareValue: 20 },
      { customer: 'Cliente B', code: 'SKU-2', product: 'Produto B', priority: 'P3', baseValue: 60, compareValue: 10 },
    ],
    managementSummary: { opportunities: 5, potential: 300 },
  });
  assert.equal(preview.customers.total, 2);
  assert.deepEqual(preview.customers.counts, { exact: 0, probable: 1, ambiguous: 0, new: 1, invalid: 0 });
  assert.equal(preview.products.total, 2);
  assert.deepEqual(preview.products.counts, { exact: 1, probable: 0, ambiguous: 0, new: 1, invalid: 0 });
  assert.deepEqual({ total: preview.history.total, ready: preview.history.ready, blocked: preview.history.blocked }, { total: 2, ready: 0, blocked: 2 });
  assert.deepEqual(preview.action.counts, { P1: 1, P2: 1, P3: 1 });
  assert.equal(preview.action.potential, 160);
  assert.deepEqual(preview.divergence, { opportunities: 2, potential: 140 });
});

test('serviço consulta catálogo por company_id antes do matching', () => {
  const service = fs.readFileSync(new URL('../src/services/commercialCampaignService.js', import.meta.url), 'utf8');
  assert.match(service, /entity\('Customer'\)\.filter\(\{ company_id: companyId \}/);
  assert.match(service, /entity\('Product'\)\.filter\(\{ company_id: companyId \}/);
  assert.match(service, /alreadyImported/);
  assert.match(service, /bulkCreateInChunks/);
  assert.match(service, /historyRows/);
});

test('importação persistida mantém prioridade de origem, fila não trabalhada e sem CRM automático', () => {
  const page = fs.readFileSync(new URL('../src/pages/Campanhas.jsx', import.meta.url), 'utf8');
  const provider = fs.readFileSync(new URL('../src/data/providers/supabaseProvider.js', import.meta.url), 'utf8');
  assert.match(page, /PersistedQueue/);
  assert.match(page, /NOT_CONTACTED/);
  assert.match(page, /AUTORIZO IMPORTAÇÃO REAL NO F7 TESTE BETA/);
  assert.match(provider, /async bulkCreate\(payloads\)/);
});
