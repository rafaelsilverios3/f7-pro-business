export type WebSearchInput = {
  query: string;
  manufacturer?: string;
  part_number?: string;
  model?: string;
  year?: string | number;
  application?: string;
  domains?: string[];
  locale?: string;
  max_results?: number;
};

export type WebSearchResult = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  retrieved_at: string;
  source_type: 'manufacturer_official' | 'distributor' | 'approved_catalog' | 'public_web';
};

export type WebSearchResponse = {
  results: WebSearchResult[];
  provider: string;
  searched: boolean;
  code?: string;
  duration_ms: number;
  queries_executed?: number;
};

export type PageResponse = { url: string; title: string | null; text: string; retrieved_at: string; code?: string };

const MAX_QUERY = 500;
const MAX_SNIPPET = 1000;
const MAX_RESULTS = 10;
const DEFAULT_SEARCH_TIMEOUT = 8000;
const DEFAULT_PAGE_TIMEOUT = 8000;
const MAX_PAGE_BYTES = 1_000_000;
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
function providerConfig() {
  const endpoint = Deno.env.get('WEB_SEARCH_API_URL') || '';
  const key = Deno.env.get('WEB_SEARCH_API_KEY') || '';
  const provider = (Deno.env.get('WEB_SEARCH_PROVIDER') || 'disabled').trim().toLocaleLowerCase('en-US');
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
      if (!response.ok) return { results: [], provider: this.name, searched: true, code: `WEB_SEARCH_HTTP_${response.status}`, duration_ms: Date.now() - started };
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.items) ? payload.items : [];
      const results = rows.map((row: any) => {
        const parsed = safeUrl(row?.url || row?.link || row?.href);
        if (!parsed) return null;
        return { title: safeText(row?.title, 240), url: parsed.toString(), domain: parsed.hostname, snippet: safeText(row?.snippet || row?.description || row?.text, MAX_SNIPPET), retrieved_at: new Date().toISOString(), source_type: sourceType(parsed, input.domains) } satisfies WebSearchResult;
      }).filter((row: WebSearchResult | null): row is WebSearchResult => Boolean(row)).slice(0, MAX_RESULTS);
      return { results, provider: this.name, searched: true, code: results.length ? undefined : 'WEB_SEARCH_NO_RESULTS', duration_ms: Date.now() - started };
    } catch (error) { return { results: [], provider: this.name, searched: true, code: error?.name === 'AbortError' ? 'WEB_SEARCH_TIMEOUT' : 'WEB_SEARCH_FAILED', duration_ms: Date.now() - started }; }
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
    const params = new URLSearchParams({ q: safeText(input.query, 600), count: String(Math.min(Math.max(Number(input.max_results || 5), 1), 20)) });
    const locale = safeText(input.locale || 'pt-BR', 20).split('-');
    if (locale[0]) params.set('search_lang', locale[0].toLowerCase());
    if (locale[1]) params.set('country', locale[1].toUpperCase());
    const safesearch = safeText(Deno.env.get('WEB_SEARCH_SAFESEARCH') || 'moderate', 20).toLowerCase();
    if (['off', 'moderate', 'strict'].includes(safesearch)) params.set('safesearch', safesearch);
    endpoint.search = params.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(Deno.env.get('WEB_SEARCH_TIMEOUT_MS') || DEFAULT_SEARCH_TIMEOUT));
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(endpoint.toString(), { method: 'GET', headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': config.key }, signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const braveCode = safeText(payload?.error?.code, 80).toUpperCase();
        const code = response.status === 401 || response.status === 403 ? 'WEB_SEARCH_AUTH_ERROR' : response.status === 429 || braveCode === 'RATE_LIMITED' || braveCode === 'QUOTA_LIMITED' ? 'WEB_SEARCH_RATE_LIMITED' : response.status >= 500 ? 'WEB_SEARCH_UNAVAILABLE' : 'WEB_SEARCH_PROVIDER_ERROR';
        return { results: [], provider: this.name, searched: true, code, duration_ms: Date.now() - started, queries_executed: 1 };
      }
      const results = normalizeBraveResponse(payload, input.domains, new Date().toISOString());
      return { results, provider: this.name, searched: true, code: results.length ? undefined : 'WEB_SEARCH_NO_RESULTS', duration_ms: Date.now() - started, queries_executed: 1 };
    } catch (error) { return { results: [], provider: this.name, searched: true, code: error?.name === 'AbortError' ? 'WEB_SEARCH_TIMEOUT' : 'WEB_SEARCH_FAILED', duration_ms: Date.now() - started, queries_executed: 1 }; }
    finally { clearTimeout(timeout); }
  }
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
  } catch (error) { return { url: parsed.toString(), title: null, text: '', retrieved_at: new Date().toISOString(), code: error?.name === 'AbortError' ? 'WEB_PAGE_TIMEOUT' : 'WEB_PAGE_FETCH_FAILED' }; }
  finally { clearTimeout(timeout); }
}

export type TechnicalEvidence = { part_numbers: string[]; manufacturers: string[]; applications: string[]; models: string[]; specifications: string[]; source_urls: string[]; confidence: number; conflicts: string[] };

export function extractTechnicalEvidence(results: WebSearchResult[], pages: PageResponse[] = []): TechnicalEvidence {
  const all = [...results.map((item) => `${item.title} ${item.snippet}`), ...pages.map((item) => item.text)].join(' ');
  const partNumbers = [...new Set((all.match(/\b(?:[A-Z]{1,5}[- ]?\d{2,}[A-Z0-9-]*|\d{2,}[A-Z]{1,4}[- ]?\d{1,})\b/gi) || []).map((item) => item.toUpperCase()).slice(0, 30))];
  const manufacturers = [...new Set(results.filter((item) => item.source_type === 'manufacturer_official').map((item) => item.domain).slice(0, 10))];
  const urls = [...new Set([...results.map((item) => item.url), ...pages.map((item) => item.url)])].slice(0, 20);
  const unique = new Set(results.map((item) => item.snippet.toLocaleLowerCase('pt-BR')).filter(Boolean));
  return { part_numbers: partNumbers, manufacturers, applications: [], models: [], specifications: [], source_urls: urls, confidence: results.length >= 2 && unique.size >= 2 ? 0.65 : results.length ? 0.35 : 0, conflicts: [] };
}

export function isTechnicalResearchNeeded(input: { text: string; manufacturer?: string; model?: string; part_number?: string; userAskedExternal?: boolean }) {
  if (input.userAskedExternal) return true;
  const value = `${input.text} ${input.manufacturer || ''} ${input.model || ''} ${input.part_number || ''}`.toLocaleLowerCase('pt-BR');
  return Boolean(input.manufacturer || input.model || input.part_number || /\b(pn|p\/?n|part.?number|c[oó]digo|compatibilidade|aplica[cç][aã]o|modelo|serial|chassi|pin|equivalente|fabricante)\b/i.test(value));
}

export function manufacturerDomains(manufacturer?: string) {
  const value = safeText(manufacturer, 160).toLocaleLowerCase('pt-BR');
  const registry: Record<string, string[]> = { 'john deere': ['deere.com', 'partscatalog.deere.com'], skf: ['skf.com'], gates: ['gates.com'], bosch: ['bosch.com'] };
  return Object.entries(registry).find(([key]) => value.includes(key))?.[1] || [];
}

export { safeText };

function queryHash(input: WebSearchInput) {
  const normalized = JSON.stringify({ query: safeText(input.query, MAX_QUERY).toLocaleLowerCase('pt-BR'), manufacturer: safeText(input.manufacturer, 160).toLocaleLowerCase('pt-BR'), part_number: safeText(input.part_number, 120).toLocaleUpperCase('pt-BR'), model: safeText(input.model, 120), year: safeText(input.year, 30), application: safeText(input.application, 240), domains: (input.domains || []).slice().sort() });
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)).then((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

export async function conductWebResearch(input: { sb: any; company_id: string; query: WebSearchInput; ttl_hours?: number; max_pages?: number }) {
  const started = Date.now();
  const hash = await queryHash(input.query);
  const now = new Date().toISOString();
  try {
    const cached = await input.sb.from('product_research_runs').select('id,status,result,expires_at').eq('company_id', input.company_id).eq('query_hash', hash).eq('status', 'completed').gt('expires_at', now).order('completed_at', { ascending: false }).limit(1).maybeSingle();
    if (!cached.error && cached.data?.result) return { ...cached.data.result, cache_hit: true, cache_miss: false, query_hash: hash, duration_ms: Date.now() - started };
  } catch { /* cache is an optimization; research can continue */ }
  const provider = WebSearchProviderRegistry.create();
  const queryParts = [input.query.query, input.query.manufacturer, input.query.model, input.query.part_number, input.query.application].filter(Boolean).map((part) => safeText(part, 240));
  const queries = [...new Set([queryParts.join(' '), input.query.part_number ? `${input.query.part_number} ${input.query.manufacturer || ''}` : '', input.query.manufacturer && input.query.model ? `${input.query.manufacturer} ${input.query.model} ${input.query.application || ''}` : ''].filter(Boolean))].slice(0, 3);
  const allResults: WebSearchResult[] = [];
  const startedAt = Date.now();
  let queriesExecuted = 0;
  for (const query of queries) {
    if (Date.now() - startedAt > 15_000) break;
    const response = await provider.search({ ...input.query, query, domains: input.query.domains?.length ? input.query.domains : manufacturerDomains(input.query.manufacturer), max_results: input.query.max_results || 5 });
    queriesExecuted += response.queries_executed || 1;
    allResults.push(...response.results);
    if (response.code === 'WEB_SEARCH_NOT_CONFIGURED') break;
  }
  const uniqueResults = [...new Map(allResults.map((result) => [result.url, result])).values()].slice(0, MAX_RESULTS);
  const pages: PageResponse[] = [];
  for (const result of uniqueResults.slice(0, Math.min(input.max_pages || 2, 3))) {
    if (result.source_type === 'manufacturer_official' || input.query.domains?.length) pages.push(await fetchPublicPage(result.url));
  }
  const evidence = extractTechnicalEvidence(uniqueResults, pages);
  const result = { provider: provider.name, results: uniqueResults, pages: pages.map((page) => ({ url: page.url, title: page.title, retrieved_at: page.retrieved_at, code: page.code || null })), evidence, cache_hit: false, cache_miss: true, queries_executed: queriesExecuted, results_count: uniqueResults.length, query_hash: hash, retrieved_at: now, duration_ms: Date.now() - started };
  try {
    const run = await input.sb.from('product_research_runs').insert({ company_id: input.company_id, query: safeText(input.query.query, MAX_QUERY), query_hash: hash, manufacturer: safeText(input.query.manufacturer, 160) || null, status: uniqueResults.length ? 'completed' : 'insufficient_data', result, started_at: new Date(started).toISOString(), completed_at: now, expires_at: new Date(Date.now() + (input.ttl_hours || 24) * 3600_000).toISOString() }).select('id').maybeSingle();
    if (!run.error && run.data?.id && uniqueResults.length) {
      await input.sb.from('product_research_sources').insert(uniqueResults.map((item) => ({ company_id: input.company_id, research_run_id: run.data.id, source_type: item.source_type, source_name: item.domain, url: item.url, manufacturer: safeText(input.query.manufacturer, 160) || null, retrieved_at: item.retrieved_at, evidence: { title: item.title, snippet: item.snippet }, confidence: item.source_type === 'manufacturer_official' ? 0.8 : 0.45, status: 'success' })));
    }
  } catch { /* cache/audit failure must not block internal fallback */ }
  return result;
}
