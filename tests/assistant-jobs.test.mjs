import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const migration = fs.readFileSync('supabase/migrations/0042_assistant_job_execution.sql', 'utf8');
const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const worker = fs.readFileSync('supabase/functions/assistant-worker/index.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const outbound = fs.readFileSync('supabase/functions/_shared/whatsappOutbound.ts', 'utf8');

async function loadPolicy() {
  const result = await build({ entryPoints: [path.resolve('supabase/functions/_shared/assistantJobPolicy.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const policy = await loadPolicy();

test('0042 completes the queue with atomic claim, bounded retries and server-only access', () => {
  for (const setting of ['allow_official_sources', 'allow_customer_lookup', 'allow_quote_draft', 'max_research_time_ms', 'max_research_cost']) assert.match(migration, new RegExp(setting));
  for (const column of ['message_id', 'attempt_count', 'started_at', 'finished_at', 'next_attempt_at', 'error_code', 'error_stage', 'delivery_started_at']) assert.match(migration, new RegExp(column));
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /attempt_count = attempt_count \+ 1/i);
  assert.match(migration, /on conflict \(company_id, provider_message_id\)/i);
  assert.match(migration, /assistant_jobs_company_message_uidx/);
  assert.match(migration, /delivery_started_at is null/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.assistant_jobs from anon, authenticated/i);
  assert.doesNotMatch(migration, /grant all|grant .* to anon|grant .* to authenticated/i);
});

test('webhook enqueues each new inbound message and dispatches only the internal worker', () => {
  assert.match(webhook, /if \(!existing\.data && inserted\.data\?\.id\) await enqueueAutomaticAssistant/);
  assert.match(webhook, /enqueue_assistant_job/);
  assert.match(webhook, /assistant-worker/);
  assert.match(webhook, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(webhook, /automatic.*sale|auto_sale/i);
});

test('worker uses a scoped job, an independent policy and an atomic delivery claim', () => {
  assert.match(worker, /serviceAuthorized/);
  assert.match(worker, /claim_assistant_job/);
  assert.match(worker, /authorizeAutomaticAssistantDelivery/);
  assert.match(worker, /authorize_assistant_job_delivery/);
  assert.ok(
    worker.indexOf("const deliveryClaim = await sb.rpc('authorize_assistant_job_delivery'") <
      worker.indexOf('const outbound = await sendWhatsAppText'),
  );
  assert.match(worker, /client_request_id: job\.id/);
  assert.match(worker, /MAX_ATTEMPTS = 3/);
  assert.doesNotMatch(worker, /sale|payment|stock_decrement|service_role.*frontend/i);
});

test('manual and automatic paths share one outbound implementation', () => {
  assert.match(worker, /sendWhatsAppText/);
  assert.match(fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8'), /sendWhatsAppText/);
  assert.match(outbound, /sender_type: 'user' \| 'assistant'/);
  assert.match(outbound, /client_request_id/);
});

test('assistant internal execution validates job and automatic company settings', () => {
  assert.match(assistant, /jobResult\.data\.status !== 'processing'/);
  assert.match(assistant, /eq\('company_id', conversation\.company_id\)/);
  assert.match(assistant, /settings\?\.mode !== 'automatic'/);
  assert.match(assistant, /automatic_reply_enabled !== true/);
  assert.match(assistant, /assistant-auto-reply/);
});

test('automatic policy rejects disabled, human, low-confidence, unsafe and malformed outputs', () => {
  const base = { settings: { mode: 'automatic', automatic_reply_enabled: true, auto_reply_min_confidence: 'high' }, decision: { auto_reply_eligible: true, requires_human: false, confidence: 'HIGH', policy_result: { allowed: true }, selected_action: 'ANSWER_WITH_OPTIONS' }, provider_requires_human: false, provider_confidence: 'high', suggestion: 'Resposta segura' };
  assert.equal(policy.authorizeAutomaticAssistantDelivery(base).allowed, true);
  assert.equal(policy.authorizeAutomaticAssistantDelivery({ ...base, settings: { mode: 'automatic', automatic_reply_enabled: false } }).allowed, false);
  assert.equal(policy.authorizeAutomaticAssistantDelivery({ ...base, provider_requires_human: true }).status, 'handed_off');
  assert.equal(policy.authorizeAutomaticAssistantDelivery({ ...base, provider_confidence: 'low' }).reason, 'provider_confidence_below_threshold');
  assert.equal(policy.authorizeAutomaticAssistantDelivery({ ...base, decision: { ...base.decision, selected_action: 'PREPARE_QUOTE' } }).allowed, false);
  assert.equal(policy.authorizeAutomaticAssistantDelivery({ ...base, suggestion: '' }).status, 'failed');
});
