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
