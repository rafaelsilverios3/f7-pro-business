import { supabaseProvider } from '@/data/providers/supabaseProvider';
import { buildAtomicCampaignPayload, buildCampaignPreview, campaignTargetFromFact, normalizeCampaignText, summarizeCampaignUniverses } from '@/lib/commercialCampaign';

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

export async function importCommercialCampaign({ company, file }) {
  if (!company?.id || !company?.name) throw new Error('Empresa não selecionada.');
  const workbook = await parseCampaignWorkbook(file);
  const result = await supabaseProvider.rpc('import_commercial_campaign_atomic', { p_target_company: company.id, ...buildAtomicCampaignPayload(workbook) });
  return { alreadyImported: result?.status === 'already_imported', campaignId: result?.campaign_id, importId: result?.import_id, counts: result?.counts || {} };
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
