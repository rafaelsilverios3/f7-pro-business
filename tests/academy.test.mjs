import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUTURE_TRAINING_GUIDES, TRAINING_GUIDES, getSeenTrainingGuides, markTrainingGuideSeen, searchTrainingGuides } from '../src/content/training/trainingContent.js';

const page = fs.readFileSync(new URL('../src/pages/Academy.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const subscription = fs.readFileSync(new URL('../src/services/subscriptionService.js', import.meta.url), 'utf8');

test('Academia F7 has a permanent route, detail route and trial access', () => {
  assert.match(app, /path="\/treinamento"/);
  assert.match(app, /path="\/treinamento\/:moduleId"/);
  assert.match(subscription, /TRIAL_ALLOWED_PATHS = \[[^\]]*'\/treinamento'/);
  assert.match(app, /location\.pathname\.startsWith\(`\$\{path\}\/`\)/);
});

test('Academy home presents first steps, navigation groups, trails and factual FAQ', () => {
  for (const label of ['Academia F7', 'Aprenda a usar o F7 Business', 'Continuar aprendendo', 'Primeiros passos', 'Como o F7 se conecta', 'Dúvidas frequentes']) assert.match(page, new RegExp(label));
  for (const label of ['Comece aqui', 'Cadastros', 'Operação', 'Gestão', 'Inteligência']) assert.match(page, new RegExp(label));
  assert.match(page, /Orçamento movimenta estoque/);
  assert.match(page, /a Academia não executa nenhuma operação/i);
});

test('Academy search uses only centralized content and keywords', () => {
  assert.equal(searchTrainingGuides('valor de venda')[0].id, 'precificacao');
  assert.equal(searchTrainingGuides('venda rápida')[0].id, 'pdv');
  assert.equal(searchTrainingGuides('como fazer orçamento')[0].id, 'orcamentos');
  assert.match(page, /searchTrainingGuides\(query/);
  assert.doesNotThrow(() => searchTrainingGuides('intelligence', FUTURE_TRAINING_GUIDES));
  assert.doesNotMatch(page, /customersRepository|productsRepository|salesRepository|financial_entries/);
});

test('training progress is user and tenant scoped and remains local only', () => {
  assert.match(page, /getSeenTrainingGuides\(company\?\.id, user\?\.id\)/);
  assert.match(page, /markTrainingGuideSeen\(company\.id, user\.id/);
  assert.match(page, /setJourney\(company\.id, value\)/);
  assert.doesNotMatch(page, /create|update|delete|insert/i);
  assert.match(fs.readFileSync(new URL('../src/content/training/trainingContent.js', import.meta.url), 'utf8'), /f7_training_seen:\$\{companyId\}:\$\{userId\}/);
});

test('permissions and plan gates filter modules without inventing training videos', () => {
  assert.match(page, /canAccessGuide/);
  assert.match(page, /lockedByPlan/);
  assert.match(page, /navigate\('\/planos'\)/);
  for (const guide of TRAINING_GUIDES) assert.equal(guide.videoUrl, null);
  assert.ok(FUTURE_TRAINING_GUIDES.every((guide) => guide.requiredFeature));
  assert.match(page, /currentVideo\?\.videoUrl &&/);
});

test('responsive and accessible training surfaces are structural', () => {
  assert.match(page, /max-w-6xl/);
  assert.match(page, /sm:grid-cols-2/);
  assert.match(page, /aria-label="Buscar conteúdo da Academia F7"/);
  assert.match(fs.readFileSync(new URL('../src/components/training/ModuleHelp.jsx', import.meta.url), 'utf8'), /role="dialog"/);
});

test('Stage 20 adds the lightweight future F7 guide without an avatar or side effects', () => {
  const guide = fs.readFileSync(new URL('../src/components/training/F7GuidePrompt.jsx', import.meta.url), 'utf8');
  assert.match(guide, /aria-label="Guia F7"/);
  assert.match(guide, /to = '\/onboarding'/);
  assert.doesNotMatch(guide, /three|canvas|insert\(|update\(|delete\(/i);
  assert.match(fs.readFileSync(new URL('../src/pages/Onboarding.jsx', import.meta.url), 'utf8'), /F7GuidePrompt/);
});

test('local progress helpers fail safely without a browser storage', () => {
  assert.deepEqual(getSeenTrainingGuides('company', 'user'), {});
  assert.doesNotThrow(() => markTrainingGuideSeen('company', 'user', 'dashboard'));
});
