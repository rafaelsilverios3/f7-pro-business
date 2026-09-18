import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUTURE_TRAINING_GUIDES, TRAINING_GUIDES, getNextTrainingGuide, getTrainingForJourney, getTrainingGuide } from '../src/content/training/trainingContent.js';

const required = ['id', 'module', 'title', 'shortDescription', 'whyItMatters', 'whenToUse', 'beforeYouStart', 'mainActions', 'stepByStep', 'whatHappensNext', 'connections', 'commonMistakes', 'tips', 'nextRecommendedModule', 'route', 'requiredFeature', 'audience', 'trainingScript', 'videoUrl'];
const ids = new Set(TRAINING_GUIDES.map((guide) => guide.id));

test('training registry covers the twelve first-cycle modules with complete content', () => {
  assert.deepEqual([...ids], ['dashboard', 'clientes', 'catalogo', 'precificacao', 'estoque', 'compras', 'orcamentos', 'vendas', 'pdv', 'producao', 'financeiro', 'metas']);
  for (const guide of TRAINING_GUIDES) {
    for (const field of required) assert.ok(Object.hasOwn(guide, field), `${guide.id} is missing ${field}`);
    assert.ok(guide.mainActions.length > 0 && guide.stepByStep.length > 0);
    assert.equal(guide.videoUrl, null);
    assert.equal(typeof guide.trainingScript.opening, 'string');
  }
});

test('routes resolve to canonical guides and every route exists in App', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const guide of TRAINING_GUIDES) {
    assert.equal(getTrainingGuide(guide.route).id, guide.id);
    assert.match(app, new RegExp(`path=["']${guide.route.replace('/', '\\/')}["']`));
  }
});

test('journeys expose an ordered next step without marking operations complete', () => {
  for (const journey of ['commerce', 'services', 'production']) {
    const guides = getTrainingForJourney(journey);
    assert.equal(guides[0].id, 'dashboard');
    assert.ok(guides.every((guide) => guide.route && !guide.completionRule));
    assert.equal(getNextTrainingGuide(guides[0].id, journey).id, guides[1].id);
  }
});

test('educational state remains separate from plan and permission gates', () => {
  for (const guide of FUTURE_TRAINING_GUIDES) assert.ok(guide.requiredFeature);
  assert.equal(TRAINING_GUIDES.find((guide) => guide.id === 'financeiro').requiredFeature, null);
  assert.match(TRAINING_GUIDES.find((guide) => guide.id === 'financeiro').whyItMatters, /não representa receita SaaS/i);
});

test('Academia covers the Stage 20 modules and resolves their real routes', () => {
  for (const id of ['materia-prima', 'campanhas', 'configuracoes']) {
    const guide = FUTURE_TRAINING_GUIDES.find((item) => item.id === id);
    assert.ok(guide, `missing future guide ${id}`);
    assert.equal(getTrainingGuide(id).id, id);
    assert.ok(guide.route.startsWith('/'));
  }
});

test('help drawer is accessible, mobile-safe and does not mutate onboarding evidence', () => {
  const source = fs.readFileSync(new URL('../src/components/training/ModuleHelp.jsx', import.meta.url), 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /max-h-\[90dvh\]/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.doesNotMatch(source, /markEducativeStepSeen|setJourney|buildOnboardingProgress/);
});
