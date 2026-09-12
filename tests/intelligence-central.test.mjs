import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/Intelligence.jsx', 'utf8');
const conversation = fs.readFileSync('src/components/intelligence/IntelligenceConversation.jsx', 'utf8');
const service = fs.readFileSync('src/services/intelligenceService.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8');
const intent = fs.readFileSync('supabase/functions/_shared/intelligenceIntent.ts', 'utf8');

test('F7 Intelligence central experience reuses the existing Intelligence page', () => {
  assert.match(page, /IntelligenceConversation/);
  assert.match(conversation, /Pergunte à F7 Intelligence/);
  assert.match(conversation, /Encontrar oportunidades/);
  assert.match(service, /invokeEdgeFunction\('intelligence-query'/);
});

test('server classifies internal, external and hybrid requests without trusting the client', () => {
  assert.match(intent, /type IntelligenceMode = 'internal' \| 'external' \| 'hybrid'/);
  assert.match(intent, /return 'hybrid'/);
  assert.match(intent, /return 'external'/);
  assert.match(intent, /return 'internal'/);
  assert.match(edge, /classifyIntelligenceMode\(query\)/);
  assert.doesNotMatch(conversation, /classifyIntelligenceMode/);
});

test('central query enforces tenant membership and server-side bounded tools', () => {
  assert.match(edge, /eq\('company_id', companyId\)\.eq\('user_id', userData\.user\.id\)/);
  assert.match(edge, /ALLOWED_ROLES/);
  assert.match(edge, /eq\('company_id', companyId\)/);
  assert.match(edge, /reserve_ai_budget/);
  assert.match(edge, /conductWebResearch/);
  assert.doesNotMatch(conversation, /SUPABASE_SERVICE_ROLE_KEY|AI_API_KEY/);
});

test('external provider absence is explicit and never fabricates sources', () => {
  assert.match(edge, /EXTERNAL_RESEARCH_NOT_ALLOWED/);
  assert.match(edge, /EXTERNAL_RESEARCH_UNAVAILABLE/);
  assert.match(edge, /Pesquisa externa ainda não configurada ou indisponível/);
  assert.match(conversation, /Pesquisa externa ainda não configurada/);
  assert.match(conversation, /Fontes consultadas/);
});

test('opportunity persistence remains an explicit human action', () => {
  assert.match(conversation, /Salvar oportunidade/);
  assert.match(conversation, /opportunitiesService\.create/);
  assert.match(edge, /requires_human: true/);
  assert.doesNotMatch(edge, /opportunities.*\.insert|promote/);
});

test('central queries record reusable ai_runs and ai_run_events observability', () => {
  assert.match(edge, /from\('ai_runs'\)/);
  assert.match(edge, /from\('ai_run_events'\)/);
  assert.match(edge, /INTENT_CLASSIFIED/);
  assert.match(edge, /RESPONSE_CREATED/);
});
