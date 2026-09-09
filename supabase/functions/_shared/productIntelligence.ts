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

export async function resolveProductOrPart(input: { company_id: string; query: string; products?: any[]; manufacturer?: string; model?: string; year?: string | number; chassis?: string; serial_number?: string; old_part_number?: string; system?: string; assembly?: string; position?: string; side?: string }) {
  const internal = await CompanyInternalCatalogSource.search({ query: input.query, products: input.products });
  const candidates: ProductCandidate[] = internal.map((source) => ({ ...source, application_match: 0.8, source_confidence: source.confidence, overall_confidence: source.confidence * 0.8, confidence_level: confidenceLevel(source.confidence * 0.8), supporting_sources: [source], conflicting_sources: [], missing_information: [] }));
  const missing_information = [
    !input.manufacturer && /\b(oem|pn|p\/n|part.?number|pe[cç]a|c[oó]digo)\b/i.test(input.query) ? 'manufacturer' : null,
    !input.model && /\b(aplica[cç][aã]o|modelo|m[aá]quina|equipamento|ve[ií]culo)\b/i.test(input.query) ? 'model' : null,
    !input.chassis && !input.serial_number && /\b(serial|chassi|pin)\b/i.test(input.query) ? 'serial_or_chassis' : null,
  ].filter(Boolean) as string[];
  const byPart = new Map<string, ProductCandidate[]>();
  for (const candidate of candidates) { const key = normalizePartNumber(candidate.part_number || candidate.oem_number || candidate.product_name); byPart.set(key, [...(byPart.get(key) || []), candidate]); }
  const alternatives = [...byPart.values()].filter((group) => group.length > 1).flat();
  return { query: text(input.query, 1000), candidates, conflict: alternatives.length > 1, alternatives, missing_information, need_external_research: needExternalResearch({ internalCandidates: candidates, technical: Boolean(input.model || input.manufacturer), userAskedExternal: false }), sources_consulted: internal.map((source) => ({ source_type: source.source_type, source_name: source.source_name, confidence: source.confidence, retrieved_at: source.retrieved_at })) };
}
