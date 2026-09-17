import { supabaseProvider } from '@/data/providers/supabaseProvider';
import { buildCampaignPreview, campaignTargetFromFact, normalizeCampaignText, reconcileCampaignValues, summarizeCampaignUniverses } from '@/lib/commercialCampaign';

const workbookHeaders = {
  priority: ['prioridade', 'priority'],
  customer: ['cliente', 'customer'],
  code: ['codigo', 'código', 'sku', 'part number'],
  product: ['produto', 'descricao', 'descrição', 'item'],
  baseValue: ['fy2025', 'base', 'ano base'],
  compareValue: ['fy2026', 'compare', 'ano comparado'],
  sourceDifference: ['variação r$', 'variacao r$', 'diferença r$', 'diferenca r$'],
  sourcePotential: ['oportunidade r$', 'potencial r$', 'potential'],
  sourceVariationPct: ['variação %', 'variacao %', 'percentual', 'queda %'],
};

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function getValue(row, headers, aliases) {
  const index = headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
  return index < 0 ? null : row[index];
}

export function parseActionSheetRows(rows, sheet = 'Plano de Acao') {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = rows[0] || [];
  return rows.slice(1).map((row, index) => ({
    sheet,
    sourceRow: index + 2,
    priority: getValue(row, headers, workbookHeaders.priority),
    customer: getValue(row, headers, workbookHeaders.customer),
    code: getValue(row, headers, workbookHeaders.code),
    product: getValue(row, headers, workbookHeaders.product),
    baseValue: getValue(row, headers, workbookHeaders.baseValue),
    compareValue: getValue(row, headers, workbookHeaders.compareValue),
    sourceDifference: getValue(row, headers, workbookHeaders.sourceDifference),
    sourcePotential: getValue(row, headers, workbookHeaders.sourcePotential),
    sourceVariationPct: getValue(row, headers, workbookHeaders.sourceVariationPct),
  })).filter((row) => row.customer || row.code || row.product);
}

export async function parseWorkbookFile(file) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets['Plano de Acao'] || workbook.Sheets['Plano de Ação'];
  if (!sheet) throw new Error('A planilha precisa conter a aba Plano de Acao.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  return parseActionSheetRows(rows, 'Plano de Acao');
}

export async function parseCampaignWorkbook(file) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const read = (name) => workbook.Sheets[name] ? XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null }) : [];
  const actionRows = await parseWorkbookFile(file);
  const historyRows = read('Cliente x Item').map((row, index) => ({
    sheet: 'Cliente x Item', sourceRow: index + 2, customer: row.Cliente, code: row['Código'], product: row['Descrição'], baseValue: row.FY2025, compareValue: row.FY2026, sourceDifference: row['Variação R$'], sourceVariationPct: row['Variação %'], sourceStatus: row.Status,
  })).filter((row) => row.customer || row.code || row.product);
  const customerRows = read('Clientes').map((row) => ({ name: String(row.Cliente || '').trim() })).filter((row) => row.name);
  const productRows = read('Itens').map((row) => ({ name: String(row['Descrição'] || '').trim(), sku: row['Código'] == null ? null : String(row['Código']).trim() })).filter((row) => row.name || row.sku);
  const managementGrid = workbook.Sheets['Gestao Campanha'] ? XLSX.utils.sheet_to_json(workbook.Sheets['Gestao Campanha'], { header: 1, defval: null }) : [];
  const management = Object.fromEntries(managementGrid.map((row) => [normalizeCampaignText(row?.[0]), row?.[1]]));
  const managementSummary = { opportunities: Number(management['OPORTUNIDADES MAPEADAS'] || 0) || null, potential: Number(management['VALOR TOTAL DE OPORTUNIDADE'] || 0) || null, p1: Number(management['PRIORIDADE P1'] || 0) || null, p2: Number(management['PRIORIDADE P2'] || 0) || null, p3: Number(management['PRIORIDADE P3'] || 0) || null };
  return { actionRows, historyRows, customerRows, productRows, managementSummary, sourceFileName: file.name, sourceFileHash: await hashFile(file) };
}

async function hashFile(file) {
  if (!globalThis.crypto?.subtle) return `${file.name}:${file.size}:${file.lastModified}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function bulkCreateInChunks(entityName, payloads, size = 100) {
  const entity = supabaseProvider.entity(entityName);
  const created = [];
  for (let index = 0; index < payloads.length; index += size) created.push(...await entity.bulkCreate(payloads.slice(index, index + size)));
  return created;
}

function nameMap(records) {
  return new Map((records || []).map((record) => [normalizeCampaignText(record.name), record]));
}

function skuMap(records) {
  return new Map((records || []).filter((record) => record.sku).map((record) => [normalizeCampaignText(record.sku), record]));
}

export async function importCommercialCampaign({ company, file }) {
  if (!company?.id || !company?.name) throw new Error('Empresa não selecionada.');
  const workbook = await parseCampaignWorkbook(file);
  const existingImports = await supabaseProvider.entity('CommercialCampaignImport').filter({ company_id: company.id, file_hash: workbook.sourceFileHash }, '-created_at', 1);
  if (existingImports.length) return { alreadyImported: true, campaignId: existingImports[0].campaign_id, importId: existingImports[0].id };

  const campaignName = 'Campanha Lubrificantes FY2025 x FY2026';
  const existingCampaigns = await supabaseProvider.entity('CommercialCampaign').filter({ company_id: company.id, name: campaignName }, '-created_at', 1);
  const campaign = existingCampaigns[0] || await supabaseProvider.entity('CommercialCampaign').create({ company_id: company.id, name: campaignName, description: 'Recuperação comercial FY2025 x FY2026.', campaign_type: 'commercial_recovery', base_period: 'FY2025', compare_period: 'FY2026', status: 'active', source_file_name: workbook.sourceFileName, source_file_hash: workbook.sourceFileHash });
  const catalogBefore = await loadTenantCatalog(company.id);
  const existingCustomers = nameMap(catalogBefore.customers);
  const existingProducts = skuMap(catalogBefore.products);
  await bulkCreateInChunks('Customer', workbook.customerRows.filter((row) => !existingCustomers.has(normalizeCampaignText(row.name))).map((row) => ({ company_id: company.id, name: row.name })));
  await bulkCreateInChunks('Product', workbook.productRows.filter((row) => !row.sku || !existingProducts.has(normalizeCampaignText(row.sku))).map((row) => ({ company_id: company.id, name: row.name, sku: row.sku })));
  const catalog = await loadTenantCatalog(company.id);
  const customers = nameMap(catalog.customers);
  const products = skuMap(catalog.products);
  const canonicalPotential = workbook.actionRows.reduce((sum, row) => sum + (reconcileCampaignValues(row).potential || 0), 0);
  const imported = await supabaseProvider.entity('CommercialCampaignImport').create({ company_id: company.id, campaign_id: campaign.id, file_name: workbook.sourceFileName, file_hash: workbook.sourceFileHash, status: 'imported', source_metadata: { workbook: workbook.sourceFileName, sheets: { clientes: workbook.customerRows.length, itens: workbook.productRows.length, cliente_x_item: workbook.historyRows.length, plano_de_acao: workbook.actionRows.length }, management_summary: workbook.managementSummary, divergence: { opportunities: (workbook.managementSummary.opportunities || 0) - workbook.actionRows.length, potential: (workbook.managementSummary.potential || 0) - canonicalPotential }, canonical_action_potential: canonicalPotential }, rows_total: workbook.historyRows.length + workbook.actionRows.length, rows_valid: workbook.historyRows.length + workbook.actionRows.length, rows_review: 0, rows_rejected: 0 });
  const facts = await bulkCreateInChunks('CommercialCampaignFact', workbook.historyRows.map((row) => {
    const customer = customers.get(normalizeCampaignText(row.customer));
    const product = products.get(normalizeCampaignText(row.code));
    const values = reconcileCampaignValues(row);
    return { company_id: company.id, campaign_id: campaign.id, import_id: imported.id, customer_id: customer?.id || null, product_id: product?.id || null, period_base: 'FY2025', period_compare: 'FY2026', source_sheet: row.sheet, source_row: row.sourceRow, source_customer_name: row.customer || null, source_product_code: row.code || null, source_product_name: row.product || null, source_values: { status: row.sourceStatus || null }, source_base_value: values.sourceBaseValue ?? values.base, source_compare_value: values.sourceCompareValue ?? values.compare, source_difference: values.sourceDifference, source_potential: values.sourcePotential, source_variation_pct: values.sourceVariationPct, canonical_base_value: values.base, canonical_compare_value: values.compare, canonical_difference: values.difference, canonical_variation_pct: values.variationPct, divergence: values.divergence, divergence_details: values.divergenceDetails, match_status: customer && product ? 'exact' : 'invalid', review_reason: customer && product ? null : 'Cadastro não localizado após importação', idempotency_key: `history:${row.sourceRow}:${normalizeCampaignText(row.customer)}:${normalizeCampaignText(row.code)}` };
  }));
  const factsByKey = new Map(facts.map((fact) => [`${normalizeCampaignText(fact.source_customer_name)}:${normalizeCampaignText(fact.source_product_code)}`, fact]));
  const targets = await bulkCreateInChunks('CommercialCampaignTarget', workbook.actionRows.map((row) => {
    const fact = factsByKey.get(`${normalizeCampaignText(row.customer)}:${normalizeCampaignText(row.code)}`);
    const values = reconcileCampaignValues(row);
    return { company_id: company.id, campaign_id: campaign.id, import_id: imported.id, fact_id: fact?.id || null, customer_id: customers.get(normalizeCampaignText(row.customer))?.id || null, product_id: products.get(normalizeCampaignText(row.code))?.id || null, source_sheet: row.sheet, source_row: row.sourceRow, imported_priority: String(row.priority || '').match(/P[123]/)?.[0] || null, f7_priority: null, status: 'NOT_CONTACTED', reason: row.reason || null, action: row.action || null, next_action: null, return_at: null, informed_recovery_amount: 0, canonical_potential: values.potential, match_status: fact ? 'exact' : 'invalid', review_reason: fact ? null : 'Fato histórico não localizado', idempotency_key: `target:${row.sourceRow}:${normalizeCampaignText(row.customer)}:${normalizeCampaignText(row.code)}` };
  }));
  return { alreadyImported: false, campaign, imported, counts: { customers: workbook.customerRows.length, products: workbook.productRows.length, facts: facts.length, targets: targets.length } };
}

export async function loadTenantCatalog(companyId) {
  if (!companyId) throw new Error('Empresa não selecionada.');
  const [customers, products] = await Promise.all([
    supabaseProvider.entity('Customer').filter({ company_id: companyId }, 'name', 1000),
    supabaseProvider.entity('Product').filter({ company_id: companyId }, 'name', 1000),
  ]);
  return { customers, products };
}

export async function buildTenantCampaignPreview({ companyId, rows }) {
  const catalog = await loadTenantCatalog(companyId);
  return buildCampaignPreview({ rows, ...catalog });
}

export async function buildFullCampaignPreview({ companyId, workbook }) {
  const catalog = await loadTenantCatalog(companyId);
  return {
    ...summarizeCampaignUniverses({ ...workbook, ...catalog }),
    persisted: false,
  };
}

export function buildPreviewTargetRows(preview) {
  return (preview?.facts || []).map((fact) => campaignTargetFromFact(fact, fact.source?.priority));
}

export const campaignEntities = Object.freeze({
  campaigns: 'CommercialCampaign',
  imports: 'CommercialCampaignImport',
  facts: 'CommercialCampaignFact',
  targets: 'CommercialCampaignTarget',
  outcomes: 'CommercialCampaignOutcome',
});

export async function listCampaigns(companyId) {
  return supabaseProvider.entity(campaignEntities.campaigns).filter({ company_id: companyId }, '-created_at', 100);
}

export async function recordCampaignReview({ companyId, targetId, decision, reviewReason }) {
  if (!['existing', 'new', 'ignore'].includes(decision)) throw new Error('Decisão de revisão inválida.');
  return supabaseProvider.entity(campaignEntities.targets).update(targetId, { company_id: companyId, match_status: decision === 'existing' ? 'reviewed' : decision === 'new' ? 'new' : 'invalid', review_reason: reviewReason || null });
}
