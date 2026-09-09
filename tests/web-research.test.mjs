import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const provider = fs.readFileSync('supabase/functions/_shared/webResearch.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0040_web_research_backend_permissions.sql', 'utf8');

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
