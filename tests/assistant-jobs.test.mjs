import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyMigration = fs.readFileSync('supabase/migrations/0042_assistant_job_execution.sql', 'utf8');
const coreMigration = fs.readFileSync('supabase/migrations/0049_f7_autonomous_intelligence_core.sql', 'utf8');
const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const worker = fs.readFileSync('supabase/functions/assistant-worker/index.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');

test('0042 queue remains atomic and 0049 evolves it for intelligence events', () => {
  assert.match(legacyMigration, /for update skip locked/i);
  assert.match(legacyMigration, /attempt_count = attempt_count \+ 1/i);
  assert.match(coreMigration, /intelligence_event_id/);
  assert.match(coreMigration, /waiting_approval/);
  assert.match(coreMigration, /assistant_jobs_company_event_uidx/);
  assert.match(coreMigration, /foreign key \(company_id, intelligence_event_id\)/i);
});

test('webhook emits one idempotent tenant-scoped intelligence event', () => {
  assert.match(webhook, /enqueueSupervisedIntelligence/);
  assert.match(webhook, /enqueue_intelligence_event/);
  assert.match(webhook, /CUSTOMER_MESSAGE_RECEIVED/);
  assert.match(webhook, /whatsapp:customer_message:/);
  assert.match(webhook, /queued\.data\?\.status !== 'QUEUED'/);
  assert.match(webhook, /assistant-worker/);
  assert.match(webhook, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('supervised worker creates an approval proposal and never sends externally', () => {
  assert.match(worker, /serviceAuthorized/);
  assert.match(worker, /claim_assistant_job/);
  assert.match(worker, /intelligence_events/);
  assert.match(worker, /SUPERVISED_AUTONOMOUS/);
  assert.match(worker, /create_action_proposal/);
  assert.match(worker, /waiting_approval/);
  assert.match(worker, /CRITICAL_ACTION_BLOCKED/);
  assert.doesNotMatch(worker, /sendWhatsAppText|whatsappOutbound|graph\.facebook\.com/);
});

test('internal execution requires a processing job and a supervised event', () => {
  assert.match(assistant, /jobResult\.data\.status !== 'processing'/);
  assert.match(assistant, /INTELLIGENCE_EVENT_REQUIRED/);
  assert.match(assistant, /INVALID_INTELLIGENCE_EVENT/);
  assert.match(assistant, /settings\?\.autonomy_mode !== 'SUPERVISED_AUTONOMOUS'/);
  assert.match(assistant, /intelligence-supervised/);
  assert.doesNotMatch(assistant, /automatic_reply_enabled === true/);
});
