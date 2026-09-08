import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const service = fs.readFileSync('src/services/conversationsService.js', 'utf8');
const send = fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');

test('inbox loads conversations and messages scoped to company_id', () => {
  assert.match(service, /from\('conversations'\)[\s\S]*eq\('company_id', companyId\)/);
  assert.match(service, /from\('messages'\)[\s\S]*eq\('company_id', companyId\)/);
  assert.match(page, /conversationSearch/);
  assert.match(page, /statusFilter/);
});

test('WhatsApp replies use the backend function and never call Meta from the browser', () => {
  assert.match(service, /invokeEdgeFunction\('whatsapp-send'/);
  assert.doesNotMatch(`${page}\n${service}`, /graph\.facebook\.com|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET/);
  assert.match(send, /company_users/);
  assert.match(send, /company_id.*companyId/);
  assert.match(send, /ALLOWED_ROLES/);
  assert.match(send, /https:\/\/graph\.facebook\.com/);
});

test('manual send persists real provider id and status, then updates conversation and usage', () => {
  assert.match(send, /external_message_id: externalId/);
  assert.match(send, /external_status: 'sent'/);
  assert.match(send, /conversationUpdate/);
  assert.match(send, /increment_usage/);
  assert.match(send, /message_sent/);
});

test('inbox renders real delivery statuses and keeps AI disabled for Supabase', () => {
  for (const status of ['delivered', 'read', 'failed', 'sent']) assert.match(page, new RegExp(status));
  assert.match(page, /resposta por IA será habilitada/);
  assert.match(permissions, /conversation\.view/);
  assert.match(permissions, /conversation\.manage/);
});
