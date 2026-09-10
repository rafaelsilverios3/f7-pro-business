import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0044_company_knowledge_feedback.sql', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const inbox = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const service = fs.readFileSync('src/services/assistantFeedbackService.js', 'utf8');

test('0044 unifies typed company knowledge with provenance and verification', () => {
  assert.match(migration, /create table if not exists public\.company_knowledge/);
  for (const field of ['company_id', 'knowledge_type', 'source_type', 'confidence', 'scope', 'verified_at', 'verified_by']) assert.match(migration, new RegExp(field));
  for (const type of ['verified_fact', 'resolved_case', 'customer_preference', 'supplier_knowledge', 'product_knowledge']) assert.match(migration, new RegExp(type));
  assert.match(migration, /where status = 'active'/);
  assert.doesNotMatch(migration, /fine.?tun/i);
});

test('verified product applications remain the canonical application table', () => {
  assert.doesNotMatch(migration, /create table if not exists public\.verified_applications/);
  assert.ok(fs.existsSync('supabase/migrations/0039_product_intelligence.sql'));
  assert.match(fs.readFileSync('supabase/migrations/0039_product_intelligence.sql', 'utf8'), /verified_product_applications/);
});

test('feedback is immutable, company scoped and promotes knowledge only after explicit verification', () => {
  assert.match(migration, /create table if not exists public\.assistant_feedback/);
  for (const type of ['accepted', 'edited', 'rejected', 'part_confirmed', 'part_corrected', 'application_confirmed']) assert.match(migration, new RegExp(type));
  assert.match(migration, /promote_assistant_feedback_to_knowledge/);
  assert.match(migration, /feedback_type not in \('part_confirmed','part_corrected','application_confirmed'\)/);
  assert.doesNotMatch(migration, /grant update.*assistant_feedback|grant delete.*assistant_feedback/i);
  assert.match(migration, /exists \(select 1 from public\.conversations c where c\.id = conversation_id and c\.company_id = company_id\)/);
});

test('assistant consumes only active verified company knowledge in its company context', () => {
  assert.match(assistant, /resource: 'company_knowledge'/);
  assert.match(assistant, /eq\('status', 'active'\)/);
  assert.match(assistant, /VERIFIED_COMPANY_KNOWLEDGE/);
  assert.match(assistant, /knowledge: verifiedKnowledge/);
});

test('human send records accepted or edited suggestions and rejection is explicit', () => {
  assert.match(inbox, /type: text === assistantDraft\.original \? 'accepted' : 'edited'/);
  assert.match(inbox, /type: 'rejected'/);
  assert.match(service, /assistant_feedback/);
  assert.match(service, /promote_assistant_feedback_to_knowledge/);
});
