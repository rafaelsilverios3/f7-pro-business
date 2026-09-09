import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const webhookSource = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');

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

test('Polling safety sync remains active even when Realtime is subscribed', () => {
  assert.match(source, /setInterval\(\(\) => loadRef\.current\(true\), 5000\)/);
  assert.match(source, /Keep a low-frequency safety sync even after SUBSCRIBED/);
  assert.match(source, /Atualização automática em modo compatibilidade/);
});

test('Realtime is not considered confirmed before a valid company event arrives', () => {
  assert.match(source, /const \[realtimeEventReceived, setRealtimeEventReceived\] = useState\(false\)/);
  assert.match(source, /setRealtimeEventReceived\(true\)/);
  assert.match(source, /authenticatedRealtime && realtimeEventReceived \? 'Tempo real conectado'/);
});

test('selected conversation uses the same blue-indigo gradient as the main menu', () => {
  assert.match(source, /selected\?\.id === c\.id \? 'bg-gradient-to-r from-blue-600 to-indigo-600/);
  assert.match(source, /selected\?\.id === c\.id \? 'text-white'/);
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

test('Realtime events use explicit company filters and refresh the latest selected state', () => {
  assert.match(source, /filter: `company_id=eq\.\$\{company\.id\}`/);
  assert.match(source, /loadRef\.current\(true\)/);
  assert.match(source, /REALTIME_MESSAGE_\$\{/);
  assert.match(source, /payload\.eventType === 'UPDATE'/);
  assert.match(source, /REALTIME_EVENT_IGNORED/);
});

test('inbox opens the newest loaded conversation when no card is selected', () => {
  assert.match(source, /else if \(convs\[0\]\) \{[\s\S]*setSelected\(convs\[0\]\)/);
});

test('inbox renders WhatsApp delivery states without claiming delivery early', () => {
  assert.match(source, /m\.status === 'sending' \? 'enviando\.\.\.'/);
  assert.match(source, /m\.status === 'sent' \? 'enviada'/);
  assert.match(source, /m\.status === 'delivered' \? 'entregue'/);
  assert.match(source, /m\.status === 'read' \? 'lida'/);
  assert.match(source, /m\.status === 'failed' \? 'falhou'/);
});

test('webhook persists provider delivery callbacks on the matching company message', () => {
  assert.match(webhookSource, /external_status: String\(status\.status \|\| 'unknown'\)/);
  assert.match(webhookSource, /\.eq\('external_message_id', status\.id\)/);
  assert.match(webhookSource, /\.eq\('channel', 'whatsapp'\)/);
  assert.match(webhookSource, /\.eq\('company_id', companyId\)/);
  assert.match(webhookSource, /status\.errors\?\./);
});
