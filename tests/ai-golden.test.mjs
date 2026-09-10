import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

async function loadBundledModule(relativePath) {
  const result = await build({ entryPoints: [path.resolve(relativePath)], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const research = await loadBundledModule('supabase/functions/_shared/webResearch.ts');
const decisions = await loadBundledModule('supabase/functions/_shared/assistantDecision.ts');
const agricultural = await loadBundledModule('supabase/functions/_shared/specialists/agriculturalParts.ts');

const now = new Date().toISOString();
const primaryFilterEvidence = [
  { title: 'Primary fuel filter for 7230J — PN RE524723', url: 'https://shop.deere.com/parts/primary-filter', domain: 'shop.deere.com', snippet: 'John Deere tractor 7230J primary fuel filter part number RE524723', retrieved_at: now, source_type: 'manufacturer_official' },
  { title: '7230J primary fuel filter RE524723', url: 'https://partscatalog.deere.com/parts/primary-filter', domain: 'partscatalog.deere.com', snippet: 'John Deere 7230J tractor application; PN RE524723', retrieved_at: now, source_type: 'manufacturer_official' },
  { title: '7230J fuel filter variant RE541922', url: 'https://catalog.example.com/7230j-filter', domain: 'catalog.example.com', snippet: 'Fuel filter option RE541922 for selected 7230J serial ranges', retrieved_at: now, source_type: 'approved_catalog' },
];

test('golden 7230J starts research without manufacturer and produces sourced ranked options', () => {
  const message = 'Boa noite, você tem o código do filtro de combustível primário do trator 7230J?';
  const input = research.inferTechnicalResearchInput(message);
  assert.equal(input.model, '7230J');
  assert.equal(input.manufacturer, undefined);
  assert.match(input.part_description, /filtro de combustível/i);
  assert.equal(research.isTechnicalResearchNeeded({ text: message, model: input.model }), true);
  const initialQueries = research.planTechnicalResearchQueries(input);
  assert.ok(initialQueries.some((query) => /7230J/i.test(query)));
  assert.ok(initialQueries.every((query) => !/qual fabricante|qual ano|informe o chassi/i.test(query)));

  const identity = research.resolveMachineIdentity(primaryFilterEvidence, input);
  assert.equal(identity.manufacturer, 'John Deere');
  assert.match(identity.equipment_type, /tractor/i);
  assert.equal(identity.facts.find((fact) => fact.field === 'manufacturer')?.provenance, 'official_source');

  const evidence = research.extractTechnicalEvidence(primaryFilterEvidence, [], { manufacturer: identity.manufacturer, model: input.model, part_description: input.part_description });
  assert.ok(evidence.candidates.length >= 2);
  assert.equal(evidence.candidates[0].part_number, 'RE524723');
  assert.equal(evidence.candidates.filter((candidate) => candidate.part_number === 'RE524723').length, 1);
  assert.equal(evidence.candidates[0].is_official, true);
  assert.ok(evidence.candidates[0].evidence_count >= 2);
  assert.ok(evidence.candidates[0].supporting_sources.some((source) => /shop\.deere\.com/.test(source)));

  const decision = decisions.createAssistantDecision({ text: message, candidates: evidence.candidates, unresolvedQuestions: ['serial_or_chassis'], automaticReplyEnabled: false, domain: 'agricultural_parts' });
  assert.equal(decision.selected_action, 'ANSWER_WITH_OPTIONS');
  assert.equal(decision.execution.status, 'awaiting_human_review');
  assert.equal(decision.auto_reply_eligible, false);
});

test('agricultural golden prompts are searchable across supported machine patterns', () => {
  for (const message of ['S540 rolamento garganta lado direito', 'CH570 corrente elevador', '7215J correia ventilador']) {
    const input = research.inferTechnicalResearchInput(message);
    assert.ok(input.model, message);
    assert.equal(research.isTechnicalResearchNeeded({ text: message, model: input.model }), true);
    assert.ok(research.planTechnicalResearchQueries(input).some((query) => query.includes(input.model)), message);
  }
});

test('auto parts fixture separates named model from year', () => {
  const input = research.inferTechnicalResearchInput('Filtro de óleo Compass 2021');
  assert.equal(input.model, 'Compass');
  assert.equal(input.year, '2021');
  assert.match(input.part_description, /filtro de óleo/i);
});

test('retail and generic requests do not inherit agricultural research rules', () => {
  const retail = research.inferTechnicalResearchInput('Tem camiseta G preta?', [], { segment: 'roupas' });
  assert.equal(research.isTechnicalResearchNeeded({ text: retail.user_text, model: retail.model, manufacturer: retail.manufacturer }), false);
  const generic = research.inferTechnicalResearchInput('Preciso de um filtro');
  assert.equal(research.isTechnicalResearchNeeded({ text: generic.user_text, model: generic.model, manufacturer: generic.manufacturer }), false);
  const decision = decisions.createAssistantDecision({ text: generic.user_text, unresolvedQuestions: ['equipment_or_application'], automaticReplyEnabled: false });
  assert.equal(decision.selected_action, 'ASK_CUSTOMER');
});

test('PIN is requested only when it distinguishes remaining agricultural variants', () => {
  assert.equal(agricultural.AgriculturalPartsSpecialist.nextBestQuestion([{ part_number: 'A', serial_range: '100-200' }, { part_number: 'B', serial_range: '201-300' }]), 'serial_or_pin');
  assert.equal(agricultural.AgriculturalPartsSpecialist.nextBestQuestion([{ part_number: 'A', system: 'primary' }, { part_number: 'B', system: 'final' }]), 'system_or_assembly');
  assert.equal(agricultural.AgriculturalPartsSpecialist.nextBestQuestion([{ part_number: 'A' }]), null);
});

test('grave source conflict blocks automatic eligibility and requires handoff', () => {
  const decision = decisions.createAssistantDecision({ text: 'Qual peça devo usar?', candidates: [{ part_number: 'A1', confidence_level: 'HIGH' }], graveConflict: true, automaticReplyEnabled: true });
  assert.equal(decision.selected_action, 'HANDOFF_HUMAN');
  assert.equal(decision.auto_reply_eligible, false);
  assert.equal(decision.policy_result.reason, 'grave_source_conflict');
});
