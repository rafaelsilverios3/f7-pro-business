import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');

test('Realtime subscription exposes connection diagnostics and secure auth', () => {
  assert.match(source, /subscribe\(async \(status\)/);
  assert.match(source, /SUBSCRIBED/);
  assert.match(source, /CHANNEL_ERROR/);
  assert.match(source, /TIMED_OUT/);
  assert.match(source, /CLOSED/);
  assert.match(source, /realtime\.setAuth/);
  assert.doesNotMatch(source, /SERVICE_ROLE|WHATSAPP_ACCESS_TOKEN/);
});

test('Realtime callback filters company events and cleans up channels', () => {
  assert.match(source, /isCurrentCompany/);
  assert.match(source, /payload\?\.new\?\.company_id === company\.id/);
  assert.match(source, /removeChannel\(channel\)/);
  assert.match(source, /smart-atendimento-\$\{company\.id\}/);
});

test('Polling fallback runs only while Realtime is not subscribed', () => {
  assert.match(source, /setInterval\(\(\) => load\(true\), 5000\)/);
  assert.match(source, /realtimeStatus === 'subscribed'/);
  assert.match(source, /Atualização automática em modo compatibilidade/);
});

test('Realtime authenticates before creating and subscribing the channel', () => {
  const authIndex = source.indexOf('await supabase.auth.getSession()');
  const setAuthIndex = source.indexOf('await supabase.realtime.setAuth(token)');
  const channelIndex = source.indexOf(".channel(`smart-atendimento-${company.id}`)");
  const subscribeIndex = source.indexOf('.subscribe(async (status)');
  assert.ok(authIndex >= 0 && setAuthIndex > authIndex && channelIndex > setAuthIndex && subscribeIndex > channelIndex);
  assert.match(source, /if \(cancelled \|\| !token\).*setRealtimeStatus\('compatibility'\)/s);
  assert.match(source, /onAuthStateChange/);
});
