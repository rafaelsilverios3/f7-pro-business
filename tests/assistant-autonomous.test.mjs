import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const decision = fs.readFileSync('supabase/functions/_shared/assistantDecision.ts', 'utf8');
const orchestrator = fs.readFileSync('supabase/functions/_shared/f7AIOrchestrator.ts', 'utf8');
const tools = fs.readFileSync('supabase/functions/_shared/toolRegistry.ts', 'utf8');
const specialists = fs.readFileSync('supabase/functions/_shared/specialistRegistry.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0041_autonomous_assistant.sql', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const page = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');

test('autonomous decision engine is confidence and guardrail based', () => {
  assert.match(decision, /AssistantDecision/);
  for (const action of ['SEARCH_MORE', 'ASK_CUSTOMER', 'ANSWER_WITH_OPTIONS', 'ANSWER_CONFIDENTLY', 'HANDOFF_HUMAN']) assert.match(decision, new RegExp(action));
  assert.match(decision, /automaticReplyEnabled/);
  assert.match(decision, /graveConflict/);
  assert.match(decision, /auto_reply_eligible/);
  assert.match(decision, /normalizedConfidence/);
  assert.match(decision, /VERIFIED.*HIGH/);
  assert.match(decision, /LIKELY.*MEDIUM/);
  assert.match(decision, /execution/);
});

test('tool registry declares policy metadata and keeps transactional tools disabled', () => {
  for (const field of ['name', 'scope', 'required_permissions', 'input_schema', 'output_schema', 'timeout_ms', 'failure_mode', 'audit_event']) assert.match(tools, new RegExp(field));
  for (const name of ['InternalCatalogTool', 'WebSearchTool', 'OfficialSourceTool', 'PartResearchTool', 'ConversationTool', 'CompanyKnowledgeTool']) assert.match(tools, new RegExp(name));
  assert.match(tools, /blockedTool\('SalesTool'/);
  assert.match(tools, /enabled: false/);
});

test('specialist registry is multisegment and selected by the orchestrator', () => {
  for (const name of ['AgriculturalPartsSpecialist', 'AutoPartsSpecialist', 'RetailSpecialist', 'ElectronicsSpecialist', 'ConstructionMaterialsSpecialist', 'ClothingSpecialist', 'ServiceBusinessSpecialist', 'ProcurementSpecialist', 'SalesSpecialist', 'FinancialSpecialist']) assert.match(specialists, new RegExp(name));
  assert.match(orchestrator, /DomainSpecialistRegistry\.select/);
  assert.match(orchestrator, /F7ToolRegistry\.select/);
  assert.match(decision, /specialist/);
  assert.match(decision, /tools/);
});

test('autonomous assistant configuration defaults to disabled and separates auto reply from sales', () => {
  assert.match(migration, /automatic_reply_enabled boolean not null default false/);
  assert.match(migration, /auto_reply_min_confidence/);
  assert.match(migration, /allow_web_research/);
  assert.match(migration, /allow_product_lookup/);
  assert.match(migration, /allow_price_lookup boolean not null default false/);
  assert.match(migration, /allow_stock_lookup boolean not null default false/);
  assert.match(migration, /assistant_jobs/);
  assert.match(migration, /unique\(company_id, provider_message_id\)/);
  assert.doesNotMatch(migration, /automatic.*sale|auto_sale/i);
});

test('assisted endpoint uses the central orchestrator and never approves automatic reply', () => {
  assert.match(orchestrator, /F7AIOrchestrator/);
  assert.match(orchestrator, /selectDomain/);
  assert.match(assistant, /F7AIOrchestrator\.orchestrate/);
  assert.match(assistant, /automatic_policy: \{ enabled: false \}/);
  assert.match(assistant, /decision: assistantDecision/);
  assert.doesNotMatch(assistant, /whatsapp-send/);
  assert.match(assistant, /Siga a ação selecionada em PRODUCT_INTELLIGENCE\.decision/);
});

test('Smart Atendimento exposes the central decision and keeps human review in control', () => {
  for (const label of ['Modo assistido', 'Confiança:', 'Próxima ação:', 'Ver investigação', 'Rastreamento', 'Fatos', 'Pesquisas', 'Candidatos', 'Fontes']) assert.match(page, new RegExp(label));
  assert.match(page, /awaiting_human_review/);
  assert.match(page, /setMessage\(assistantSuggestion\.suggestion\)/);
  assert.doesNotMatch(page, /InvokeLLM|IA responder/);
});
