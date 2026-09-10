import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0043_structured_assistant_handoffs.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/assistant-worker/index.ts', 'utf8');
const inbox = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const service = fs.readFileSync('src/services/assistantHandoffService.js', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');

test('0043 stores one active company-scoped handoff dossier per conversation', () => {
  assert.match(migration, /create table if not exists public\.assistant_handoffs/);
  for (const field of ['company_id', 'conversation_id', 'assistant_job_id', 'trace_id', 'reason_code', 'known_facts', 'unresolved_facts', 'candidate_snapshot', 'source_snapshot', 'assigned_user_id']) assert.match(migration, new RegExp(field));
  assert.match(migration, /where status in \('pending','assigned'\)/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /INVALID_HANDOFF_SCOPE/);
  assert.match(migration, /INVALID_HANDOFF_JOB_SCOPE/);
});

test('handoff RLS and RPCs preserve company isolation and keep anon out', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.match(migration, /revoke all on table public\.assistant_handoffs from anon/i);
  assert.match(migration, /create_assistant_handoff/);
  assert.match(migration, /claim_assistant_handoff/);
  assert.match(migration, /resolve_assistant_handoff/);
  assert.doesNotMatch(migration, /grant all|grant .* to anon/i);
});

test('automatic handoff persists the decision before finishing the job', () => {
  assert.match(worker, /createAssistantHandoff/);
  assert.ok(worker.indexOf('const handoff = await createAssistantHandoff') < worker.indexOf("await finish(sb, job.id, policy.status"));
  assert.match(worker, /HANDOFF_CREATE_FAILED/);
});

test('Smart Atendimento creates, claims and resolves resumable handoffs', () => {
  for (const method of ['active', 'create', 'claim', 'resolve']) assert.match(service, new RegExp(`${method}: async`));
  assert.match(inbox, /Assumir atendimento/);
  assert.match(inbox, /Concluir handoff/);
  assert.match(inbox, /assistantHandoffService\.create/);
  assert.match(permissions, /assistant_handoff\.view/);
  assert.match(permissions, /assistant_handoff\.manage/);
});

test('automatic assistant messages retain their AI identity in the inbox', () => {
  const conversations = fs.readFileSync('src/services/conversationsService.js', 'utf8');
  assert.match(conversations, /row\.sender_type === 'assistant' \? 'ai'/);
});
