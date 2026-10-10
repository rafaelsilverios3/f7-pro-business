const DIACRITICS = /[\u0300-\u036f]/g;

export const CAMPAIGN_MATCH_STATUS = Object.freeze(['exact', 'probable', 'ambiguous', 'new', 'invalid']);
export const CAMPAIGN_QUEUE_STATUS = Object.freeze(['NOT_CONTACTED', 'CONTACTED', 'RETURN_DUE', 'NEGOTIATING', 'QUOTE', 'RECOVERED', 'LOST']);

export function normalizeCampaignText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateCanonicalValues(baseValue, compareValue) {
  const base = toFiniteNumber(baseValue);
  const compare = toFiniteNumber(compareValue);
  if (base === null || compare === null) return { base, compare, difference: null, variationPct: null, potential: null, valid: false };
  const difference = compare - base;
  const variationPct = base === 0 ? null : difference / base;
  return { base, compare, difference, variationPct, potential: Math.max(0, base - compare), valid: true };
}

/** @param {{baseValue?: unknown, compareValue?: unknown, sourceDifference?: unknown, sourcePotential?: unknown, sourceVariationPct?: unknown}} values */
export function reconcileCampaignValues({ baseValue, compareValue, sourceDifference, sourcePotential, sourceVariationPct }) {
  const canonical = calculateCanonicalValues(baseValue, compareValue);
  const sourceDiff = toFiniteNumber(sourceDifference);
  const sourcePotentialValue = toFiniteNumber(sourcePotential);
  const sourcePct = toFiniteNumber(sourceVariationPct);
  const differenceMismatch = sourceDiff !== null && canonical.difference !== null && Math.abs(sourceDiff - canonical.difference) > 0.005;
  const potentialMismatch = sourcePotentialValue !== null && canonical.potential !== null && Math.abs(sourcePotentialValue - canonical.potential) > 0.005;
  const percentageMismatch = sourcePct !== null && canonical.variationPct !== null && Math.abs(sourcePct - canonical.variationPct) > 0.00005;
  return {
    ...canonical,
    sourceDifference: sourceDiff,
    sourcePotential: sourcePotentialValue,
    sourceVariationPct: sourcePct,
    divergence: differenceMismatch || potentialMismatch || percentageMismatch,
    divergenceDetails: { differenceMismatch, potentialMismatch, percentageMismatch },
  };
}

function exactMatches(records, field, value) {
  const key = normalizeCampaignText(value);
  if (!key) return [];
  return (records || []).filter((record) => normalizeCampaignText(record?.[field]) === key);
}

export function matchCustomer(sourceName, customers = []) {
  const matches = exactMatches(customers, 'name', sourceName);
  if (!normalizeCampaignText(sourceName)) return { status: 'invalid', matches: [], reason: 'Nome do cliente ausente' };
  if (matches.length === 1) return { status: 'probable', matches, reason: 'Nome normalizado coincide; confirmar cadastro antes de importar' };
  if (matches.length > 1) return { status: 'ambiguous', matches, reason: 'Mais de um cadastro com o mesmo nome normalizado' };
  return { status: 'new', matches: [], reason: 'Cliente não encontrado no tenant' };
}

export function matchProduct({ code, name }, products = []) {
  const sourceCode = normalizeCampaignText(code);
  const sourceName = normalizeCampaignText(name);
  const byCode = sourceCode ? products.filter((product) => normalizeCampaignText(product?.sku) === sourceCode || normalizeCampaignText(product?.barcode) === sourceCode) : [];
  if (byCode.length === 1) return { status: 'exact', matches: byCode, reason: 'SKU/código coincide' };
  if (byCode.length > 1) return { status: 'ambiguous', matches: byCode, reason: 'Mais de um produto possui o mesmo código normalizado' };
  const byName = sourceName ? products.filter((product) => normalizeCampaignText(product?.name) === sourceName) : [];
  if (byName.length === 1) return { status: 'probable', matches: byName, reason: 'Descrição coincide; confirmar produto antes de importar' };
  if (byName.length > 1) return { status: 'ambiguous', matches: byName, reason: 'Mais de um produto possui a mesma descrição normalizada' };
  if (!sourceCode && !sourceName) return { status: 'invalid', matches: [], reason: 'Código e descrição ausentes' };
  return { status: 'new', matches: [], reason: 'Produto não encontrado no tenant' };
}

export function buildCampaignFact({ row, sheet, sourceRow, customers, products }) {
  const customer = matchCustomer(row.customer, customers);
  const product = matchProduct({ code: row.code, name: row.product }, products);
  const reconciliation = reconcileCampaignValues({ baseValue: row.baseValue, compareValue: row.compareValue, sourceDifference: row.sourceDifference, sourcePotential: row.sourcePotential, sourceVariationPct: row.sourceVariationPct });
  const matchStatus = [customer.status, product.status].includes('invalid') ? 'invalid'
    : [customer.status, product.status].includes('ambiguous') ? 'ambiguous'
      : [customer.status, product.status].includes('new') ? 'new'
        : [customer.status, product.status].includes('probable') ? 'probable' : 'exact';
  return {
    source: { sheet, sourceRow, priority: row.priority || null, customer: row.customer || null, code: row.code || null, product: row.product || null },
    customerMatch: customer,
    productMatch: product,
    matchStatus,
    reconciliation,
    idempotencyKey: `${sheet}:${sourceRow}:${normalizeCampaignText(row.customer)}:${normalizeCampaignText(row.code || row.product)}`,
  };
}

export function buildCampaignPreview({ rows = [], customers = [], products = [] }) {
  const facts = rows.map((row, index) => buildCampaignFact({ row, sheet: row.sheet || 'Plano de Acao', sourceRow: row.sourceRow || index + 2, customers, products }));
  const counts = facts.reduce((result, fact) => {
    result[fact.matchStatus] = (result[fact.matchStatus] || 0) + 1;
    if (fact.reconciliation.divergence) result.divergences += 1;
    return result;
  }, { exact: 0, probable: 0, ambiguous: 0, new: 0, invalid: 0, divergences: 0 });
  return { facts, counts, total: facts.length, persisted: false };
}

const emptyMatchCounts = () => ({ exact: 0, probable: 0, ambiguous: 0, new: 0, invalid: 0 });

function uniqueBy(rows, key) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const value = normalizeCampaignText(key(row));
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** @param {{ customerRows?: Array<{ id?: string, name?: string }>, productRows?: Array<{ id?: string, name?: string, sku?: string }>, historyRows?: Array<{ customer?: string, code?: string, product?: string, baseValue?: unknown, compareValue?: unknown, sourceDifference?: unknown, sourcePotential?: unknown, sourceVariationPct?: unknown }>, actionRows?: Array<Record<string, unknown>>, managementSummary?: { potential?: number | string, opportunities?: number | string, p1?: number | string, p2?: number | string, p3?: number | string }, customers?: Array<{ id?: string, name?: string }>, products?: Array<{ id?: string, name?: string, sku?: string, barcode?: string }>}} options */
export function summarizeCampaignUniverses({ customerRows = [], productRows = [], historyRows = [], actionRows = [], managementSummary = {}, customers = [], products = [] }) {
  const customerMatches = uniqueBy(customerRows, (row) => row.name).map((row) => ({ ...row, match: matchCustomer(row.name, customers) }));
  const productMatches = uniqueBy(productRows, (row) => row.sku || row.name).map((row) => ({ ...row, match: matchProduct({ code: row.sku, name: row.name }, products) }));
  const customerCounts = emptyMatchCounts();
  const productCounts = emptyMatchCounts();
  customerMatches.forEach((row) => { customerCounts[row.match.status] = (customerCounts[row.match.status] || 0) + 1; });
  productMatches.forEach((row) => { productCounts[row.match.status] = (productCounts[row.match.status] || 0) + 1; });
  const history = (historyRows || []).map((row) => {
    const customer = matchCustomer(row.customer, customers);
    const product = matchProduct({ code: row.code, name: row.product }, products);
    const reconciliation = reconcileCampaignValues(row);
    return { ...row, customerMatch: customer, productMatch: product, reconciliation, ready: customer.status === 'exact' && product.status === 'exact' };
  });
  const action = buildCampaignPreview({ rows: actionRows, customers, products });
  const canonicalPotential = action.facts.reduce((sum, fact) => sum + (fact.reconciliation.potential || 0), 0);
  const managementPotential = Number(managementSummary.potential) || 0;
  const managementOpportunities = Number(managementSummary.opportunities) || 0;
  return {
    customers: { total: customerMatches.length, counts: customerCounts, rows: customerMatches },
    products: { total: productMatches.length, counts: productCounts, rows: productMatches },
    history: { total: history.length, ready: history.filter((row) => row.ready).length, blocked: history.filter((row) => !row.ready).length, divergences: history.filter((row) => row.reconciliation.divergence).length, rows: history },
    action: { total: action.total, counts: action.facts.reduce((result, fact) => { const priority = String(fact.source.priority || '').match(/P[123]/)?.[0]; if (priority) result[priority] += 1; return result; }, { P1: 0, P2: 0, P3: 0 }), potential: canonicalPotential, preview: action },
    management: { opportunities: managementOpportunities, potential: managementPotential, p1: Number(managementSummary.p1) || 0, p2: Number(managementSummary.p2) || 0, p3: Number(managementSummary.p3) || 0 },
    divergence: { opportunities: managementOpportunities - action.total, potential: managementPotential - canonicalPotential },
  };
}

export function campaignTargetFromFact(fact, sourcePriority) {
  const importedPriority = String(sourcePriority || '').match(/P[123]/)?.[0] || null;
  return {
    importedPriority,
    f7Priority: null,
    canonicalPotential: fact.reconciliation.potential,
    matchStatus: fact.matchStatus,
    reviewReason: fact.matchStatus === 'exact' ? null : `${fact.customerMatch.reason}; ${fact.productMatch.reason}`,
    status: 'NOT_CONTACTED',
  };
}

export function buildAtomicCampaignPayload(workbook) {
  return {
    p_file_name: workbook.sourceFileName,
    p_file_hash: workbook.sourceFileHash,
    p_campaign_name: 'Campanha Lubrificantes FY2025 x FY2026',
    p_customer_rows: workbook.customerRows.map((row) => ({ name: row.name })),
    p_product_rows: workbook.productRows.map((row) => ({ name: row.name || null, sku: row.sku || null, cost: row.cost ?? null, price: row.price ?? null, stock: row.stock ?? null, minimum_stock: row.minimum_stock ?? null, unit: row.unit || 'un' })),
    p_history_rows: workbook.historyRows,
    p_action_rows: workbook.actionRows,
    p_management_summary: workbook.managementSummary || {},
  };
}
