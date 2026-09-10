export const CONFIDENCE_LEVELS = ['CONFIRMED', 'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA'] as const;
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number];

export type ProductIntelligenceSourceType = 'internal_catalog' | 'company_official' | 'manufacturer_official' | 'distributor' | 'public_web' | 'approved_catalog';
export type ProductIntelligenceSourceResult = {
  source_type: ProductIntelligenceSourceType;
  source_name: string;
  url: string | null;
  retrieved_at: string;
  manufacturer: string | null;
  part_number: string | null;
  oem_number: string | null;
  alternate_numbers: string[];
  product_name: string | null;
  description: string | null;
  application: string | null;
  machine_model: string | null;
  machine_year: string | null;
  serial_range: string | null;
  system: string | null;
  assembly: string | null;
  position: string | null;
  side: string | null;
  specifications: Record<string, unknown>;
  price: number | null;
  availability: string | null;
  evidence: string[];
  confidence: number;
};

export type ProductCandidate = ProductIntelligenceSourceResult & {
  application_match: number;
  source_confidence: number;
  overall_confidence: number;
  confidence_level: ConfidenceLevel;
  supporting_sources: ProductIntelligenceSourceResult[];
  conflicting_sources: ProductIntelligenceSourceResult[];
  missing_information: string[];
};

export function normalizePartNumber(value: unknown) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR').replace(/[\s._/\\-]+/g, '');
}

function numericConfidence(candidate: any) {
  const value = Number(candidate?.overall_confidence ?? candidate?.confidence ?? candidate?.source_confidence ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function sourceRefs(candidate: any) {
  const raw = Array.isArray(candidate?.supporting_sources) ? candidate.supporting_sources : Array.isArray(candidate?.source_refs) ? candidate.source_refs : [];
  return raw.map((source: any) => typeof source === 'string' ? source : source?.url || source?.source_url || source?.source_name).filter(Boolean).map((source: any) => text(source, 500));
}

export function mergeProductIntelligenceCandidates(...groups: any[][]) {
  const byPart = new Map<string, any>();
  for (const candidate of groups.flatMap((group) => Array.isArray(group) ? group : [])) {
    const partNumber = text(candidate?.part_number || candidate?.oem_number || candidate?.sku, 100);
    const key = normalizePartNumber(partNumber);
    if (!key) continue;
    const confidence = numericConfidence(candidate);
    const score = Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : Math.round(confidence * 100);
    const normalized = { ...candidate, part_number: partNumber, confidence, overall_confidence: confidence, score, confidence_level: candidate?.verification_state === 'verified' ? 'CONFIRMED' : confidenceLevel(confidence), evidence: Array.isArray(candidate?.evidence) ? candidate.evidence.slice(0, 10) : [], supporting_sources: sourceRefs(candidate), evidence_count: Number(candidate?.evidence_count) || Math.max(1, sourceRefs(candidate).length), is_official: candidate?.is_official === true || candidate?.source_type === 'manufacturer_official' || candidate?.verification_state === 'verified' };
    const current = byPart.get(key);
    if (!current) { byPart.set(key, normalized); continue; }
    const preferred = normalized.score > current.score ? normalized : current;
    const sources = [...new Set([...sourceRefs(current), ...sourceRefs(normalized)])].slice(0, 20);
    const evidence = [...new Set([...(Array.isArray(current.evidence) ? current.evidence : []), ...(Array.isArray(normalized.evidence) ? normalized.evidence : [])])].slice(0, 10);
    const combinedConfidence = Math.max(numericConfidence(current), confidence, sources.length >= 2 ? 0.82 : 0);
    byPart.set(key, { ...current, ...preferred, confidence: combinedConfidence, overall_confidence: combinedConfidence, confidence_level: current.confidence_level === 'CONFIRMED' || normalized.confidence_level === 'CONFIRMED' ? 'CONFIRMED' : confidenceLevel(combinedConfidence), score: Math.max(current.score || 0, score) + Math.min(15, sources.length * 3), is_official: Boolean(current.is_official || normalized.is_official), supporting_sources: sources, evidence, evidence_count: Math.max(Number(current.evidence_count) || 1, Number(normalized.evidence_count) || 1, sources.length) });
  }
  return [...byPart.values()].sort((a, b) => (b.confidence_level === 'CONFIRMED' ? 1 : 0) - (a.confidence_level === 'CONFIRMED' ? 1 : 0) || Number(b.score || 0) - Number(a.score || 0) || numericConfidence(b) - numericConfidence(a));
}

function text(value: unknown, max = 500) { return String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max); }
function terms(value: unknown) { return new Set(text(value, 4000).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9][a-z0-9_-]{2,}/g) || []); }
function confidenceLevel(value: number): ConfidenceLevel { return value >= 0.95 ? 'CONFIRMED' : value >= 0.8 ? 'HIGH' : value >= 0.6 ? 'MEDIUM' : value > 0 ? 'LOW' : 'INSUFFICIENT_DATA'; }

export const CompanyInternalCatalogSource = Object.freeze({
  name: 'CompanyInternalCatalogSource',
  type: 'internal_catalog' as const,
  async search(input: { query?: string; products?: any[] }): Promise<ProductIntelligenceSourceResult[]> {
    const queryTerms = terms(input.query);
    return (input.products || []).map((product) => {
      const haystack = terms([product.name, product.sku, product.brand, product.category, product.description, product.short_description].join(' '));
      const matched = [...queryTerms].filter((term) => haystack.has(term)).length;
      if (!matched) return null;
      const partNumber = product.sku || product.barcode || null;
      return {
        source_type: 'internal_catalog', source_name: CompanyInternalCatalogSource.name, url: null, retrieved_at: new Date().toISOString(),
        manufacturer: product.brand || null, part_number: partNumber, oem_number: null, alternate_numbers: [], product_name: product.name || null,
        description: product.short_description || product.description || null, application: null, machine_model: null, machine_year: null,
        serial_range: null, system: null, assembly: null, position: null, side: null, specifications: {}, price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
        availability: Number(product.stock) > 0 ? 'in_stock' : 'out_of_stock', evidence: [`Produto cadastrado pela empresa: ${text(product.name, 160)}`], confidence: matched >= 2 ? 0.98 : 0.9,
      } satisfies ProductIntelligenceSourceResult;
    }).filter(Boolean) as ProductIntelligenceSourceResult[];
  },
});

export const ProductIntelligenceRegistry = Object.freeze({
  internal: CompanyInternalCatalogSource,
  sources: [CompanyInternalCatalogSource],
  select(input: { query?: string; manufacturer?: string }) {
    // Manufacturer adapters are selected by context in future registrations;
    // no manufacturer is hardcoded into the global resolver.
    return this.sources.filter((source) => source.type === 'internal_catalog' || !input.manufacturer);
  },
});

export function needExternalResearch(input: { internalCandidates?: ProductCandidate[]; userAskedExternal?: boolean; technical?: boolean }) {
  return Boolean(input.userAskedExternal || input.technical || !(input.internalCandidates || []).some((candidate) => candidate.confidence_level === 'CONFIRMED' || candidate.confidence_level === 'HIGH'));
}

export async function resolveProductOrPart(input: { company_id: string; query: string; products?: any[]; verified_applications?: any[]; cross_references?: any[]; verified_knowledge?: any[]; external_candidates?: any[]; manufacturer?: string; model?: string; year?: string | number; chassis?: string; serial_number?: string; old_part_number?: string; system?: string; assembly?: string; position?: string; side?: string }) {
  const internal = await CompanyInternalCatalogSource.search({ query: input.query, products: input.products });
  const internalCandidates: ProductCandidate[] = internal.map((source) => ({ ...source, application_match: 0.8, source_confidence: source.confidence, overall_confidence: source.confidence * 0.8, confidence_level: confidenceLevel(source.confidence * 0.8), supporting_sources: [source], conflicting_sources: [], missing_information: [] }));
  const verifiedCandidates = (input.verified_applications || []).filter((row) => row?.verification_state === 'verified').map((row) => ({ part_number: row.part_number, manufacturer: row.manufacturer, model: row.machine_model, application: [row.machine_model, row.machine_year, row.system, row.assembly, row.position].filter(Boolean).join(' '), serial_range: row.serial_range, source_type: 'verified_application', source_name: 'verified_product_applications', source_refs: row.source_refs, verification_state: row.verification_state, confidence: 1, score: 130, evidence: ['Aplicação confirmada por usuário autorizado.'] }));
  const crossReferenceCandidates = (input.cross_references || []).map((row) => ({ part_number: row.equivalent_part_number, manufacturer: row.equivalent_manufacturer, application: row.relation_type, source_type: 'verified_cross_reference', source_name: 'part_cross_references', confidence: Number(row.confidence) || 0.6, score: row.relation_type === 'OEM_EQUIVALENT' ? 105 : 80, evidence: Array.isArray(row.evidence) ? row.evidence : [], supporting_sources: Array.isArray(row.evidence) ? row.evidence : [] }));
  const knowledgeCandidates = (input.verified_knowledge || []).filter((row) => row?.knowledge_type === 'product_knowledge' && row?.fact_value && typeof row.fact_value === 'object').map((row) => ({ part_number: row.fact_value.part_number || row.fact_value.pn, manufacturer: row.fact_value.manufacturer, application: row.fact_value.application, source_type: 'company_verified_knowledge', source_name: row.subject_key, confidence: Number(row.confidence) || 0, score: Math.round((Number(row.confidence) || 0) * 110), evidence: [row.fact_key], supporting_sources: row.source_ref ? [row.source_ref] : [] }));
  const candidates = mergeProductIntelligenceCandidates(internalCandidates, verifiedCandidates, crossReferenceCandidates, knowledgeCandidates, input.external_candidates || []);
  const missing_information = [
    !input.manufacturer && /\b(oem|pn|p\/n|part.?number|pe[cç]a|c[oó]digo)\b/i.test(input.query) ? 'manufacturer' : null,
    !input.model && /\b(aplica[cç][aã]o|modelo|m[aá]quina|equipamento|ve[ií]culo)\b/i.test(input.query) ? 'model' : null,
    !input.chassis && !input.serial_number && /\b(serial|chassi|pin)\b/i.test(input.query) ? 'serial_or_chassis' : null,
  ].filter(Boolean) as string[];
  const alternatives = candidates.length > 1 ? candidates : [];
  return { query: text(input.query, 1000), candidates, conflict: candidates.filter((candidate: any) => candidate.confidence_level === 'CONFIRMED').length > 1, alternatives, missing_information, need_external_research: needExternalResearch({ internalCandidates: candidates as ProductCandidate[], technical: Boolean(input.model || input.manufacturer), userAskedExternal: false }), sources_consulted: [...internal.map((source) => ({ source_type: source.source_type, source_name: source.source_name, confidence: source.confidence, retrieved_at: source.retrieved_at })), ...verifiedCandidates.map((candidate) => ({ source_type: candidate.source_type, source_name: candidate.source_name, confidence: candidate.confidence, retrieved_at: new Date().toISOString() }))] };
}
