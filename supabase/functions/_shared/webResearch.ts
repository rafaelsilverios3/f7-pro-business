import { evaluateSourceTrust } from './sourceTrust.ts';
import { ManufacturerAdapterRegistry } from './manufacturerAdapterRegistry.ts';
import { AgriculturalPartsSpecialist } from './specialists/agriculturalParts.ts';
import { partitionCandidatesByEligibility, type RejectedCandidateReason } from './evidencePolicy.ts';

export type WebSearchInput = {
  query: string;
  manufacturer?: string;
  part_number?: string;
  model?: string;
  year?: string | number;
  application?: string;
  domains?: string[];
  locale?: string;
  country?: string;
  market?: string;
  region?: string;
  max_results?: number;
};

export type WebSearchResult = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  retrieved_at: string;
  source_type: 'manufacturer_official' | 'distributor' | 'approved_catalog' | 'public_web';
  country?: string | null;
  market?: string | null;
  region?: string | null;
  catalog_id?: string | null;
  catalog_edition?: string | null;
};

export type WebSearchResponse = {
  results: WebSearchResult[];
  provider: string;
  searched: boolean;
  code?: string;
  duration_ms: number;
  queries_executed?: number;
  http_status?: number | null;
  provider_code?: string | null;
  provider_error_message?: string | null;
  parameter_names?: string[];
};

export type ResearchQueryDiagnostic = {
  query_index: number;
  query_length: number;
  manufacturer_present: boolean;
  model_present: boolean;
  part_description_present: boolean;
  code?: string;
  http_status?: number | null;
  provider_code?: string | null;
  provider_error_message?: string | null;
  parameter_names?: string[];
  results_count: number;
  duration_ms: number;
};

export type PageResponse = { url: string; title: string | null; text: string; retrieved_at: string; code?: string };

const MAX_QUERY = 500;
const MAX_SNIPPET = 1000;
const MAX_RESULTS = 10;
const DEFAULT_SEARCH_TIMEOUT = 8000;
const DEFAULT_PAGE_TIMEOUT = 8000;
const MAX_PAGE_BYTES = 1_000_000;
export const RESEARCH_STRATEGY_VERSION = 5;
export const MAX_RESEARCH_ROUNDS = 2;
export const MAX_QUERIES_PER_ROUND = 3;
export const MAX_WEB_QUERIES = 5;
export const MAX_TOTAL_RESULTS = 10;
export const MAX_PAGE_FETCHES = 3;
export const MAX_RESEARCH_DURATION_MS = 15_000;
export const MAX_RESEARCH_COST = 5;
const BLOCKED_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|metadata(?:\.|$)|169\.254\.169\.254)$/i;

function safeText(value: unknown, max: number) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function safeUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port && !['80', '443'].includes(parsed.port)) return null;
    if (BLOCKED_HOSTS.test(parsed.hostname) || /^10\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^fc|^fd|^fe80:/i.test(parsed.hostname)) return null;
    return parsed;
  } catch { return null; }
}
function sourceType(url: URL, domains: string[] = []) {
  const domain = url.hostname.toLocaleLowerCase('en-US');
  if (domains.some((item) => domain === item || domain.endsWith(`.${item}`))) return 'manufacturer_official' as const;
  if (/market|shop|store|parts|distrib|catalog/i.test(domain)) return 'distributor' as const;
  return 'public_web' as const;
}

function regionalEvidence(text: string): Pick<ResearchRegionContext, 'country' | 'market' | 'region'> & { catalog_id?: string; catalog_edition?: string } {
  const value = safeText(text, 2400);
  const catalog_id = value.match(/\bPC\d{4,}\b/i)?.[0]?.toUpperCase();
  const southAmerica = /south\s+america|sul[- ]americana?|brasil|brazil|latam|am[eé]rica\s+do\s+sul/i.test(value);
  const northAmerica = /north\s+america|norte[- ]americana?|united\s+states|\bUSA\b|\bUS\s+edition\b/i.test(value);
  const result: Pick<ResearchRegionContext, 'country' | 'market' | 'region'> & { catalog_id?: string; catalog_edition?: string } = {};
  if (southAmerica && !northAmerica) Object.assign(result, { country: /brasil|brazil/i.test(value) ? 'BR' : undefined, market: /brasil|brazil/i.test(value) ? 'brazil' : 'south_america', region: 'south_america', catalog_id });
  else if (northAmerica && !southAmerica) Object.assign(result, { country: /united\s+states|\bUSA\b|\bUS\s+edition\b/i.test(value) ? 'US' : undefined, market: 'united_states', region: 'north_america', catalog_id });
  else if (catalog_id) result.catalog_id = catalog_id;
  const edition = value.match(/((?:south|north)\s+america(?:n)?|sul[- ]americana?|norte[- ]americana?|US|Brazil|Brasil)\s*(?:edition|edi[cç][aã]o)?/i)?.[0];
  if (edition) result.catalog_edition = safeText(edition, 80);
  return result;
}

function regionalScore(target: ResearchRegionContext, evidence: ReturnType<typeof regionalEvidence>) {
  if (!target.region && !target.country && !target.market) return 0;
  const targetSouth = target.region === 'south_america' || target.country === 'BR' || target.market === 'brazil';
  const targetNorth = target.region === 'north_america' || target.country === 'US' || target.market === 'united_states';
  const evidenceSouth = evidence.region === 'south_america' || evidence.country === 'BR' || evidence.market === 'brazil';
  const evidenceNorth = evidence.region === 'north_america' || evidence.country === 'US' || evidence.market === 'united_states';
  if (targetSouth && evidenceSouth) return 80;
  if (targetNorth && evidenceNorth) return 80;
  if (targetSouth && evidenceNorth) return -45;
  if (targetNorth && evidenceSouth) return -45;
  return 0;
}
function providerConfig() {
  const braveKey = Deno.env.get('BRAVE_SEARCH_API_KEY') || '';
  const endpoint = Deno.env.get('WEB_SEARCH_API_URL') || '';
  const key = Deno.env.get('WEB_SEARCH_API_KEY') || braveKey;
  const provider = (Deno.env.get('WEB_SEARCH_PROVIDER') || (braveKey ? 'brave' : 'disabled')).trim().toLocaleLowerCase('en-US');
  return { endpoint, key, provider };
}

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export function normalizeBraveResponse(payload: any, domains: string[] = [], retrievedAt = new Date().toISOString()): WebSearchResult[] {
  const rows = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return rows.map((row: any) => {
    const parsed = safeUrl(row?.url);
    if (!parsed) return null;
    return {
      title: safeText(row?.title, 240),
      url: parsed.toString(),
      domain: parsed.hostname,
      snippet: safeText(row?.description || row?.snippet, MAX_SNIPPET),
      retrieved_at: retrievedAt,
      source_type: sourceType(parsed, domains),
    } satisfies WebSearchResult;
  }).filter((row: WebSearchResult | null): row is WebSearchResult => Boolean(row)).slice(0, MAX_RESULTS);
}

export interface WebSearchProvider { name: string; search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResponse>; }

export class PublicWebSearchProvider implements WebSearchProvider {
  name = 'PublicWebSearchProvider';
  async search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResponse> {
    const started = Date.now();
    const config = providerConfig();
    if (!config.endpoint || !config.key || config.provider === 'disabled') return { results: [], provider: this.name, searched: false, code: 'WEB_SEARCH_NOT_CONFIGURED', duration_ms: Date.now() - started };
    const endpoint = safeUrl(config.endpoint);
    if (!endpoint) return { results: [], provider: this.name, searched: false, code: 'WEB_SEARCH_ENDPOINT_INVALID', duration_ms: Date.now() - started };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(Deno.env.get('WEB_SEARCH_TIMEOUT_MS') || DEFAULT_SEARCH_TIMEOUT));
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const query = safeText(input.query, MAX_QUERY);
      const response = await fetch(endpoint.toString(), { method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, manufacturer: safeText(input.manufacturer, 160), part_number: safeText(input.part_number, 120), model: safeText(input.model, 120), year: safeText(input.year, 30), application: safeText(input.application, 240), domains: (input.domains || []).slice(0, 10).map((item) => safeText(item, 120)), locale: safeText(input.locale || 'pt-BR', 20), max_results: Math.min(Math.max(Number(input.max_results || 5), 1), MAX_RESULTS) }), signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) return { results: [], provider: this.name, searched: true, code: `WEB_SEARCH_HTTP_${response.status}`, http_status: response.status, duration_ms: Date.now() - started };
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.items) ? payload.items : [];
      const results = rows.map((row: any) => {
        const parsed = safeUrl(row?.url || row?.link || row?.href);
        if (!parsed) return null;
        return { title: safeText(row?.title, 240), url: parsed.toString(), domain: parsed.hostname, snippet: safeText(row?.snippet || row?.description || row?.text, MAX_SNIPPET), retrieved_at: new Date().toISOString(), source_type: sourceType(parsed, input.domains) } satisfies WebSearchResult;
      }).filter((row: WebSearchResult | null): row is WebSearchResult => Boolean(row)).slice(0, MAX_RESULTS);
      return { results, provider: this.name, searched: true, code: results.length ? undefined : 'WEB_SEARCH_NO_RESULTS', http_status: response.status, duration_ms: Date.now() - started };
    } catch (error) { return { results: [], provider: this.name, searched: true, code: error instanceof Error && error.name === 'AbortError' ? 'WEB_SEARCH_TIMEOUT' : 'WEB_SEARCH_FAILED', duration_ms: Date.now() - started }; }
    finally { clearTimeout(timeout); }
  }
}

export class BraveWebSearchProvider implements WebSearchProvider {
  name = 'BraveWebSearchProvider';
  async search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResponse> {
    const started = Date.now();
    const config = providerConfig();
    if (!config.key) return { results: [], provider: this.name, searched: false, code: 'WEB_SEARCH_NOT_CONFIGURED', duration_ms: Date.now() - started, queries_executed: 0 };
    const configuredEndpoint = config.endpoint || BRAVE_ENDPOINT;
    const endpoint = safeUrl(configuredEndpoint);
    if (!endpoint || endpoint.origin !== 'https://api.search.brave.com' || endpoint.pathname !== '/res/v1/web/search') return { results: [], provider: this.name, searched: false, code: 'WEB_SEARCH_ENDPOINT_INVALID', duration_ms: Date.now() - started, queries_executed: 0 };
    endpoint.search = buildBraveSearchParams(input).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(Deno.env.get('WEB_SEARCH_TIMEOUT_MS') || DEFAULT_SEARCH_TIMEOUT));
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(endpoint.toString(), { method: 'GET', headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': config.key }, signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const braveCode = safeText(payload?.error?.code, 80).toUpperCase();
        const providerErrorMessage = safeProviderMessage(payload?.error?.message);
        const code = response.status === 401 || response.status === 403 ? 'WEB_SEARCH_AUTH_ERROR' : response.status === 429 || braveCode === 'RATE_LIMITED' || braveCode === 'QUOTA_LIMITED' ? 'WEB_SEARCH_RATE_LIMITED' : response.status >= 500 ? 'WEB_SEARCH_UNAVAILABLE' : 'WEB_SEARCH_PROVIDER_ERROR';
        return { results: [], provider: this.name, searched: true, code, provider_code: braveCode || null, provider_error_message: providerErrorMessage, parameter_names: ['q', 'count'], http_status: response.status, duration_ms: Date.now() - started, queries_executed: 1 };
      }
      const results = normalizeBraveResponse(payload, input.domains, new Date().toISOString());
      return { results, provider: this.name, searched: true, code: results.length ? undefined : 'WEB_SEARCH_NO_RESULTS', parameter_names: ['q', 'count'], http_status: response.status, duration_ms: Date.now() - started, queries_executed: 1 };
    } catch (error) { return { results: [], provider: this.name, searched: true, code: error instanceof Error && error.name === 'AbortError' ? 'WEB_SEARCH_TIMEOUT' : 'WEB_SEARCH_FAILED', duration_ms: Date.now() - started, queries_executed: 1 }; }
    finally { clearTimeout(timeout); }
  }
}

export function buildBraveSearchParams(input: Pick<WebSearchInput, 'query' | 'max_results'>) {
  return new URLSearchParams({
    q: safeText(input.query, 600),
    count: String(Math.min(Math.max(Number(input.max_results || 5), 1), 5)),
  });
}

function safeProviderMessage(value: unknown) {
  return safeText(String(value || ''), 160)
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|authorization|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

export class UnavailableWebSearchProvider implements WebSearchProvider {
  name = 'UnavailableWebSearchProvider';
  async search(_input: WebSearchInput): Promise<WebSearchResponse> { return { results: [], provider: this.name, searched: false, code: 'WEB_SEARCH_NOT_CONFIGURED', duration_ms: 0 }; }
}

export const WebSearchProviderRegistry = Object.freeze({
  create(): WebSearchProvider {
    const provider = providerConfig().provider;
    if (provider === 'brave') return new BraveWebSearchProvider();
    return provider === 'disabled' ? new UnavailableWebSearchProvider() : new PublicWebSearchProvider();
  },
});

export async function fetchPublicPage(url: string, signal?: AbortSignal): Promise<PageResponse> {
  const parsed = safeUrl(url);
  if (!parsed) return { url: safeText(url, 500), title: null, text: '', retrieved_at: new Date().toISOString(), code: 'WEB_PAGE_URL_BLOCKED' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(Deno.env.get('WEB_PAGE_TIMEOUT_MS') || DEFAULT_PAGE_TIMEOUT));
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(parsed.toString(), { headers: { Accept: 'text/html, text/plain, application/xhtml+xml' }, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) return { url: parsed.toString(), title: null, text: '', retrieved_at: new Date().toISOString(), code: 'WEB_PAGE_REDIRECT_NOT_FOLLOWED' };
    const contentType = response.headers.get('content-type') || '';
    const length = Number(response.headers.get('content-length') || 0);
    if (!response.ok || length > MAX_PAGE_BYTES || !/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType)) return { url: parsed.toString(), title: null, text: '', retrieved_at: new Date().toISOString(), code: 'WEB_PAGE_UNSUPPORTED' };
    const text = safeText(await response.text(), MAX_PAGE_BYTES);
    const title = safeText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 240) || null;
    return { url: parsed.toString(), title, text: text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, MAX_PAGE_BYTES), retrieved_at: new Date().toISOString() };
  } catch (error) { return { url: parsed.toString(), title: null, text: '', retrieved_at: new Date().toISOString(), code: error instanceof Error && error.name === 'AbortError' ? 'WEB_PAGE_TIMEOUT' : 'WEB_PAGE_FETCH_FAILED' }; }
  finally { clearTimeout(timeout); }
}

export type RejectedTechnicalPartCandidate = TechnicalPartCandidate & { rejection_reason: RejectedCandidateReason; rejection_reasons: RejectedCandidateReason[] };
export type TechnicalEvidence = { part_numbers: string[]; manufacturers: string[]; applications: string[]; models: string[]; specifications: string[]; source_urls: string[]; confidence: number; conflicts: string[]; candidates: TechnicalPartCandidate[]; eligible_candidates: TechnicalPartCandidate[]; rejected_candidates: RejectedTechnicalPartCandidate[] };

export type TechnicalPartCandidate = {
  part_number: string;
  description: string | null;
  manufacturer: string | null;
  model?: string | null;
  system?: string | null;
  position?: string | null;
  serial_range?: string | null;
  application: string | null;
  source_url: string;
  source_domain: string;
  source_type: WebSearchResult['source_type'];
  evidence_text: string;
  confidence: number;
  confidence_level: 'DISCOVERED' | 'LIKELY' | 'VERIFIED';
  supporting_sources: string[];
  evidence?: string[];
  evidence_count?: number;
  score?: number;
  is_official?: boolean;
  trust_score?: number;
  trust_level?: 'HIGH_TRUST' | 'MEDIUM_TRUST' | 'LOW_TRUST' | 'INSUFFICIENT_DATA';
  country?: string | null;
  market?: string | null;
  region?: string | null;
  catalog_id?: string | null;
  catalog_edition?: string | null;
};

export type TechnicalResearchQueryInput = {
  manufacturer?: string;
  model?: string;
  year?: string | number;
  part_description?: string;
  system?: string;
  application?: string;
  old_part_number?: string;
  serial?: string;
  user_text?: string;
  country?: string;
  market?: string;
  region?: string;
  locale?: string;
};

export type ResearchRegionContext = { country?: string; market?: string; region?: string; locale?: string };

/** Resolve regional targeting from structured company settings. Free text is deliberately ignored. */
export function resolveResearchRegion(input: { country?: unknown; market?: unknown; region?: unknown; locale?: unknown; language?: unknown } = {}): ResearchRegionContext {
  const country = safeText(input.country, 40).toUpperCase();
  const market = safeText(input.market, 60).toLowerCase();
  const region = safeText(input.region, 60).toLowerCase();
  const locale = safeText(input.locale || input.language, 20);
  if (country || market || region) return { ...(country ? { country } : {}), ...(market ? { market } : {}), ...(region ? { region } : {}), ...(locale ? { locale } : {}) };
  if (/^pt[-_]br$/i.test(locale)) return { country: 'BR', market: 'brazil', region: 'south_america', locale: 'pt-BR' };
  if (/^en[-_]us$/i.test(locale)) return { country: 'US', market: 'united_states', region: 'north_america', locale: 'en-US' };
  return locale ? { locale } : {};
}

export type ResearchFact = {
  field: 'manufacturer' | 'model' | 'equipment_type' | 'part_description';
  value: string;
  provenance: 'customer' | 'company_internal' | 'official_source' | 'public_web' | 'human_agent' | 'historical_verified' | 'inference';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sources: string[];
  source: string | null;
  timestamp: string;
};

export type ResearchState = {
  original_request: string;
  current_objective: string;
  known_facts: ResearchFact[];
  discovered_facts: ResearchFact[];
  unresolved_facts: string[];
  queries_executed: string[];
  sources: string[];
  candidates: TechnicalPartCandidate[];
  conflicts: string[];
  confidence: number;
  evidence: unknown[];
  next_research_step: 'REFINE_SEARCH' | 'PRESENT_RESULTS' | 'ASK_CUSTOMER' | 'HUMAN_HANDOFF' | 'STOP';
};

/** Resolve machine identity from public evidence without making it a prerequisite. */
export function resolveMachineIdentity(results: WebSearchResult[], input: TechnicalResearchQueryInput = {}) {
  const facts: ResearchFact[] = [];
  const model = safeText(input.model, 80);
  if (model) facts.push({ field: 'model', value: model, provenance: 'customer', confidence: 'HIGH', sources: [], source: null, timestamp: new Date().toISOString() });
  const adapterIdentity = ManufacturerAdapterRegistry.resolveMachineIdentity({ model, evidence: results });
  const manufacturer = adapterIdentity?.manufacturer || safeText(input.manufacturer, 120);
  if (manufacturer) {
    const sources: string[] = (Array.isArray(adapterIdentity?.sources) ? adapterIdentity.sources : results.filter((result) => `${result.title} ${result.snippet}`.toLocaleLowerCase().includes(manufacturer.toLocaleLowerCase())).map((result) => result.url).slice(0, 5)).filter((source: unknown): source is string => typeof source === 'string');
    facts.push({ field: 'manufacturer', value: manufacturer, provenance: input.manufacturer ? 'customer' : adapterIdentity?.provenance || 'public_web', confidence: input.manufacturer ? 'HIGH' : adapterIdentity?.confidence || 'MEDIUM', sources, source: sources[0] || null, timestamp: new Date().toISOString() });
  }
  const equipment = adapterIdentity?.equipment_type || undefined;
  if (equipment) { const sources: string[] = (Array.isArray(adapterIdentity?.sources) ? adapterIdentity.sources : results.slice(0, 5).map((result) => result.url)).filter((source: unknown): source is string => typeof source === 'string'); facts.push({ field: 'equipment_type', value: equipment, provenance: adapterIdentity?.provenance || 'public_web', confidence: adapterIdentity?.confidence || 'MEDIUM', sources, source: sources[0] || null, timestamp: new Date().toISOString() }); }
  return { manufacturer: manufacturer || undefined, model: model || undefined, equipment_type: equipment || undefined, facts };
}

export function inferTechnicalResearchInput(text: string, products: any[] = [], settings: Record<string, unknown> = {}): TechnicalResearchQueryInput {
  const value = safeText(text, 1000);
  const year = value.match(/\b(?:19|20)\d{2}\b/)?.[0];
  const codedModel = value.match(/\b(?=[A-Z0-9 -]{3,12}\b)(?=[A-Z0-9 -]*[A-Z])(?=[A-Z0-9 -]*\d)[A-Z]{0,3}\s*\d{2,5}[A-Z]?\b/i)?.[0];
  const namedModel = value.match(/\b([\p{L}][\p{L}-]{2,})\s+(?:19|20)\d{2}\b/iu)?.[1];
  const model = safeText(codedModel || namedModel, 80) || undefined;
  const specificPart = value.match(/\b(filtro\s+(?:de\s+)?(?:combust[ií]vel|[oó]leo|ar)|correia(?:\s+(?:(?:do|da|de)\s+)?[\p{L}-]+){0,2}|corrente(?:\s+(?:(?:do|da|de)\s+)?[\p{L}-]+){0,2}|rolamento(?:\s+(?:(?:do|da|de)\s+)?[\p{L}-]+){0,2}|bomba|alternador|radiador)\b/iu)?.[1];
  const escapedModel = model?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titleCaseManufacturer = escapedModel
    ? value.match(new RegExp(`\\b([\\p{Lu}][\\p{L}-]+(?:\\s+[\\p{Lu}][\\p{L}-]+){0,2})\\s+${escapedModel}\\b`, 'u'))?.[1]
    : undefined;
  const explicitManufacturer = value.match(/\b(?:fabricante|marca)\s*[:=-]?\s*([\p{L}][\p{L}-]+(?:\s+[\p{L}][\p{L}-]+){0,2})/iu)?.[1];
  const adapterManufacturer = ManufacturerAdapterRegistry.select({ text: value })?.manufacturer;
  const relevantCatalogProduct = products.find((product) => {
    const productText = safeText(`${product?.name || ''} ${product?.description || ''} ${product?.sku || ''} ${product?.part_number || ''}`, 600).toLocaleLowerCase('pt-BR');
    return Boolean(product?.brand && ((model && productText.includes(model.toLocaleLowerCase('pt-BR'))) || (specificPart && productText.includes(specificPart.toLocaleLowerCase('pt-BR')))));
  });
  const manufacturer = safeText(explicitManufacturer || adapterManufacturer || titleCaseManufacturer || relevantCatalogProduct?.brand, 120) || undefined;
  const partDescription = specificPart || value.match(/(?:c[oó]digo|pn|p\/?n|part.?number|pe[cç]a)\s+(?:de\s+)?([\wÀ-ÿ -]{3,50})/i)?.[1] || safeText(settings.segment, 80) || value;
  return { manufacturer, model, year, part_description: safeText(partDescription, 180), user_text: value };
}

export function planTechnicalResearchQueries(input: TechnicalResearchQueryInput) {
  const manufacturer = safeText(input.manufacturer, 120);
  const model = safeText(input.model, 120);
  const year = safeText(input.year, 20);
  const part = safeText(input.part_description || input.system || input.application, 180);
  const oldPart = safeText(input.old_part_number, 100);
  const compactPart = part.replace(/\s+/g, ' ').trim();
  const translatedPart = compactPart.replace(/filtro\s+(?:de\s+)?combust[ií]vel/gi, 'fuel filter').replace(/filtro\s+(?:de\s+)?[oó]leo/gi, 'oil filter');
  const base = [manufacturer, model, year, compactPart].filter(Boolean).join(' ');
  const adapter = ManufacturerAdapterRegistry.select({ manufacturer, text: input.user_text });
  const officialDomain = adapter?.official_domains[0];
  const queries = [
    ...(adapter?.buildOfficialQueries({ model, part_description: compactPart, old_part_number: oldPart, country: input.country, market: input.market, region: input.region, locale: input.locale }) || []),
    manufacturer && model && compactPart && officialDomain ? `site:${officialDomain} ${model} ${compactPart} part number` : '',
    manufacturer && model && compactPart ? `${manufacturer} ${model} ${translatedPart} part number` : (base ? `${base} part number` : safeText(input.user_text, MAX_QUERY)),
    oldPart ? `${oldPart} replacement equivalent ${manufacturer}` : (model && compactPart ? `${model} ${translatedPart} PN` : (base ? `${base} OEM` : '')),
    manufacturer && model && part ? `site:${manufacturerDomains(manufacturer)[0] || manufacturer} ${model} ${part}` : '',
    manufacturer && model && part ? `${manufacturer} ${model} ${part} catalog` : '',
  ];
  return [...new Set(queries.map((query) => safeText(query, MAX_QUERY)).filter(Boolean))].slice(0, MAX_QUERIES_PER_ROUND);
}

function candidateLevel(confidence: number): TechnicalPartCandidate['confidence_level'] {
  return confidence >= 0.9 ? 'VERIFIED' : confidence >= 0.55 ? 'LIKELY' : 'DISCOVERED';
}

function extractPartCandidatesFromResult(result: WebSearchResult, pages: PageResponse[], context: { manufacturer?: string; model?: string; part_description?: string; country?: string; market?: string; region?: string; locale?: string } = {}) {
  const page = pages.find((item) => item.url === result.url);
  const evidenceText = safeText(`${result.title} ${result.snippet} ${page?.text || ''}`, 1800);
  const labelled = [...evidenceText.matchAll(/(?:part\s*(?:number|no)?|p\/?n|oem|c[oó]digo|refer[eê]ncia|reference)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./ -]{3,})/gi)].map((match) => match[1].trim().split(/\s+(?:for|fits|compatible|replaces|replacement)\b/i)[0]);
  const alphanumeric = evidenceText.match(/\b[A-Z]{1,6}[- ]?\d{3,}[A-Z0-9-]*\b/gi) || [];
  const normalizedLabelled = new Set(labelled.map((value) => value.toUpperCase().replace(/[.,;:]$/, '')));
  const hasPartContext = /\b(?:part\s*(?:number|no)?|p\/?n|oem|filtro|filter|conjunto|elemento|pe[cç]a|c[oó]digo)\b/i.test(evidenceText);
  const numbers = [...new Set([...labelled, ...alphanumeric].map((value) => value.toUpperCase().replace(/[.,;:]$/, '')).filter((value) => /[A-Z]/.test(value) && /\d/.test(value) && value.length >= 4 && value.length <= 40 && !/^PC\d{4,}$/i.test(value) && !/^\d{3,5}[A-Z]?$/.test(value) && !/^[A-Z]{4,}\s+\d/.test(value) && !/\s/.test(value) && !(context.model && value.replace(/[\s-]/g, '') === String(context.model).toUpperCase().replace(/[\s-]/g, '')) && (normalizedLabelled.has(value) || hasPartContext)))];
  const contextText = `${context.manufacturer || ''} ${context.model || ''} ${context.part_description || ''}`.toLocaleLowerCase('pt-BR');
  const haystack = evidenceText.toLocaleLowerCase('pt-BR');
  const contextualMatch = Boolean(context.model && haystack.includes(String(context.model).toLocaleLowerCase('pt-BR'))) || Boolean(context.part_description && haystack.includes(String(context.part_description).toLocaleLowerCase('pt-BR')));
  const isOfficial = result.source_type === 'manufacturer_official';
  const targetRegion = resolveResearchRegion(context);
  const regional = regionalEvidence(evidenceText);
  const regionalBonus = regionalScore(targetRegion, regional);
  const confidence = Math.min(0.98, (isOfficial ? 0.78 : result.source_type === 'distributor' || result.source_type === 'approved_catalog' ? 0.5 : 0.3) + (contextualMatch ? 0.17 : 0));
  // Keep source authority dominant: an official catalog from another market is
  // still preferable to a distributor result, while regional evidence decides
  // between otherwise comparable official sources.
  const sourcePriority = isOfficial ? 300 : result.source_type === 'approved_catalog' ? 180 : result.source_type === 'distributor' ? 100 : 20;
  const score = sourcePriority + (contextualMatch ? 35 : 0) + (hasPartContext ? 20 : 0) + regionalBonus;
  const trust = evaluateSourceTrust({ source_type: result.source_type, domain: result.domain, evidence_count: 1, retrieved_at: result.retrieved_at });
  return numbers.map((partNumber) => {
    const adjustedConfidence = Math.max(0, Math.min(0.98, confidence + (regionalBonus > 0 ? 0.05 : regionalBonus < 0 ? -0.08 : 0)));
    const candidate = { part_number: partNumber, description: safeText(result.title, 240) || null, manufacturer: safeText(context.manufacturer, 120) || null, model: safeText(context.model, 120) || null, system: null, position: null, serial_range: null, application: safeText(`${context.model || ''} ${result.title} ${result.snippet}`, 400) || null, source_url: result.url, source_domain: result.domain, source_type: result.source_type, evidence_text: safeText(result.snippet, 600), evidence: [safeText(`${result.title} ${result.snippet}`, 700)], evidence_count: 1, score: score + Math.round(trust.score * 20), is_official: isOfficial, trust_score: trust.score, trust_level: trust.level, confidence: adjustedConfidence, confidence_level: candidateLevel(adjustedConfidence), supporting_sources: [result.url], country: regional.country || null, market: regional.market || null, region: regional.region || null, catalog_id: regional.catalog_id || null, catalog_edition: regional.catalog_edition || null } satisfies TechnicalPartCandidate;
    if (AgriculturalPartsSpecialist.matches({ text: `${context.manufacturer || ''} ${context.model || ''} ${context.part_description || ''}` })) candidate.score = AgriculturalPartsSpecialist.rankCandidate(candidate, context);
    return candidate;
  });
}

export function extractTechnicalEvidence(results: WebSearchResult[], pages: PageResponse[] = [], context: { manufacturer?: string; model?: string; part_description?: string; country?: string; market?: string; region?: string; locale?: string } = {}): TechnicalEvidence {
  const all = [...results.map((item) => `${item.title} ${item.snippet}`), ...pages.map((item) => item.text)].join(' ');
  const candidatesByPart = new Map<string, TechnicalPartCandidate>();
  for (const result of results) for (const candidate of extractPartCandidatesFromResult(result, pages, context)) {
    const key = candidate.part_number.replace(/[\s./-]/g, '').toUpperCase();
    const current = candidatesByPart.get(key);
    if (!current) candidatesByPart.set(key, candidate);
    else {
      const sources = [...new Set([...current.supporting_sources, ...candidate.supporting_sources])];
      const confidence = Math.min(0.98, current.confidence + (candidate.source_type === 'manufacturer_official' ? 0.2 : 0.1));
      const preferred = (candidate.score || 0) > (current.score || 0) ? candidate : current;
      const trust = evaluateSourceTrust({ source_type: preferred.source_type, domain: preferred.source_domain, evidence_count: sources.length, cross_source_agreement: sources.length });
      candidatesByPart.set(key, { ...current, ...preferred, confidence, confidence_level: candidateLevel(confidence), score: Math.max(current.score || 0, candidate.score || 0) + Math.min(20, sources.length * 5), is_official: Boolean(current.is_official || candidate.is_official), trust_score: trust.score, trust_level: trust.level, evidence_count: sources.length, supporting_sources: sources, evidence: [...new Set([...(current.evidence || []), ...(candidate.evidence || [])])].slice(0, 10), evidence_text: safeText(`${current.evidence_text} ${candidate.evidence_text}`, 1000) });
    }
  }
  const rankedCandidates = [...candidatesByPart.values()].sort((a, b) => (b.score || 0) - (a.score || 0) || b.confidence - a.confidence);
  const { eligible_candidates: candidates, rejected_candidates } = partitionCandidatesByEligibility(rankedCandidates, context);
  const partNumbers = candidates.map((candidate) => candidate.part_number).slice(0, 30);
  const manufacturers = [...new Set(candidates.filter((item) => item.source_type === 'manufacturer_official').map((item) => item.source_domain).slice(0, 10))];
  const urls = [...new Set(candidates.flatMap((item) => [item.source_url, ...(item.supporting_sources || [])]).filter(Boolean))].slice(0, 20);
  const unique = new Set(results.map((item) => item.snippet.toLocaleLowerCase('pt-BR')).filter(Boolean));
  const regionalCandidates = rankedCandidates.filter((candidate) => candidate.region || candidate.country || candidate.market);
  const regionalConflict = new Set(regionalCandidates.map((candidate) => `${candidate.region || ''}:${candidate.country || ''}:${candidate.market || ''}`)).size > 1;
  const conflicts = candidates.length > 1 ? ['Mais de um PN candidato foi encontrado; confirmar aplicação.'] : [];
  if (regionalConflict) conflicts.push('Conflito regional: foram encontradas aplicações em catálogos de mercados diferentes; não tratar os PNs como equivalentes.');
  if (rejected_candidates.length) conflicts.push(`${rejected_candidates.length} candidato(s) rejeitado(s) pela política de evidência.`);
  return { part_numbers: partNumbers, manufacturers, applications: [], models: [], specifications: [], source_urls: urls, confidence: candidates.length > 1 ? 0.65 : candidates.length ? candidates[0].confidence : results.length >= 2 && unique.size >= 2 ? 0.35 : 0, conflicts, candidates, eligible_candidates: candidates, rejected_candidates };
}

export function isTechnicalResearchNeeded(input: { text: string; manufacturer?: string; model?: string; part_number?: string; userAskedExternal?: boolean }) {
  if (input.userAskedExternal) return true;
  const value = `${input.text} ${input.manufacturer || ''} ${input.model || ''} ${input.part_number || ''}`.toLocaleLowerCase('pt-BR');
  const hasSearchIdentity = Boolean(input.manufacturer || input.model || input.part_number);
  return hasSearchIdentity && detectPartResearchIntent(value);
}

/** PART_RESEARCH_REQUIRED: dispatch research from technical intent, without waiting for the model. */
export function detectPartResearchIntent(text: string) {
  return /\b(pn|p\/?n|part.?number|c[oó]digo|compatibilidade|aplica[cç][aã]o|modelo|serial|chassi|pin|equivalente|fabricante|filtro|correia|corrente|rolamento|bomba|sensor|radiador|pe[cç]a)\b/i.test(safeText(text, MAX_QUERY));
}

export function manufacturerDomains(manufacturer?: string) {
  return ManufacturerAdapterRegistry.domains(safeText(manufacturer, 160));
}

export { safeText };

function queryHash(input: WebSearchInput & { company_id?: string; strategy_version?: string }) {
  const normalized = JSON.stringify({ company_id: safeText(input.company_id, 100), strategy_version: safeText(input.strategy_version || RESEARCH_STRATEGY_VERSION, 80), normalized_requested_part: safeText(input.application || input.query, 240).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(), query: safeText(input.query, MAX_QUERY).toLocaleLowerCase('pt-BR'), manufacturer: safeText(input.manufacturer, 160).toLocaleLowerCase('pt-BR'), part_number: safeText(input.part_number, 120).toLocaleUpperCase('pt-BR'), model: safeText(input.model, 120), year: safeText(input.year, 30), application: safeText(input.application, 240), country: safeText(input.country, 40).toUpperCase(), market: safeText(input.market, 60).toLowerCase(), region: safeText(input.region, 60).toLowerCase(), locale: safeText(input.locale, 20), domains: (input.domains || []).slice().sort() });
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)).then((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

function queriesDiagnosticsWithinBudget(diagnostics: ResearchQueryDiagnostic[], maxQueries: number) {
  return diagnostics.length < maxQueries;
}

type ResearchLimits = {
  max_rounds?: number;
  max_web_queries?: number;
  max_total_results?: number;
  max_page_fetches?: number;
  max_duration_ms?: number;
  max_cost?: number;
};

function boundedInteger(value: unknown, fallback: number, ceiling: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), ceiling) : fallback;
}

export async function conductWebResearch(input: { sb: any; company_id: string; query: WebSearchInput; ttl_hours?: number; max_pages?: number; limits?: ResearchLimits; onQuery?: (event: 'WEB_SEARCH_QUERY_STARTED' | 'WEB_SEARCH_QUERY_COMPLETED' | 'WEB_SEARCH_QUERY_FAILED', details: ResearchQueryDiagnostic) => Promise<void> | void }) {
  const started = Date.now();
  const hash = await queryHash({ ...input.query, company_id: input.company_id, strategy_version: String(RESEARCH_STRATEGY_VERSION) });
  const now = new Date().toISOString();
  try {
    const cached = await input.sb.from('product_research_runs').select('id,status,result,expires_at').eq('company_id', input.company_id).eq('query_hash', hash).eq('status', 'completed').gt('expires_at', now).order('completed_at', { ascending: false }).limit(1).maybeSingle();
    if (!cached.error && cached.data?.result) return { ...cached.data.result, cache_hit: true, cache_miss: false, query_hash: hash, duration_ms: Date.now() - started };
  } catch { /* cache is an optimization; research can continue */ }
  const provider = WebSearchProviderRegistry.create();
  const queryParts = [input.query.query, input.query.manufacturer, input.query.model, input.query.part_number, input.query.application].filter(Boolean).map((part) => safeText(part, 240));
  const initialInput: TechnicalResearchQueryInput = { manufacturer: input.query.manufacturer, model: input.query.model, year: input.query.year, part_description: input.query.application, old_part_number: input.query.part_number, country: input.query.country, market: input.query.market, region: input.query.region, locale: input.query.locale, user_text: queryParts.join(' ') };
  const researchState: ResearchState = { original_request: safeText(input.query.query, MAX_QUERY), current_objective: safeText(input.query.application || input.query.query, MAX_QUERY), known_facts: [], discovered_facts: [], unresolved_facts: [], queries_executed: [], sources: [], candidates: [], conflicts: [], confidence: 0, evidence: [], next_research_step: 'REFINE_SEARCH' };
  if (initialInput.model) researchState.known_facts.push({ field: 'model', value: safeText(initialInput.model, 80), provenance: 'customer', confidence: 'HIGH', sources: [], source: null, timestamp: now });
  if (initialInput.manufacturer) researchState.known_facts.push({ field: 'manufacturer', value: safeText(initialInput.manufacturer, 120), provenance: 'customer', confidence: 'HIGH', sources: [], source: null, timestamp: now });
  const maxRounds = boundedInteger(input.limits?.max_rounds, MAX_RESEARCH_ROUNDS, MAX_RESEARCH_ROUNDS);
  const configuredMaxQueries = boundedInteger(Deno.env.get('WEB_RESEARCH_MAX_QUERIES'), MAX_WEB_QUERIES, MAX_WEB_QUERIES);
  const maxQueries = Math.min(configuredMaxQueries, boundedInteger(input.limits?.max_web_queries, MAX_WEB_QUERIES, MAX_WEB_QUERIES));
  const maxTotalResults = boundedInteger(input.limits?.max_total_results, MAX_TOTAL_RESULTS, MAX_TOTAL_RESULTS);
  const maxPageFetches = boundedInteger(input.limits?.max_page_fetches, MAX_PAGE_FETCHES, MAX_PAGE_FETCHES);
  const maxDurationMs = boundedInteger(input.limits?.max_duration_ms, MAX_RESEARCH_DURATION_MS, MAX_RESEARCH_DURATION_MS);
  const maxCost = boundedInteger(input.limits?.max_cost, MAX_RESEARCH_COST, MAX_RESEARCH_COST);
  const queries = planTechnicalResearchQueries(initialInput);
  const pendingQueries = queries.map((query) => ({ query, round: 1 }));
  const allResults: WebSearchResult[] = [];
  const startedAt = Date.now();
  let queriesExecuted = 0;
  let previousEvidenceCount = 0;
  let queriesWithoutInformationGain = 0;
  let stopReason: 'confidence_sufficient' | 'official_source_confirmed' | 'customer_data_required' | 'cost_budget_reached' | 'timeout' | 'sources_exhausted' | null = null;
  const queryDiagnostics: ResearchQueryDiagnostic[] = [];
  while (pendingQueries.length && queriesDiagnosticsWithinBudget(queryDiagnostics, maxQueries) && queriesExecuted < maxCost) {
    const { query, round } = pendingQueries.shift()!;
    if (Date.now() - startedAt > maxDurationMs) { stopReason = 'timeout'; break; }
    const queryIndex = queryDiagnostics.length + 1;
    const queryStarted = Date.now();
    const queryContext = { query_index: queryIndex, query_length: query.length, manufacturer_present: Boolean(input.query.manufacturer), model_present: Boolean(input.query.model), part_description_present: Boolean(input.query.application), parameter_names: ['q', 'count'], results_count: 0, duration_ms: 0 };
    await input.onQuery?.('WEB_SEARCH_QUERY_STARTED', queryContext);
    const discoveredManufacturer = researchState.known_facts.find((fact) => fact.field === 'manufacturer')?.value || researchState.discovered_facts.find((fact) => fact.field === 'manufacturer')?.value;
    const response = await provider.search({ ...input.query, query, domains: input.query.domains?.length ? input.query.domains : manufacturerDomains(discoveredManufacturer || input.query.manufacturer), max_results: input.query.max_results || 5 });
    researchState.queries_executed.push(query);
    researchState.sources.push(...response.results.map((result) => result.url));
    queriesExecuted += response.queries_executed || 1;
    allResults.push(...response.results);
    const diagnostic = { ...queryContext, code: response.code, http_status: response.http_status ?? null, provider_code: response.provider_code ?? null, provider_error_message: response.provider_error_message ?? null, parameter_names: response.parameter_names || queryContext.parameter_names, results_count: response.results.length, duration_ms: Date.now() - queryStarted };
    queryDiagnostics.push(diagnostic);
    await input.onQuery?.(response.code && response.code !== 'WEB_SEARCH_NO_RESULTS' && response.code !== undefined ? 'WEB_SEARCH_QUERY_FAILED' : 'WEB_SEARCH_QUERY_COMPLETED', diagnostic);
    if (response.code === 'WEB_SEARCH_NOT_CONFIGURED') break;
    if (response.results.length) {
      const identity = resolveMachineIdentity(response.results, { ...initialInput, manufacturer: researchState.known_facts.find((fact) => fact.field === 'manufacturer')?.value || initialInput.manufacturer });
      for (const fact of identity.facts) {
        const target = fact.provenance === 'customer' ? researchState.known_facts : researchState.discovered_facts;
        if (!target.some((existing) => existing.field === fact.field && existing.value.toLocaleLowerCase() === fact.value.toLocaleLowerCase())) target.push(fact);
      }
      const discoveredManufacturer = identity.manufacturer;
      if (discoveredManufacturer && !initialInput.manufacturer && round < maxRounds) {
        const discoveredQueries = planTechnicalResearchQueries({ ...initialInput, manufacturer: discoveredManufacturer, user_text: `${queryParts.join(' ')} ${discoveredManufacturer}` });
        for (const nextQuery of discoveredQueries) {
          const alreadyPending = pendingQueries.some((pending) => pending.query === nextQuery);
          if (!researchState.queries_executed.includes(nextQuery) && !alreadyPending) pendingQueries.push({ query: nextQuery, round: round + 1 });
        }
      }
      const candidatePreview = extractTechnicalEvidence(allResults, [], { ...initialInput, manufacturer: discoveredManufacturer || initialInput.manufacturer }).candidates;
      researchState.candidates = candidatePreview;
      researchState.confidence = candidatePreview.length ? Math.max(...candidatePreview.map((candidate) => candidate.confidence)) : 0;
      researchState.evidence = candidatePreview.flatMap((candidate) => candidate.evidence || []).slice(0, 30);
      researchState.next_research_step = candidatePreview.length ? 'PRESENT_RESULTS' : 'REFINE_SEARCH';
      const evidenceCount = candidatePreview.reduce((sum, candidate) => sum + (candidate.evidence_count || 1), 0);
      queriesWithoutInformationGain = evidenceCount > previousEvidenceCount ? 0 : queriesWithoutInformationGain + 1;
      previousEvidenceCount = Math.max(previousEvidenceCount, evidenceCount);
      const officialConfirmation = candidatePreview.some((candidate) => candidate.is_official && candidate.confidence >= 0.9);
      const crossSourcedConfidence = candidatePreview.some((candidate) => candidate.confidence >= 0.9 && (candidate.evidence_count || 1) >= 2);
      if (officialConfirmation || crossSourcedConfidence) {
        stopReason = officialConfirmation ? 'official_source_confirmed' : 'confidence_sufficient';
        pendingQueries.length = 0;
        researchState.next_research_step = 'PRESENT_RESULTS';
      } else if (queriesWithoutInformationGain >= 2) {
        stopReason = 'sources_exhausted';
        pendingQueries.length = 0;
        researchState.next_research_step = candidatePreview.length ? 'PRESENT_RESULTS' : 'ASK_CUSTOMER';
      }
    } else {
      queriesWithoutInformationGain += 1;
      if (queriesWithoutInformationGain >= 2) {
        stopReason = 'sources_exhausted';
        pendingQueries.length = 0;
        researchState.next_research_step = 'ASK_CUSTOMER';
      }
    }
  }
  if (!stopReason && queriesExecuted >= maxCost) stopReason = 'cost_budget_reached';
  if (!stopReason && !pendingQueries.length) stopReason = 'sources_exhausted';
  const uniqueResults = [...new Map(allResults.map((result) => [result.url, result])).values()].slice(0, maxTotalResults);
  // Regional validation is a second, bounded pass. Initial candidates remain
  // rejected as REGION_UNVERIFIED until a Brazil/South America source
  // explicitly confirms the same model and part number.
  const initialEvidence = extractTechnicalEvidence(uniqueResults, [], initialInput);
  const regionalTarget = resolveResearchRegion(initialInput).region
    ? resolveResearchRegion(initialInput)
    : { country: 'BR', market: 'brazil', region: 'south_america', locale: 'pt-BR' };
  const regionalCandidates = initialEvidence.rejected_candidates
    .filter((candidate) => candidate.rejection_reason === 'REGION_UNVERIFIED' && candidate.part_number)
    .slice(0, 2);
  const officialDomain = manufacturerDomains(initialInput.manufacturer)[0];
  for (const candidate of regionalCandidates) {
    if (!queriesDiagnosticsWithinBudget(queryDiagnostics, maxQueries) || Date.now() - startedAt > maxDurationMs) break;
    const regionalQuery = `${initialInput.manufacturer || ''} ${initialInput.model || ''} ${candidate.part_number} ${initialInput.part_description || ''} Brasil América do Sul`.trim();
    const queryStarted = Date.now();
    const queryIndex = queryDiagnostics.length + 1;
    const queryContext = { query_index: queryIndex, query_length: regionalQuery.length, manufacturer_present: Boolean(initialInput.manufacturer), model_present: Boolean(initialInput.model), part_description_present: Boolean(initialInput.part_description), parameter_names: ['q', 'count', 'country'], results_count: 0, duration_ms: 0 };
    await input.onQuery?.('WEB_SEARCH_QUERY_STARTED', queryContext);
    const response = await provider.search({ ...input.query, query: regionalQuery, country: 'BR', market: 'brazil', region: 'south_america', locale: 'pt-BR', domains: officialDomain ? [officialDomain] : [], max_results: input.query.max_results || 5 });
    allResults.push(...response.results);
    const diagnostic = { ...queryContext, code: response.code, http_status: response.http_status ?? null, provider_code: response.provider_code ?? null, provider_error_message: response.provider_error_message ?? null, parameter_names: response.parameter_names || queryContext.parameter_names, results_count: response.results.length, duration_ms: Date.now() - queryStarted };
    queryDiagnostics.push(diagnostic);
    queriesExecuted += response.queries_executed || 1;
    researchState.queries_executed.push(regionalQuery);
    researchState.sources.push(...response.results.map((result) => result.url));
    await input.onQuery?.(response.code && response.code !== 'WEB_SEARCH_NO_RESULTS' && response.code !== undefined ? 'WEB_SEARCH_QUERY_FAILED' : 'WEB_SEARCH_QUERY_COMPLETED', diagnostic);
  }
  const validatedResults = [...new Map(allResults.map((result) => [result.url, result])).values()].slice(0, maxTotalResults);
  const pages: PageResponse[] = [];
  for (const result of validatedResults.slice(0, Math.min(input.max_pages || 2, maxPageFetches))) {
    if (result.source_type === 'manufacturer_official' || input.query.domains?.length) pages.push(await fetchPublicPage(result.url));
  }
  const resolvedIdentity = resolveMachineIdentity(validatedResults, initialInput);
  const evidence = extractTechnicalEvidence(validatedResults, pages, { ...initialInput, ...regionalTarget, manufacturer: resolvedIdentity.manufacturer || input.query.manufacturer, model: resolvedIdentity.model || input.query.model, part_description: input.query.application });
  const failedQueries = queryDiagnostics.filter((item) => item.code && item.code !== 'WEB_SEARCH_NO_RESULTS');
  const noResultQueries = queryDiagnostics.filter((item) => item.code === 'WEB_SEARCH_NO_RESULTS');
  const successfulQueries = queryDiagnostics.length - failedQueries.length;
  const status = failedQueries.length === queryDiagnostics.length && queryDiagnostics.length > 0 ? 'FAILED' : failedQueries.length ? 'PARTIAL' : validatedResults.length ? 'COMPLETED' : 'INSUFFICIENT_DATA';
  const result = { provider: provider.name, status, region_context: regionalTarget, results: validatedResults, pages: pages.map((page) => ({ url: page.url, title: page.title, retrieved_at: page.retrieved_at, code: page.code || null })), evidence, candidates: evidence.eligible_candidates || [], eligible_candidates: evidence.eligible_candidates || [], rejected_candidates: evidence.rejected_candidates || [], research_state: { ...researchState, candidates: evidence.eligible_candidates || [], discovered_facts: [...researchState.discovered_facts, ...resolvedIdentity.facts.filter((fact) => fact.provenance !== 'customer')], sources: [...new Set(researchState.sources)], unresolved_facts: ['serial_or_chassis'].filter((field) => !initialInput.serial && evidence.candidates.length > 1), next_research_step: evidence.candidates.length ? 'PRESENT_RESULTS' : status === 'FAILED' ? 'HUMAN_HANDOFF' : 'ASK_CUSTOMER' }, discovered_machine: { manufacturer: resolvedIdentity.manufacturer || null, model: resolvedIdentity.model || initialInput.model || null, equipment_type: resolvedIdentity.equipment_type || null }, research_strategy_version: RESEARCH_STRATEGY_VERSION, stop_reason: stopReason, research_limits: { max_rounds: maxRounds, max_web_queries: maxQueries, max_total_results: maxTotalResults, max_page_fetches: maxPageFetches, max_duration_ms: maxDurationMs, max_cost: maxCost }, query_diagnostics: queryDiagnostics, failure_codes: [...new Set(failedQueries.map((item) => item.code).filter(Boolean))], failed_queries: failedQueries.map((item) => item.query_index), successful_queries: successfulQueries, no_result_queries: noResultQueries.map((item) => item.query_index), cache_hit: false, cache_miss: true, queries_planned: Math.max(queries.length, researchState.queries_executed.length), queries_executed: queriesExecuted, results_count: validatedResults.length, query_hash: hash, retrieved_at: now, duration_ms: Date.now() - started };
  try {
    const run = await input.sb.from('product_research_runs').insert({ company_id: input.company_id, query: safeText(input.query.query, MAX_QUERY), query_hash: hash, manufacturer: safeText(input.query.manufacturer, 160) || null, status: uniqueResults.length ? 'completed' : 'insufficient_data', result, started_at: new Date(started).toISOString(), completed_at: now, expires_at: new Date(Date.now() + (input.ttl_hours || 24) * 3600_000).toISOString() }).select('id').maybeSingle();
    if (!run.error && run.data?.id && uniqueResults.length) {
      await input.sb.from('product_research_sources').insert(uniqueResults.map((item) => ({ company_id: input.company_id, research_run_id: run.data.id, source_type: item.source_type, source_name: item.domain, url: item.url, manufacturer: safeText(input.query.manufacturer, 160) || null, retrieved_at: item.retrieved_at, evidence: { title: item.title, snippet: item.snippet }, confidence: evaluateSourceTrust({ source_type: item.source_type, domain: item.domain, retrieved_at: item.retrieved_at }).score, status: 'success' })));
    }
  } catch { /* cache/audit failure must not block internal fallback */ }
  return result;
}
