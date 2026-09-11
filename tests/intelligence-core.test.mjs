import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [path.resolve(relativePath)], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const risk = await loadModule('supabase/functions/_shared/actionRisk.ts');
const evidence = await loadModule('supabase/functions/_shared/evidencePolicy.ts');
const specialists = await loadModule('supabase/functions/_shared/specialistRegistry.ts');
const tools = await loadModule('supabase/functions/_shared/toolRegistry.ts');
const engine = await loadModule('supabase/functions/_shared/f7IntelligenceEngine.ts');
const models = await loadModule('supabase/functions/_shared/modelRouter.ts');
const migration = fs.readFileSync('supabase/migrations/0049_f7_autonomous_intelligence_core.sql', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const worker = fs.readFileSync('supabase/functions/assistant-worker/index.ts', 'utf8');
const resolver = fs.readFileSync('supabase/functions/_shared/companyContextResolver.ts', 'utf8');
const inbox = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');

test('autonomy modes and risk matrix fail closed', () => {
  assert.equal(risk.authorizeAutonomousAction('OFF', 'READ_ONLY').disposition, 'BLOCK');
  assert.equal(risk.authorizeAutonomousAction('ASSISTED', 'READ_ONLY').disposition, 'PROPOSE');
  assert.equal(risk.authorizeAutonomousAction('SUPERVISED_AUTONOMOUS', 'READ_ONLY').disposition, 'EXECUTE');
  assert.equal(risk.authorizeAutonomousAction('SUPERVISED_AUTONOMOUS', 'LOW_RISK').disposition, 'EXECUTE_INTERNAL');
  assert.equal(risk.authorizeAutonomousAction('SUPERVISED_AUTONOMOUS', 'MEDIUM_RISK').disposition, 'PROPOSE');
  assert.equal(risk.authorizeAutonomousAction('SUPERVISED_AUTONOMOUS', 'HIGH_RISK').disposition, 'REQUIRE_APPROVAL');
  assert.equal(risk.authorizeAutonomousAction('SUPERVISED_AUTONOMOUS', 'CRITICAL').disposition, 'BLOCK');
  assert.equal(risk.authorizeAutonomousAction('AUTONOMOUS', 'READ_ONLY').reason_code, 'AUTONOMOUS_RESERVED');
  assert.equal(risk.classifyActionRisk('unknown_action'), 'CRITICAL');
});

test('specialists and tools are explicit, versioned and permission-gated', () => {
  for (const id of ['GENERAL_BUSINESS_ASSISTANT','SALES_SPECIALIST','FINANCIAL_SPECIALIST','INVENTORY_SPECIALIST','AGRICULTURAL_PARTS_SPECIALIST']) {
    const specialist = specialists.DomainSpecialistRegistry.get(id);
    assert.equal(specialist.id, id);
    assert.ok(specialist.version >= 1);
    assert.ok(Array.isArray(specialist.capabilities));
  }
  assert.equal(tools.F7ToolRegistry.authorize('InternalCatalogTool', []).reason, 'TOOL_PERMISSION_DENIED');
  assert.equal(tools.F7ToolRegistry.authorize('InternalCatalogTool', ['products.view']).allowed, true);
  assert.equal(tools.F7ToolRegistry.authorize('SalesTool', ['sales.manage']).reason, 'TOOL_DISABLED');
  assert.equal(tools.F7ToolRegistry.authorize('missing', ['*']).reason, 'TOOL_NOT_REGISTERED');
});

test('7230J Brazilian evidence rejects North-American part numbers before model context', () => {
  const candidates = [
    { part_number: 'RE541922', model: '7230J', country: 'BR', region: 'south_america', source_type: 'manufacturer_official', source_url: 'https://parts.example/br' },
    { part_number: 'AM116304', model: '7230J', country: 'US', region: 'north_america', source_type: 'manufacturer_official', source_url: 'https://parts.example/us' },
    { part_number: 'RE526557', model: '7230J', market: 'united_states', source_type: 'public_web', source_url: 'https://catalog.example/us' },
  ];
  const result = evidence.partitionCandidatesByEligibility(candidates, { model: '7230J', country: 'BR', market: 'brazil', region: 'south_america' });
  assert.deepEqual(result.eligible_candidates.map((item) => item.part_number), ['RE541922']);
  assert.deepEqual(new Set(result.rejected_candidates.map((item) => item.part_number)), new Set(['AM116304','RE526557']));
  assert.ok(result.rejected_candidates.every((item) => item.rejection_reasons.includes('REGION_MISMATCH')));
  assert.match(assistant, /rejected_candidates: undefined/);
});

test('intelligence engine validates tenant, depth, specialist and tool authorization', () => {
  const base = {
    company_context: { company_id: 'company-a', autonomy_mode: 'SUPERVISED_AUTONOMOUS' },
    actor: { type: 'SYSTEM' },
    event: { id: 'event-a', company_id: 'company-a', event_type: 'CUSTOMER_MESSAGE_RECEIVED', source_type: 'WHATSAPP', source_id: 'message-a', actor_type: 'CUSTOMER', payload: {}, occurred_at: new Date().toISOString(), correlation_id: 'trace-a', depth: 0, max_depth: 3, idempotency_key: 'message-a' },
    conversation_context: { latest_message: 'Olá, preciso de ajuda' },
    available_tools: tools.F7ToolRegistry.all(),
    available_specialists: specialists.DomainSpecialistRegistry.all(),
    policies: { supervised_only: true }, knowledge: [], memory: [], budget: {},
    permissions: ['conversation.view','assistant_settings.view','assistant.suggest'],
    product_intelligence: { candidates: [], missing_information: [] },
  };
  const result = engine.F7IntelligenceEngine.decide(base);
  assert.equal(result.audit_metadata.chain_of_thought_stored, false);
  assert.equal(result.confidence, 'INSUFFICIENT');
  assert.ok(result.reason_codes.includes('INSUFFICIENT_EVIDENCE'));
  assert.equal(result.proposed_actions[0].risk_level, 'HIGH_RISK');
  assert.deepEqual(result.required_approvals, ['HUMAN_OPERATOR']);
  assert.equal(result.decision.auto_reply_eligible, false);
  assert.throws(() => engine.F7IntelligenceEngine.decide({ ...base, event: { ...base.event, company_id: 'company-b' } }), /TENANT_CONTEXT_MISMATCH/);
  assert.throws(() => engine.F7IntelligenceEngine.decide({ ...base, event: { ...base.event, depth: 4 } }), /INVALID_EVENT_GUARD/);
  assert.throws(() => engine.F7IntelligenceEngine.decide({ ...base, company_context: { company_id: 'company-a', autonomy_mode: 'OFF' } }), /AUTONOMY_OFF/);
  assert.throws(() => engine.F7IntelligenceEngine.decide({ ...base, permissions: [] }), /TOOL_NOT_AUTHORIZED/);
  assert.throws(() => engine.F7IntelligenceEngine.decide({ ...base, budget: { max_tool_calls_per_job: 0 } }), /MAX_TOOL_CALLS_REACHED/);
});

test('model provider is replaceable behind a structured interface', async () => {
  const provider = new models.FunctionModelProvider('fixture', async (input) => ({ ok: true, input }));
  const router = new models.ModelRouter([provider]);
  assert.deepEqual(await router.generateStructured('fixture', { value: 7 }), { ok: true, input: { value: 7 } });
  assert.throws(() => router.generateStructured('missing', {}), /MODEL_PROVIDER_NOT_CONFIGURED/);
});

test('0049 stores idempotent tenant-scoped events, proposals and private memory', () => {
  for (const table of ['intelligence_events','action_proposals','intelligence_memory']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /unique\(company_id, idempotency_key\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /max_autonomous_jobs_per_day/);
  assert.match(migration, /max_autonomous_jobs_per_hour/);
  assert.match(migration, /max_tool_calls_per_job/);
  assert.match(migration, /max_model_calls_per_job/);
  assert.match(migration, /MAX_DEPTH_REACHED/);
  assert.match(migration, /CRITICAL_ACTION_BLOCKED/);
  assert.match(migration, /scope <> 'GLOBAL' or source_type in \('CURATED_PROFESSIONAL','PUBLIC_VERIFIED'\)/);
  assert.match(migration, /NEVER_GLOBALIZE/);
  assert.match(migration, /enable row level security/gi);
  assert.doesNotMatch(migration, /grant all|grant .* to anon/i);
  assert.match(assistant, /WEB_RESEARCH_FALLBACK/);
  assert.match(assistant, /MAX_MODEL_CALLS_REACHED/);
});

test('tenant context and human feedback remain company-scoped', () => {
  assert.ok((resolver.match(/\.eq\('company_id', input\.company_id\)/g) || []).length >= 8);
  assert.match(resolver, /eq\('scope', 'COMPANY'\)/);
  for (const kind of ['APPROVED_AS_IS','APPROVED_WITH_EDIT','REJECTED_WRONG_FACT','REJECTED_WRONG_APPLICATION','REJECTED_WRONG_TONE','REJECTED_INSUFFICIENT_EVIDENCE','REJECTED_OTHER']) assert.match(migration, new RegExp(kind));
  assert.match(migration, /review_intelligence_proposal/);
  assert.match(migration, /current_company_role\(target_company\)/);
});

test('worker and UI enforce proposal-first human control', () => {
  assert.doesNotMatch(worker, /sendWhatsAppText|whatsappOutbound|whatsapp-send/);
  assert.match(worker, /create_action_proposal/);
  for (const text of ['analisado automaticamente','Aprovar e usar','Editar e usar','Rejeitar','Ver investigação']) assert.match(inbox, new RegExp(text, 'i'));
  assert.match(inbox, /setMessage\(decision === 'EDIT'/);
  assert.doesNotMatch(inbox, /reviewAutonomousProposal[\s\S]{0,1000}sendMessage\(/);
});
