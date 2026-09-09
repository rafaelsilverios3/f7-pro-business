import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const decision = fs.readFileSync('supabase/functions/_shared/assistantDecision.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0041_autonomous_assistant.sql', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');

test('autonomous decision engine is confidence and guardrail based', () => {
  assert.match(decision, /AssistantDecision/);
  for (const action of ['SEARCH_MORE', 'ASK_CUSTOMER', 'ANSWER_WITH_OPTIONS', 'ANSWER_CONFIDENTLY', 'HANDOFF_HUMAN']) assert.match(decision, new RegExp(action));
  assert.match(decision, /automaticReplyEnabled/);
  assert.match(decision, /graveConflict/);
  assert.match(decision, /auto_reply_eligible/);
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

test('assisted endpoint exposes a decision but never approves automatic reply', () => {
  assert.match(assistant, /createAssistantDecision/);
  assert.match(assistant, /automaticReplyEnabled: false/);
  assert.match(assistant, /decision: assistantDecision/);
  assert.doesNotMatch(assistant, /whatsapp-send/);
});
