import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const send = fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8');
const page = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');

test('connected WhatsApp integration is valid without optional business/account ids or frontend flag', () => {
  assert.match(send, /eq\('company_id', companyId\).*eq\('provider', 'whatsapp'\)/s);
  assert.match(send, /integration\.status !== 'connected'/);
  assert.match(send, /external_phone_id/);
  assert.doesNotMatch(send, /integration\.status !== 'connected' \|\| Deno\.env\.get\('WHATSAPP_ENABLED'\)/);
});

test('send diagnostics distinguish missing, disconnected and missing phone id', () => {
  for (const code of ['INTEGRATION_NOT_FOUND', 'INTEGRATION_NOT_CONNECTED', 'PHONE_ID_MISSING']) assert.match(send, new RegExp(code));
  assert.match(send, /integration_found/);
  assert.match(send, /has_external_phone_id/);
});

test('frontend maps safe integration resolution errors', () => {
  assert.match(page, /Integração do WhatsApp não encontrada/);
  assert.match(page, /integração de envio não está ativa/);
  assert.match(page, /identificador do número do WhatsApp não está configurado/);
});
