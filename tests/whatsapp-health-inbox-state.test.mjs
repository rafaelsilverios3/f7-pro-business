import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const integrations = fs.readFileSync('src/pages/Integracoes.jsx', 'utf8');
const inbox = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const service = fs.readFileSync('src/services/conversationsService.js', 'utf8');

test('connected WhatsApp status is not downgraded by the frontend feature flag', () => {
  assert.match(integrations, /whatsappConnected/);
  assert.match(integrations, /getWhatsAppIntegrationState\(whatsappHealth, whatsapp\)/);
  assert.match(integrations, /whatsappConnected \|\| whatsappEnabled/);
  assert.match(integrations, /webhook === 'ok' \? 'Funcionando'/);
  assert.match(integrations, /receive === 'ready' \? 'Funcionando'/);
});

test('inbox exposes loading, empty, success and retryable error states', () => {
  assert.match(inbox, /conversationLoading/);
  assert.match(inbox, /conversationError/);
  assert.match(inbox, /Tentar novamente/);
  assert.match(inbox, /conversations\.length === 0/);
  assert.match(inbox, /Promise\.allSettled/);
});

test('Supabase inbox queries remain scoped to company and real messages', () => {
  assert.match(service, /from\('conversations'\).*eq\('company_id', companyId\)/s);
  assert.match(service, /from\('messages'\).*eq\('company_id', companyId\).*in\('conversation_id', ids\)/s);
  assert.doesNotMatch(inbox, /VITE_AI_ENABLED\s*=\s*true/);
});
