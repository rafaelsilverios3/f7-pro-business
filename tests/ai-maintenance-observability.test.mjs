import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aiMaintenanceResponse, resolveAIMaintenanceMode } from '../supabase/functions/_shared/aiMaintenance.js';
import { buildAIRunPayload, persistAIRun, persistAIRunEvent } from '../supabase/functions/_shared/aiRunPersistence.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const headers = { 'access-control-allow-origin': 'https://preview.example', 'access-control-allow-methods': 'POST, OPTIONS' };

test('maintenance setting distinguishes absent, disabled, active and malformed configuration', async () => {
  assert.deepEqual(resolveAIMaintenanceMode(undefined), { state: 'inactive', configured: false });
  assert.deepEqual(resolveAIMaintenanceMode('  '), { state: 'inactive', configured: false });
  assert.deepEqual(resolveAIMaintenanceMode('false'), { state: 'inactive', configured: true });
  assert.deepEqual(resolveAIMaintenanceMode('TRUE'), { state: 'active', configured: true });
  assert.deepEqual(resolveAIMaintenanceMode('yes'), { state: 'invalid', configured: true });
  assert.equal(aiMaintenanceResponse(undefined, headers), null);
  assert.equal(aiMaintenanceResponse('false', headers), null);
  for (const [setting, code] of [['true', 'AI_MAINTENANCE'], ['unexpected', 'AI_MAINTENANCE_CONFIGURATION_INVALID']]) {
    const response = aiMaintenanceResponse(setting, headers);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('access-control-allow-origin'), headers['access-control-allow-origin']);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.deepEqual(await response.json(), { code, message: 'Este serviço de inteligência está temporariamente indisponível. Tente novamente em alguns minutos.' });
  }
});

test('concurrent maintenance-gated requests do not read business data, reserve budget, or call providers', async () => {
  let businessReads = 0;
  let reservations = 0;
  let providerCalls = 0;
  const execute = async () => {
    const blocked = aiMaintenanceResponse('true', headers);
    if (blocked) return blocked.status;
    businessReads += 1;
    reservations += 1;
    providerCalls += 1;
    return 200;
  };
  const statuses = await Promise.all(Array.from({ length: 32 }, execute));
  assert.deepEqual(new Set(statuses), new Set([503]));
  assert.equal(businessReads, 0);
  assert.equal(reservations, 0);
  assert.equal(providerCalls, 0);
});

test('all four AI endpoints preserve CORS and authorize before maintenance; gate precedes sensitive work', () => {
  const files = [
    ['ai-sales-assistant', read('supabase/functions/ai-sales-assistant/index.ts'), ['consumeRateLimit', 'startRun', 'searchProducts', 'reserveAIModelBudget']],
    ['assistant-suggest', read('supabase/functions/assistant-suggest/index.ts'), ['consume_rate_limit', 'resolveCompanyContext', 'reserveAIModelBudget', 'conductWebResearch']],
    ['intelligence-query', read('supabase/functions/intelligence-query/index.ts'), ['recordRun(sb, companyId, traceId, { current_stage: \'REQUEST_RECEIVED\'', 'reserveAIExternalBudget', 'reserveAIModelBudget', 'conductWebResearch']],
    ['supplier-intelligence', read('supabase/functions/supplier-intelligence/index.ts'), ['saveCandidate', 'reserveAIExternalBudget', 'conductWebResearch']],
  ];
  for (const [name, source, downstream] of files) {
    const preflight = source.indexOf("req.method === 'OPTIONS'");
    const gate = source.indexOf('aiMaintenanceResponse(Deno.env.get(\'AI_MAINTENANCE_MODE\')');
    assert.ok(preflight >= 0 && gate > preflight, `${name}: preflight must remain first`);
    assert.ok(source.indexOf('auth(req)') < gate, `${name}: authentication must precede maintenance response`);
    for (const marker of downstream) {
      const index = source.indexOf(marker, gate);
      assert.ok(index < 0 || gate < index, `${name}: maintenance must precede ${marker}`);
    }
  }

  const sales = files[0][1];
  const salesGates = [...sales.matchAll(/aiMaintenanceResponse\(Deno\.env\.get\('AI_MAINTENANCE_MODE'\)/g)].map((match) => match.index);
  assert.equal(salesGates.length, 2, 'status and commercial actions must both honor maintenance');
  assert.ok(sales.indexOf("feature: 'ai_sales'") < salesGates[0]);
  assert.ok(salesGates[0] < sales.indexOf("'ai-sales-status'") && salesGates[0] < sales.indexOf("from('company_assistant_settings')"), 'status gate precedes status counters and settings reads');
  assert.ok(sales.indexOf('roleHasAiSalesPermissions(member.role, requiredPermissions)') < salesGates[1]);
  assert.ok(sales.indexOf("feature: 'ai_sales'") < salesGates[1]);
  assert.ok(salesGates[1] < sales.indexOf('await consumeRateLimit(sb, companyId, userData.user.id);'), 'chat gate precedes request rate-limit and downstream work');
  const intelligence = files[2][1];
  assert.ok(intelligence.indexOf("feature: 'intelligence'") < intelligence.indexOf('aiMaintenanceResponse('));
  const supplier = files[3][1];
  assert.ok(supplier.indexOf("feature: 'supplier_intelligence'") < supplier.indexOf('aiMaintenanceResponse('));
});

test('internal assistant dispatcher stops before claiming jobs and safely requeues a race at the downstream gate', () => {
  const worker = read('supabase/functions/assistant-worker/index.ts');
  assert.ok(worker.indexOf('serviceAuthorized(req)') < worker.indexOf('aiMaintenanceResponse('));
  assert.ok(worker.indexOf('aiMaintenanceResponse(') < worker.indexOf("rpc('claim_assistant_job'"));
  assert.match(worker, /code === 'AI_MAINTENANCE'[\s\S]*?finish\(sb, job\.id, 'queued'/);
  assert.match(worker, /status: 'PENDING', processed_at: null, safe_error_code: code/);
  const webhook = read('supabase/functions/whatsapp-webhook/index.ts');
  assert.match(webhook, /functions\/v1\/assistant-worker/);
  const assistant = read('supabase/functions/assistant-suggest/index.ts');
  assert.ok(assistant.indexOf('aiMaintenanceResponse(') < assistant.indexOf("from('intelligence_events').select('*')"));
  assert.ok(assistant.indexOf('aiMaintenanceResponse(') < assistant.indexOf("target_metric: internalJobRequest ? 'intelligence-supervised'"));
});

test('ai_runs persistence uses schema fields only and marks completion, failure, and human handoff terminally', () => {
  const now = '2026-10-13T12:00:00.000Z';
  const base = { companyId: 'tenant-a', traceId: 'trace-1', now };
  const running = buildAIRunPayload({ ...base, patch: { status: 'running', current_stage: 'STARTED', started_at: now, tool_count: 2, prompt: 'private prompt' } });
  assert.equal(running.status, 'running');
  assert.equal(running.finished_at, null);
  assert.equal('tool_count' in running, false);
  assert.equal('prompt' in running, false);
  const completed = buildAIRunPayload({ ...base, patch: { status: 'completed', current_stage: 'GENERATION_COMPLETED', tool_names: ['buscar_produto'], input_tokens: 30, output_tokens: 12, estimated_cost: 0.002, duration_ms: 123 } });
  assert.equal(completed.finished_at, now);
  assert.deepEqual(completed.tool_names, ['buscar_produto']);
  assert.equal(completed.input_tokens, 30);
  const handedOff = buildAIRunPayload({ ...base, patch: { status: 'handed_off', current_stage: 'CONFIRMATION_REQUIRED', safe_error_code: 'HUMAN_CONFIRMATION_REQUIRED' } });
  assert.equal(handedOff.status, 'handed_off');
  assert.equal(handedOff.finished_at, now);
  const failed = buildAIRunPayload({ ...base, patch: { status: 'failed', current_stage: 'REQUEST_CANCELLED', safe_error_code: 'AI_REQUEST_CANCELLED' } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.finished_at, now);
  assert.equal(buildAIRunPayload({ ...base, patch: { status: 'completed', tool_count: 1 } }).tool_count, undefined);
});

test('PostgREST observability errors are surfaced as sanitized diagnostics without changing the result', async () => {
  const diagnostics = [];
  const original = console.error;
  console.error = (line) => diagnostics.push(String(line));
  try {
    const fake = { from: (table) => ({ upsert: async () => ({ error: { code: 'PGRST204', message: 'Bearer private-token customer@example.com prompt content' } }), insert: async () => ({ error: { message: 'secret prompt and personal data' } }) }) };
    assert.equal(await persistAIRun(fake, { companyId: 'tenant-a', traceId: 'trace-2', patch: { status: 'completed', current_stage: 'DONE', tool_count: 1 } }), false);
    assert.equal(await persistAIRunEvent(fake, { companyId: 'tenant-a', traceId: 'trace-2', event: { company_id: 'tenant-a', trace_id: 'trace-2', stage: 'DONE', status: 'success', counts: {} } }), false);
  } finally {
    console.error = original;
  }
  assert.equal(diagnostics.length, 2);
  const output = diagnostics.join('\n');
  assert.match(output, /ai_observability_write_failed/);
  assert.match(output, /PGRST204/);
  assert.doesNotMatch(output, /private-token|customer@example\.com|prompt content|personal data/i);
});

test('AI Sales Assistant distinguishes completed factual response, handoff, cancellation, timeout, and confirmed draft', () => {
  const sales = read('supabase/functions/ai-sales-assistant/index.ts');
  assert.match(sales, /awaitingConfirmation \? 'handed_off' : 'completed'/);
  assert.match(sales, /current_stage: 'CONFIRMATION_REQUIRED'/);
  assert.match(sales, /DRAFT_ORDER_CREATED[\s\S]*status: 'completed'/);
  assert.match(sales, /AI_PROVIDER_TIMEOUT/);
  assert.match(sales, /AI_REQUEST_CANCELLED/);
  assert.match(sales, /generated\.code === 'AI_REQUEST_CANCELLED' \? 'failed'/);
  assert.match(sales, /tool_names: \[tool\]/);
  assert.doesNotMatch(sales, /tool_count\s*:/);
});
