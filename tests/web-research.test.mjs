import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const provider = fs.readFileSync('supabase/functions/_shared/webResearch.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0040_web_research_backend_permissions.sql', 'utf8');
const braveFixture = { web: { results: [{ title: 'Correia OEM', url: 'https://deere.com/parts/123', description: 'Aplicação S540 PN RE123' }] } };

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
  assert.match(provider, /slice\(0, 3\)/);
  assert.match(provider, /queries_executed/);
  assert.match(provider, /results_count/);
  assert.match(assistant, /cache_hit/);
  assert.match(assistant, /cache_miss/);
  assert.doesNotMatch(assistant, /WEB_SEARCH_API_KEY/);
});

test('technical research plans discovery before serial confirmation and creates evidence candidates', () => {
  assert.match(provider, /TechnicalResearchQueryPlanner|planTechnicalResearchQueries/);
  assert.match(provider, /part number/);
  assert.match(provider, /site:\$\{manufacturerDomains/);
  assert.match(provider, /confidence_level: 'DISCOVERED' \| 'LIKELY' \| 'VERIFIED'/);
  assert.match(provider, /supporting_sources/);
  assert.match(provider, /RESEARCH_STRATEGY_VERSION = 2/);
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
