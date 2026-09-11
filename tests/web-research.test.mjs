import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const provider = fs.readFileSync('supabase/functions/_shared/webResearch.ts', 'utf8');
const sourceTrust = fs.readFileSync('supabase/functions/_shared/sourceTrust.ts', 'utf8');
const manufacturerRegistry = fs.readFileSync('supabase/functions/_shared/manufacturerAdapterRegistry.ts', 'utf8');
const deereAdapter = fs.readFileSync('supabase/functions/_shared/adapters/johnDeere.ts', 'utf8');
const agriculturalSpecialist = fs.readFileSync('supabase/functions/_shared/specialists/agriculturalParts.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0040_web_research_backend_permissions.sql', 'utf8');
const braveFixture = { web: { results: [{ title: 'Correia OEM', url: 'https://deere.com/parts/123', description: 'Aplicação S540 PN RE123' }] } };
const deereFixture = { title: 'RE524723: Conjunto do Filtro de Combustível Final', url: 'https://shop.deere.com/us/product/RE524723', description: 'Compatível com John Deere 7230J; confirme a configuração pelo número de série.' };

test('web research provider is server-side and disabled without backend configuration', () => {
  assert.match(provider, /WEB_SEARCH_API_KEY/);
  assert.match(provider, /WEB_SEARCH_API_URL/);
  assert.match(provider, /UnavailableWebSearchProvider/);
  assert.doesNotMatch(provider, /VITE_/);
  assert.match(provider, /BLOCKED_HOSTS/);
});

test('web research validates public URLs and does not follow redirects or expose page content', () => {
  assert.match(provider, /username \|\| parsed\.password/);
  assert.match(provider, /WEB_PAGE_REDIRECT_NOT_FOLLOWED/);
  assert.match(provider, /WEB_PAGE_MAX|MAX_PAGE_BYTES/);
  assert.match(provider, /WEB_PAGE_URL_BLOCKED/);
});

test('technical evidence treats search results as evidence and supports cache metadata', () => {
  assert.match(provider, /TechnicalEvidence/);
  assert.match(provider, /query_hash/);
  assert.match(provider, /product_research_runs/);
  assert.match(provider, /product_research_sources/);
  assert.match(assistant, /external_product_intelligence/);
  assert.match(assistant, /productIntelligence\.web_research/);
});

test('web research grants are server-side only and write scope is minimal', () => {
  assert.match(migration, /grant select, insert, update on table public\.product_research_runs to service_role/);
  assert.match(migration, /grant select, insert on table public\.product_research_sources to service_role/);
  assert.match(migration, /revoke insert, update, delete .* from anon, authenticated/);
  assert.doesNotMatch(migration, /grant all/i);
  assert.match(migration, /external_product_intelligence.*plan_name = 'premium'/s);
  assert.match(migration, /company_feature_overrides/);
});

test('Brave adapter follows the real endpoint contract and parses the web fixture', () => {
  assert.equal(braveFixture.web.results[0].title, 'Correia OEM');
  assert.equal(braveFixture.web.results[0].url, 'https://deere.com/parts/123');
  assert.match(provider, /BraveWebSearchProvider/);
  assert.match(provider, /https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search/);
  assert.match(provider, /X-Subscription-Token/);
  assert.match(provider, /payload\?\.web\?\.results/);
  assert.match(provider, /row\?\.description \|\| row\?\.snippet/);
  assert.match(provider, /WEB_SEARCH_AUTH_ERROR/);
  assert.match(provider, /WEB_SEARCH_RATE_LIMITED/);
  assert.match(provider, /WEB_SEARCH_TIMEOUT/);
});

test('Brave requests are bounded and record safe cost metrics', () => {
  assert.match(provider, /slice\(0, MAX_QUERIES_PER_ROUND\)/);
  assert.match(provider, /queries_executed/);
  assert.match(provider, /results_count/);
  assert.match(assistant, /cache_hit/);
  assert.match(assistant, /cache_miss/);
  assert.doesNotMatch(assistant, /WEB_SEARCH_API_KEY/);
});

test('Brave request builder sends only the minimal validated parameters', () => {
  assert.match(provider, /export function buildBraveSearchParams/);
  assert.match(provider, /q: safeText\(input\.query, 600\)/);
  assert.match(provider, /count: String\(Math\.min\(Math\.max\(Number\(input\.max_results \|\| 5\), 1\), 5\)\)/);
  assert.doesNotMatch(provider, /params\.set\('search_lang'/);
  assert.doesNotMatch(provider, /params\.set\('country'/);
  assert.doesNotMatch(provider, /params\.set\('safesearch'/);
  assert.match(provider, /method: 'GET'/);
  assert.match(provider, /pathname !== '\/res\/v1\/web\/search'/);
});

test('Brave validation errors preserve safe 422 diagnostics', () => {
  assert.match(provider, /provider_error_message/);
  assert.match(provider, /http_status: response\.status/);
  assert.match(provider, /provider_code: braveCode/);
  assert.match(assistant, /parameter_names/);
  assert.match(assistant, /provider_error_message/);
  assert.doesNotMatch(provider, /X-Subscription-Token[^\n]*integration_logs/);
});

test('technical research plans discovery before serial confirmation and creates evidence candidates', () => {
  assert.match(provider, /TechnicalResearchQueryPlanner|planTechnicalResearchQueries/);
  assert.match(provider, /part number/);
  assert.match(provider, /site:\$\{manufacturerDomains/);
  assert.match(provider, /confidence_level: 'DISCOVERED' \| 'LIKELY' \| 'VERIFIED'/);
  assert.match(provider, /supporting_sources/);
  assert.match(provider, /RESEARCH_STRATEGY_VERSION = 4/);
  assert.match(assistant, /pesquise e apresente PNs candidatos/);
  assert.match(assistant, /PART_CANDIDATES_READY/);
  assert.match(assistant, /productIntelligence\.candidates =/);
});

test('research preserves per-query Brave diagnostics and partial results', () => {
  assert.match(provider, /WEB_SEARCH_QUERY_STARTED/);
  assert.match(provider, /WEB_SEARCH_QUERY_COMPLETED/);
  assert.match(provider, /WEB_SEARCH_QUERY_FAILED/);
  assert.match(provider, /query_diagnostics/);
  assert.match(provider, /failure_codes/);
  assert.match(provider, /successful_queries/);
  assert.match(provider, /no_result_queries/);
  assert.match(provider, /const status = failedQueries\.length === queryDiagnostics\.length/);
  assert.match(assistant, /WEB_RESEARCH_PARTIAL/);
  assert.match(assistant, /provider_code/);
  assert.doesNotMatch(provider, /X-Subscription-Token[^\n]*integration_logs/);
});

test('technical extraction keeps an official John Deere PN candidate', () => {
  assert.match(deereFixture.title, /RE524723/);
  assert.match(deereFixture.description, /7230J/);
  assert.match(provider, /extractPartCandidatesFromResult\(result, pages, context\)/);
  assert.match(provider, /manufacturer_official/);
  assert.match(provider, /context\.model/);
  assert.match(deereAdapter, /shop\.deere\.com/);
  assert.match(provider, /fuel filter/);
  assert.match(provider, /evidence_count/);
  assert.match(provider, /is_official/);
  assert.match(provider, /sort\(\(a, b\) => \(b\.score/);
});

test('external candidates and sources remain explicit for the assistant and UI', () => {
  assert.match(assistant, /candidate_diagnostics/);
  assert.match(assistant, /productIntelligence\.candidates = mergeProductIntelligenceCandidates/);
  assert.match(assistant, /source_domain/);
  assert.match(assistant, /source_type/);
});

test('technical planner does not require a year and uses official plus general queries', () => {
  assert.match(provider, /officialDomain/);
  assert.match(provider, /site:\$\{officialDomain\}/);
  assert.match(provider, /translatedPart/);
  assert.match(assistant, /confirmation_fields_by_context/);
  assert.doesNotMatch(assistant, /year.*missing\.push|missing\.push\(['"]year/);
});

test('autonomous research keeps provenance and discovers machine identity from evidence', () => {
  assert.match(provider, /export type ResearchState/);
  assert.match(provider, /export function resolveMachineIdentity/);
  for (const provenance of ['customer', 'company_internal', 'official_source', 'public_web', 'human_agent', 'historical_verified', 'inference']) assert.match(provider, new RegExp(provenance));
  assert.match(provider, /source: string \| null/);
  assert.match(provider, /timestamp: string/);
  assert.match(provider, /equipment_type/);
  assert.match(provider, /discovered_machine/);
});

test('autonomous research refines queries with bounded adaptive rounds', () => {
  assert.match(provider, /WEB_RESEARCH_MAX_QUERIES/);
  assert.match(provider, /boundedInteger\(Deno\.env\.get\('WEB_RESEARCH_MAX_QUERIES'\)/);
  assert.match(provider, /round < maxRounds/);
  assert.match(provider, /pendingQueries\.push/);
  assert.match(provider, /discoveredManufacturer/);
  assert.match(provider, /queriesDiagnosticsWithinBudget/);
});

test('research engine exposes bounded budgets and complete iterative state', () => {
  for (const limit of ['MAX_RESEARCH_ROUNDS', 'MAX_WEB_QUERIES', 'MAX_TOTAL_RESULTS', 'MAX_PAGE_FETCHES', 'MAX_RESEARCH_DURATION_MS', 'MAX_RESEARCH_COST']) assert.match(provider, new RegExp(`export const ${limit}`));
  for (const field of ['current_objective', 'known_facts', 'discovered_facts', 'unresolved_facts', 'queries_executed', 'sources', 'candidates', 'evidence', 'conflicts', 'confidence', 'next_research_step']) assert.match(provider, new RegExp(field));
  assert.match(provider, /stop_reason/);
  assert.match(provider, /official_source_confirmed/);
  assert.match(provider, /queriesWithoutInformationGain/);
});

test('source trust is independent and evaluates available authority and risk signals', () => {
  assert.match(provider, /evaluateSourceTrust/);
  for (const level of ['HIGH_TRUST', 'MEDIUM_TRUST', 'LOW_TRUST', 'INSUFFICIENT_DATA']) assert.match(sourceTrust, new RegExp(level));
  for (const factor of ['authority', 'domain', 'official_status', 'company_identity', 'reputation', 'review_volume', 'review_patterns', 'complaints', 'delivery_issues', 'counterfeit_claims', 'description_mismatch', 'price_anomaly', 'source_age_days', 'cross_source_agreement']) assert.match(sourceTrust, new RegExp(factor));
  assert.match(provider, /trust_score/);
  assert.match(provider, /trust_level/);
  assert.doesNotMatch(sourceTrust, /fraud|safe supplier/i);
});

test('assistant context preserves candidate trust and research provenance', () => {
  assert.match(assistant, /trust_score/);
  assert.match(assistant, /trust_level/);
  assert.match(assistant, /current_objective/);
  assert.match(assistant, /next_research_step/);
});

test('agricultural specialist starts with model and part and ranks evidence dimensions separately', () => {
  assert.match(agriculturalSpecialist, /researchCanStart/);
  assert.match(agriculturalSpecialist, /input\.model/);
  assert.match(agriculturalSpecialist, /input\.part_description/);
  for (const factor of ['manufacturer_official', 'model', 'system', 'position', 'serial_range', 'evidence_count', 'trust_score', 'part_description']) assert.match(agriculturalSpecialist, new RegExp(factor));
  assert.match(agriculturalSpecialist, /nextBestQuestion/);
});

test('John Deere behavior lives in a manufacturer adapter without hardcoded part numbers', () => {
  assert.match(manufacturerRegistry, /JohnDeereAdapter/);
  assert.match(deereAdapter, /partscatalog\.deere\.com.*shop\.deere\.com.*deere\.com.*digitalparts\.deere\.com/s);
  for (const term of ['pin', 'serial', 'engine serial', 'part number', 'assembly', 'subassembly', 'primary', 'final', 'water separator', 'position', 'side', 'serial range']) assert.match(deereAdapter.toLocaleLowerCase(), new RegExp(term));
  assert.doesNotMatch(deereAdapter, /\b(?:RE|AH|AR|AT)\d{4,}\b/);
  assert.match(provider, /ManufacturerAdapterRegistry/);
  assert.doesNotMatch(provider, /john\s*deere|partscatalog\.deere\.com/i);
});
