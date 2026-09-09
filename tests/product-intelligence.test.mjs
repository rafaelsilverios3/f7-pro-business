import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0039_product_intelligence.sql', 'utf8');
const shared = fs.readFileSync('supabase/functions/_shared/productIntelligence.ts', 'utf8');
const service = fs.readFileSync('src/services/productIntelligenceService.js', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');

test('product intelligence migration isolates research and verified knowledge by company', () => {
  for (const table of ['product_intelligence_sources', 'verified_product_applications', 'part_cross_references', 'product_research_runs', 'product_research_sources']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.%I enable row level security`));
  }
  assert.match(migration, /verification_state.*discovered.*candidate.*verified.*rejected/i);
  assert.match(migration, /POSSIBLE_MATCH/);
  assert.doesNotMatch(migration, /WHATSAPP_ACCESS_TOKEN|AI_API_KEY|service_role.*insert/i);
});

test('registry and resolver are multisegment and evidence-first', () => {
  assert.match(shared, /ProductIntelligenceRegistry/);
  assert.match(shared, /CompanyInternalCatalogSource/);
  assert.match(shared, /resolveProductOrPart/);
  assert.match(shared, /need_external_research/);
  assert.match(shared, /CONFIRMED.*HIGH.*MEDIUM.*LOW.*INSUFFICIENT_DATA/);
  assert.match(shared, /supporting_sources/);
  assert.match(shared, /conflicting_sources/);
  assert.match(service, /normalizePartNumber/);
  assert.match(service, /sourceTrustScore/);
  assert.doesNotMatch(shared, /JohnDeereOfficialSource|CaterpillarOfficialSource|SKFOfficialSource/);
});

test('assistant receives processed product intelligence and treats external evidence as data', () => {
  assert.match(assistant, /resolveProductOrPart/);
  assert.match(assistant, /PRODUCT_INTELLIGENCE/);
  assert.match(assistant, /evidência externa|dados não confiáveis/);
  assert.match(assistant, /product_intelligence:/);
  assert.doesNotMatch(assistant, /scrap|CAPTCHA|contornar autenticação/i);
});

test('product intelligence permissions are separated by capability', () => {
  for (const permission of ['product_intelligence.view', 'product_intelligence.search', 'product_intelligence.verify', 'product_intelligence.manage_sources']) assert.match(permissions, new RegExp(permission.replace('.', '\\.'), 'g'));
});
