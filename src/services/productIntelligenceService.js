export const CONFIDENCE_LEVELS = ['CONFIRMED', 'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA'];
export const SOURCE_TYPES = ['internal_catalog', 'company_official', 'manufacturer_official', 'distributor', 'public_web', 'approved_catalog'];

export function normalizePartNumber(value) { return String(value || '').trim().toLocaleUpperCase('pt-BR').replace(/[\s._/\\-]+/g, ''); }
/** @param {Record<string, any>} source */
export function sourceTrustScore(source = {}) {
  const typeScore = { internal_catalog: 1, manufacturer_official: .98, company_official: .92, approved_catalog: .88, distributor: .8, public_web: .55 }[source.source_type] || 0;
  return Math.max(0, Math.min(1, Number(source.confidence ?? typeScore)));
}
/** @param {Record<string, any>} options */
export function needExternalResearch({ candidates = [], userAskedExternal = false, technical = false } = {}) { return Boolean(userAskedExternal || technical || !candidates.some((candidate) => ['CONFIRMED', 'HIGH'].includes(candidate.confidence_level))); }
/** @param {{ sources?: any[] }} options */
export function createProductIntelligenceRegistry({ sources = [] } = {}) { return { sources, select: (input = {}) => { const manufacturer = input.manufacturer; return sources.filter((source) => !source.manufacturer || !manufacturer || source.manufacturer.toLowerCase() === manufacturer.toLowerCase()); } }; }
/** @param {Record<string, any>} options */
export function resolveProductOrPart({ company_id, query, products = [], manufacturer, model, year, chassis, serial_number, system, assembly, position, side } = {}) {
  const normalizedQuery = String(query || '').toLocaleLowerCase('pt-BR');
  const candidates = products.filter((product) => [product.name, product.sku, product.barcode, product.brand, product.description, product.short_description].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').split(/\s+/).some((term) => term.length > 2 && normalizedQuery.includes(term))).map((product) => ({ part_number: product.sku || product.barcode || null, manufacturer: product.brand || null, product_name: product.name, description: product.short_description || product.description || null, price: product.price ?? null, availability: Number(product.stock) > 0 ? 'in_stock' : 'out_of_stock', overall_confidence: .9, confidence_level: 'HIGH', supporting_sources: [{ source_type: 'internal_catalog', source_name: 'CompanyInternalCatalogSource' }], conflicting_sources: [], missing_information: [] }));
  const missing_information = [!manufacturer && /\b(oem|pn|p\/n|part.?number|pe[cç]a|c[oó]digo)\b/i.test(query) ? 'manufacturer' : null, !model && /\bmodelo|m[aá]quina|equipamento|ve[ií]culo\b/i.test(query) ? 'model' : null, !chassis && !serial_number && /\bchassi|serial|pin\b/i.test(query) ? 'serial_or_chassis' : null].filter(Boolean);
  return { company_id, query, candidates, conflict: false, alternatives: [], missing_information, need_external_research: needExternalResearch({ candidates, technical: Boolean(model || manufacturer) }), sources_consulted: [{ source_type: 'internal_catalog', source_name: 'CompanyInternalCatalogSource' }] };
}
