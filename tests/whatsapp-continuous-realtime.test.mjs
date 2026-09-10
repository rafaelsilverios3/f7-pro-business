import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const inbox = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const send = fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8');
const outbound = fs.readFileSync('supabase/functions/_shared/whatsappOutbound.ts', 'utf8');

test('WhatsApp webhook reuses the latest company conversation regardless of commercial status', () => {
  assert.match(webhook, /eq\('channel', 'whatsapp'\).*eq\('lead_phone', phone\).*order\('last_message_at'/s);
  assert.match(webhook, /status === 'finished' \? 'open'/);
  assert.match(webhook, /eq\('company_id', companyId\)/);
});

test('inbox subscribes to company-scoped realtime conversations and messages with cleanup', () => {
  assert.match(inbox, /postgres_changes/);
  assert.match(inbox, /table: 'conversations'/);
  assert.match(inbox, /table: 'messages'/);
  assert.match(inbox, /row\.company_id\) return row\.company_id === company\.id/);
  assert.match(inbox, /removeChannel\(channel\)/);
});

test('manual sending disables duplicate clicks and preserves text on safe errors', () => {
  assert.match(inbox, /sending/);
  assert.match(inbox, /setMessage\(''\)/);
  assert.match(inbox, /INTERNAL_PROVIDER_ERROR/);
  assert.match(inbox, /Enviando\.\.\./);
  assert.match(send, /sendWhatsAppText/);
  assert.match(outbound, /'message_insert'/);
  assert.doesNotMatch(inbox, /WHATSAPP_ACCESS_TOKEN|Authorization\s*:/);
});

test('outbound persistence uses a pre-send outbox and never resends provider-accepted requests', () => {
  assert.match(outbound, /whatsapp_outbox/);
  assert.match(outbound, /status: 'provider_accepted'/);
  assert.match(outbound, /OUTBOUND_RECONCILIATION_REQUIRED/);
  assert.match(outbound, /Never[\s\S]*send it again/);
});
