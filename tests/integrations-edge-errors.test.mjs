import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/services/integrationsService.js', 'utf8');
const page = fs.readFileSync('src/pages/Integracoes.jsx', 'utf8');

test('non-2xx Edge Function responses are read as JSON and preserve safe Meta fields', () => {
  assert.match(service, /await response\.json\(\)/);
  for (const expression of [/rawMeta\.code/, /rawMeta\.subcode/, /rawMeta\.type/, /rawMeta\.message/, /detail\?\.graph_version/, /detail\?\.http_status/]) assert.match(service, expression);
  assert.match(service, /createIntegrationError\(detail, response\.status\)/);
});

test('generic SDK non-2xx text cannot replace structured diagnostics', () => {
  assert.doesNotMatch(service, /Edge Function returned a non-2xx status code/);
  assert.match(service, /Meta recusou a validação do número/);
  assert.match(page, /metaDiagnostic/);
});

test('browser uses only public Supabase session credentials and never logs them', () => {
  assert.match(service, /supabase\.auth\.getSession\(\)/);
  assert.match(service, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(service, /VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(service, /console\.(log|error).*access_token|console\.(log|error).*Authorization/si);
  assert.doesNotMatch(`${service}\n${page}`, /WHATSAPP_(ACCESS_TOKEN|APP_SECRET|VERIFY_TOKEN)|graph\.facebook\.com/);
});

test('AI remains disabled', () => {
  assert.match(page, /VITE_AI_ENABLED/);
  assert.match(page, /IA desativada/);
});
