import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildAtomicCampaignPayload, buildCampaignPreview, calculateCanonicalValues, matchCustomer, matchProduct, reconcileCampaignValues, summarizeCampaignUniverses } from '../src/lib/commercialCampaign.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/0077_commercial_campaigns.sql', import.meta.url), 'utf8');
const sourcePotentialMigration = fs.readFileSync(new URL('../supabase/migrations/0078_commercial_campaign_source_potential.sql', import.meta.url), 'utf8');
const atomicMigration = fs.readFileSync(new URL('../supabase/migrations/0079_commercial_campaign_atomic_import.sql', import.meta.url), 'utf8');
const atomicHardeningMigration = fs.readFileSync(new URL('../supabase/migrations/0080_fix_campaign_atomic_uuid_selection.sql', import.meta.url), 'utf8');
const setBasedMigration = fs.readFileSync(new URL('../supabase/migrations/0081_campaign_set_based_import.sql', import.meta.url), 'utf8');
const uuidMatchingMigration = fs.readFileSync(new URL('../supabase/migrations/0082_campaign_import_uuid_matching_fix.sql', import.meta.url), 'utf8');
const productCatalogRefreshMigration = fs.readFileSync(new URL('../supabase/migrations/0083_campaign_import_refresh_product_catalog.sql', import.meta.url), 'utf8');

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

test('importação atômica valida tenant, idempotência e rollback transacional', () => {
  assert.match(atomicMigration, /create or replace function public\.import_commercial_campaign_atomic/);
  assert.match(atomicMigration, /current_company_role\(p_target_company\)/);
  assert.match(atomicMigration, /file_hash = p_file_hash/);
  assert.match(atomicMigration, /security definer/);
  assert.match(atomicMigration, /exception when others/);
  assert.match(atomicMigration, /commercial_campaign_import_entities/);
  assert.match(atomicMigration, /grant execute on function public\.import_commercial_campaign_atomic/);
  assert.match(atomicMigration, /exception when others/);
  assert.match(atomicMigration, /create temporary table campaign_fact_keys/);
  assert.match(atomicMigration, /campaign_import_unknown/);
  assert.doesNotMatch(atomicMigration, /insert into public\.(sales|quotes|crm_activities|stock_movements|financial_entries)/);
});

test('importação atômica falha fechada sem membership e corrige colisões de UUID', () => {
  assert.match(atomicMigration, /actor_role not in \('admin', 'gestor', 'comercial'\)/);
  assert.match(atomicHardeningMigration, /actor_role is null or actor_role not in/);
  assert.match(atomicHardeningMigration, /array_agg\(id order by id\)/);
  assert.match(atomicHardeningMigration, /stored_fact_id uuid/);
});

test('importação 19.6D usa matching set-based e índices funcionais sem alterar a atomicidade', () => {
  assert.match(setBasedMigration, /create index if not exists customers_company_normalized_name_idx/);
  assert.match(setBasedMigration, /create index if not exists products_company_normalized_sku_idx/);
  assert.match(setBasedMigration, /create temporary table campaign_customer_map/);
  assert.match(setBasedMigration, /create temporary table campaign_product_map/);
  assert.match(setBasedMigration, /insert into public\.commercial_campaign_facts[\s\S]*select/);
  assert.match(setBasedMigration, /insert into public\.commercial_campaign_targets[\s\S]*select/);
  assert.match(setBasedMigration, /get diagnostics facts_created = row_count/);
  assert.match(setBasedMigration, /get diagnostics targets_created = row_count/);
  assert.match(setBasedMigration, /auth\.uid\(\) is null or actor_role not in/);
  assert.match(setBasedMigration, /company_id = p_target_company/);
  assert.match(setBasedMigration, /exception when others/);
  assert.doesNotMatch(setBasedMigration, /insert into public\.(sales|quotes|crm_activities|stock_movements|financial_entries)/);
  assert.doesNotMatch(setBasedMigration, /for row in select \* from jsonb_array_elements\(p_history_rows\)/);
  assert.doesNotMatch(setBasedMigration, /for row in select \* from jsonb_array_elements\(p_action_rows\)/);
});

test('19.6F não escolhe UUID arbitrariamente e bloqueia duplicidades', () => {
  assert.match(uuidMatchingMigration, /create or replace function public\.import_commercial_campaign_atomic/);
  assert.match(uuidMatchingMigration, /case when count\(c\.id\) = 1 then \(array_agg\(c\.id\)\)\[1\] else null end/);
  assert.match(uuidMatchingMigration, /count\(\*\) filter \(where match_count > 1\)/);
  assert.match(uuidMatchingMigration, /where match_count = 1 and customer_id is not null/);
  assert.match(uuidMatchingMigration, /where match_count = 1 and product_id is not null/);
  assert.match(uuidMatchingMigration, /matches\.match_count = 1/);
  assert.match(uuidMatchingMigration, /matches\.match_type = 'sku'/);
  assert.doesNotMatch(uuidMatchingMigration, /set customer_id = c\.id/);
  assert.doesNotMatch(uuidMatchingMigration, /set product_id = p\.id/);
  assert.match(uuidMatchingMigration, /match_count = 1 and cm\.customer_id is not null/);
  assert.match(uuidMatchingMigration, /match_count = 1 and pm\.product_id is not null/);
  assert.doesNotMatch(uuidMatchingMigration, /min\s*\(\s*c\.id\s*\)/i);
  assert.doesNotMatch(uuidMatchingMigration, /max\s*\(\s*c\.id\s*\)/i);
  assert.doesNotMatch(uuidMatchingMigration, /min\s*\(\s*p\.id\s*\)/i);
  assert.match(uuidMatchingMigration, /actor_role is null or actor_role not in/);
  assert.match(uuidMatchingMigration, /security definer/);
  assert.match(uuidMatchingMigration, /set search_path = public/);
  assert.match(uuidMatchingMigration, /grant execute on function public\.import_commercial_campaign_atomic/);
});

test('19.6F preserva as regras 0/1/múltiplas correspondências para clientes e produtos', () => {
  const customers = [
    { id: 'c1', name: 'Cliente Único' },
    { id: 'c2', name: 'Duplicado' },
    { id: 'c3', name: 'duplicado' },
  ];
  assert.equal(matchCustomer('Cliente novo', customers).status, 'new');
  assert.equal(matchCustomer('Cliente Único', customers).matches.length, 1);
  assert.equal(matchCustomer('DUPLICADO', customers).status, 'ambiguous');

  const products = [
    { id: 'p1', sku: 'SKU-1', name: 'Produto único' },
    { id: 'p2', sku: 'SKU-DUP', name: 'Produto A' },
    { id: 'p3', sku: 'sku-dup', name: 'Produto B' },
  ];
  assert.equal(matchProduct({ code: 'SKU-NOVO', name: 'Novo' }, products).status, 'new');
  assert.equal(matchProduct({ code: 'SKU-1', name: 'qualquer' }, products).status, 'exact');
  assert.equal(matchProduct({ code: 'SKU-DUP', name: 'qualquer' }, products).status, 'ambiguous');
  assert.equal(matchProduct({ code: '', name: 'Produto A' }, products).status, 'probable');
});

test('19.6G atualiza o catálogo temporário após criar produtos novos', () => {
  assert.match(productCatalogRefreshMigration, /create or replace function|pg_get_functiondef/);
  assert.match(productCatalogRefreshMigration, /insert into campaign_product_catalog\(id, sku_key, name_key\)/);
  assert.match(productCatalogRefreshMigration, /not exists \(select 1 from campaign_product_catalog c where c\.id = p\.id\)/);
  assert.match(productCatalogRefreshMigration, /p\.company_id = p_target_company/);
  assert.match(productCatalogRefreshMigration, /old_anchor text := 'update campaign_product_map m'/);
  assert.match(productCatalogRefreshMigration, /function_sql := replace\(function_sql, old_anchor, new_anchor\)/);
  assert.doesNotMatch(productCatalogRefreshMigration, /min\s*\(\s*[cp]\.id\s*\)/i);
  assert.doesNotMatch(productCatalogRefreshMigration, /max\s*\(\s*[cp]\.id\s*\)/i);
});

test('produto importado sem custo usa zero canônico com origem explicitamente desconhecida', () => {
  const payload = buildAtomicCampaignPayload({
    sourceFileName: 'origem.xlsx', sourceFileHash: 'hash', managementSummary: {},
    customerRows: [{ name: 'Cliente A' }],
    productRows: [{ name: 'Produto sem custo', sku: 'SKU-1' }],
    historyRows: [], actionRows: [],
  });
  assert.equal(payload.p_product_rows[0].cost, null);
  assert.match(atomicMigration, /campaign_import_unknown/);
  assert.match(atomicMigration, /coalesce\(public\.commercial_campaign_parse_numeric\(row->>'cost'\), 0\)/);
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
  const campaignLib = fs.readFileSync(new URL('../src/lib/commercialCampaign.js', import.meta.url), 'utf8');
  assert.match(service, /buildAtomicCampaignPayload/);
  assert.match(service, /rpc\('import_commercial_campaign_atomic'/);
  assert.match(campaignLib, /p_history_rows/);
  assert.match(campaignLib, /p_action_rows/);
});

test('importação persistida mantém prioridade de origem, fila não trabalhada e sem CRM automático', () => {
  const page = fs.readFileSync(new URL('../src/pages/Campanhas.jsx', import.meta.url), 'utf8');
  const provider = fs.readFileSync(new URL('../src/data/providers/supabaseProvider.js', import.meta.url), 'utf8');
  assert.match(page, /PersistedQueue/);
  assert.match(page, /NOT_CONTACTED/);
  assert.match(page, /AUTORIZO IMPORTAÇÃO REAL NO F7 TESTE BETA/);
  assert.match(provider, /async bulkCreate\(payloads\)/);
  assert.match(provider, /cost_source/);
});

test('frontend só confirma sucesso com import batch persistido', () => {
  const page = fs.readFileSync(new URL('../src/pages/Campanhas.jsx', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../src/services/commercialCampaignService.js', import.meta.url), 'utf8');
  assert.match(service, /listSuccessfulCampaignImports/);
  assert.match(page, /result\.status === 'imported'/);
  assert.match(page, /Campanha importada com sucesso/);
  assert.match(page, /Prévia · sem gravação/);
  assert.match(page, /Importando campanha/);
  assert.match(page, /Importação não concluída/);
  assert.match(page, /imported\?\.campaign_id/);
  assert.doesNotMatch(page, /const campaign = campaigns\[0\]/);
});

test('frontend não promove batch sem fatos e targets a sucesso operacional', () => {
  const page = fs.readFileSync(new URL('../src/pages/Campanhas.jsx', import.meta.url), 'utf8');
  assert.match(page, /const partial = Number\(imported\.rows_total \|\| 0\) > 0/);
  assert.match(page, /setImportState\(partial \? 'partial' : 'success'\)/);
  assert.match(page, /Importação parcial detectada/);
  assert.match(page, /persisted && !persisted\.partial/);
  assert.match(page, /campaign-status-banner/);
  assert.match(page, /bg-rose-950\/40/);
});

test('payload de volume 19.6D é preparado sem matching repetitivo', () => {
  const customerRows = Array.from({ length: 291 }, (_, index) => ({ name: `Cliente ${index + 1}` }));
  const productRows = Array.from({ length: 32 }, (_, index) => ({ name: `Produto ${index + 1}`, sku: `SKU-${index + 1}` }));
  const historyRows = Array.from({ length: 731 }, (_, index) => ({ customer: `Cliente ${(index % 291) + 1}`, code: `SKU-${(index % 32) + 1}`, product: `Produto ${(index % 32) + 1}`, baseValue: 100, compareValue: 75 }));
  const actionRows = Array.from({ length: 329 }, (_, index) => ({ customer: `Cliente ${(index % 291) + 1}`, code: `SKU-${(index % 32) + 1}`, product: `Produto ${(index % 32) + 1}`, baseValue: 100, compareValue: 75, priority: index < 244 ? 'P1' : index < 265 ? 'P2' : 'P3' }));
  const payload = buildAtomicCampaignPayload({ sourceFileName: 'volume.xlsx', sourceFileHash: 'volume-hash', managementSummary: {}, customerRows, productRows, historyRows, actionRows });
  assert.equal(payload.p_customer_rows.length, 291);
  assert.equal(payload.p_product_rows.length, 32);
  assert.equal(payload.p_history_rows.length, 731);
  assert.equal(payload.p_action_rows.length, 329);
});
