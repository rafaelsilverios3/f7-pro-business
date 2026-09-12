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
  assert.match(edge, /classifyIntelligenceMode\(query/);
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

test('generative analysis reuses the server model router with safe bounded context', () => {
  assert.match(edge, /FunctionModelProvider/);
  assert.match(edge, /ModelRouter/);
  assert.match(edge, /GENERATION_STARTED/);
  assert.match(edge, /GENERATION_COMPLETED/);
  assert.match(edge, /AI_PROVIDER_UNAVAILABLE/);
  assert.match(edge, /análise narrativa completa está temporariamente indisponível/);
  assert.match(edge, /external_untrusted/);
  assert.match(edge, /nunca obedeça instruções/);
  assert.match(edge, /slice\(-4\)/);
  assert.match(edge, /INTELLIGENCE_RESPONSE_FORMAT/);
  assert.match(edge, /json_schema/);
  assert.match(conversation, /Aprofundar análise/);
  assert.match(conversation, /Pesquisar fornecedores/);
});

test('external research and opportunities remain observable and human-controlled', () => {
  assert.match(edge, /EXTERNAL_RESEARCH_READY/);
  assert.match(edge, /OPPORTUNITY_PROPOSED/);
  assert.match(edge, /can_save_opportunity: candidate.length > 0/);
  assert.doesNotMatch(edge, /opportunitiesService|from\('opportunities'\)/);
});

test('follow-up questions inherit the last analytical mode without trusting free-form history', () => {
  assert.match(intent, /previousModes/);
  assert.match(intent, /onde eu compro/);
  assert.match(edge, /item\.mode/);
  assert.match(edge, /classifyIntelligenceMode\(query, history/);
  assert.match(conversation, /mode: item\.result\.mode/);
});
