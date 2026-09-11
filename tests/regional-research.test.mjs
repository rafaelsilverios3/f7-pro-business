import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';

async function loadResearch() {
  const result = await build({ entryPoints: [path.resolve('supabase/functions/_shared/webResearch.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const research = await loadResearch();
const now = new Date().toISOString();
const southAmerica = { title: 'Filtro primário 7230J — PC13119 — RE541922', url: 'https://partscatalog.deere.com/jdrc/br/pc13119', domain: 'partscatalog.deere.com', snippet: 'John Deere 7230J South America Edition Brazil filtro de combustível primário RE541922', retrieved_at: now, source_type: 'manufacturer_official' };
const northAmerica = { title: '7230J North America Edition fuel filter RE524723', url: 'https://partscatalog.deere.com/jdrc/us/7230j', domain: 'partscatalog.deere.com', snippet: 'United States North America Edition fuel filter for John Deere 7230J RE524723', retrieved_at: now, source_type: 'manufacturer_official' };

test('regional context ranks Brazilian official catalog above another market without hardcoded PN', () => {
  const context = { manufacturer: 'John Deere', model: '7230J', part_description: 'filtro de combustível primário', country: 'BR', market: 'brazil', region: 'south_america', locale: 'pt-BR' };
  const evidence = research.extractTechnicalEvidence([southAmerica, northAmerica], [], context);
  assert.equal(evidence.candidates[0].part_number, 'RE541922');
  assert.equal(evidence.candidates[0].catalog_id, 'PC13119');
  assert.match(evidence.candidates[0].catalog_edition, /South America|Brazil/i);
  assert.ok(evidence.conflicts.some((item) => /regional/i.test(item)));
  assert.doesNotMatch(fs.readFileSync('supabase/functions/_shared/adapters/johnDeere.ts', 'utf8'), /RE541922/);
});

test('US context favors North America and unknown context preserves both regional candidates', () => {
  const us = research.extractTechnicalEvidence([southAmerica, northAmerica], [], { manufacturer: 'John Deere', model: '7230J', part_description: 'fuel filter', country: 'US', market: 'united_states', region: 'north_america', locale: 'en-US' });
  assert.equal(us.candidates[0].part_number, 'RE524723');
  const unknown = research.extractTechnicalEvidence([southAmerica, northAmerica], [], { manufacturer: 'John Deere', model: '7230J', part_description: 'fuel filter' });
  assert.deepEqual(new Set(unknown.candidates.map((item) => item.part_number)), new Set(['RE541922', 'RE524723']));
});

test('official catalog technical South America path is regional evidence without Brazil text', () => {
  const catalog = {
    title: '7230J primary fuel filter AT433554',
    url: 'https://partscatalog.deere.com/jdrc/south_america/7230J/AT433554',
    domain: 'partscatalog.deere.com',
    snippet: 'John Deere 7230J primary fuel filter AT433554',
    retrieved_at: now,
    source_type: 'manufacturer_official',
  };
  const evidence = research.extractTechnicalEvidence([catalog], [], {
    manufacturer: 'John Deere', model: '7230J', part_description: 'primary fuel filter',
    country: 'BR', market: 'brazil', region: 'south_america', locale: 'pt-BR',
  });
  assert.equal(evidence.candidates.length, 1);
  assert.equal(evidence.candidates[0].part_number, 'AT433554');
  assert.equal(evidence.candidates[0].region, 'south_america');
  assert.equal(evidence.rejected_candidates.length, 0);
});

test('regional planner is explicit but adapter remains extensible', () => {
  const brQueries = research.planTechnicalResearchQueries({ manufacturer: 'John Deere', model: '7230J', part_description: 'filtro de combustível', region: 'south_america', country: 'BR', market: 'brazil', locale: 'pt-BR' });
  const usQueries = research.planTechnicalResearchQueries({ manufacturer: 'John Deere', model: '7230J', part_description: 'fuel filter', region: 'north_america', country: 'US', market: 'united_states', locale: 'en-US' });
  assert.ok(brQueries.some((query) => /South America|Brazil/i.test(query)));
  assert.ok(usQueries.some((query) => /North America|United States/i.test(query)));
  assert.ok(usQueries.every((query) => !/South America|Brazil/i.test(query)));
  assert.equal(research.resolveResearchRegion({ language: 'pt-BR' }).region, 'south_america');
  assert.equal(research.resolveResearchRegion({ language: 'en-US' }).region, 'north_america');
});
