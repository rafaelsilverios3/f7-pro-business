import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import fs from 'node:fs';

async function loadModule() {
  const result = await build({ entryPoints: [path.resolve('supabase/functions/_shared/productIntelligence.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const intelligence = await loadModule();
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const resolver = fs.readFileSync('supabase/functions/_shared/companyContextResolver.ts', 'utf8');

test('unified resolver prioritizes a verified application above duplicate web and internal candidates', async () => {
  const result = await intelligence.resolveProductOrPart({
    company_id: 'company-a', query: 'filtro 7230J',
    products: [{ name: 'Filtro 7230J', sku: 'RE524723', stock: 2, price: 100 }],
    verified_applications: [{ part_number: 'RE524723', manufacturer: 'John Deere', machine_model: '7230J', system: 'combustível', verification_state: 'verified', source_refs: ['human:1'] }],
    external_candidates: [{ part_number: 'RE-524723', source_type: 'manufacturer_official', source_domain: 'shop.deere.com', supporting_sources: ['https://shop.deere.com/x'], confidence: 0.94, score: 120 }],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].part_number.replace('-', ''), 'RE524723');
  assert.equal(result.candidates[0].confidence_level, 'CONFIRMED');
  assert.ok(result.candidates[0].supporting_sources.length >= 2);
});

test('unified resolver includes verified cross references and product knowledge', async () => {
  const result = await intelligence.resolveProductOrPart({ company_id: 'company-a', query: 'equivalente', cross_references: [{ equivalent_part_number: 'ABC123', equivalent_manufacturer: 'Fabricante', relation_type: 'OEM_EQUIVALENT', confidence: 0.9, evidence: ['catalog:1'] }], verified_knowledge: [{ knowledge_type: 'product_knowledge', subject_key: 'filter', fact_key: 'alternate', fact_value: { part_number: 'XYZ789', application: 'modelo T' }, confidence: 0.95, source_ref: 'feedback:1' }] });
  assert.deepEqual(new Set(result.candidates.map((candidate) => candidate.part_number)), new Set(['ABC123', 'XYZ789']));
});

test('assistant sends one ranked product intelligence context from all canonical sources', () => {
  for (const resource of ['verified_product_applications', 'part_cross_references', 'company_knowledge']) assert.match(resolver, new RegExp(`from\\('${resource}'\\)`));
  assert.match(assistant, /mergeProductIntelligenceCandidates/);
  assert.doesNotMatch(assistant, /productIntelligence\.candidates = \[\.\.\.\(productIntelligence\.candidates/);
});
