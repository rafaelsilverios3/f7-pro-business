import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { handleWhatsAppWebhookRequest } from './index.ts';

const baseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const dbContainer = Deno.env.get('E2E_DB_CONTAINER') || '';
const local = baseUrl ? new URL(baseUrl) : null;
if (!local || !['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || !anonKey || !serviceKey || !dbContainer.startsWith('supabase_db_')) {
  throw new Error('WhatsApp webhook E2E requires an explicitly configured local-only Supabase stack.');
}

const admin = createClient(baseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const previousSecret = Deno.env.get('WHATSAPP_APP_SECRET');
const previousProviderEnabled = Deno.env.get('WHATSAPP_PROVIDER_ENABLED');
const previousReceiveEnabled = Deno.env.get('WHATSAPP_RECEIVE_ENABLED');
const createdUsers: string[] = [];
const createdCompanies: string[] = [];

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function localSql(sql: string) {
  const result = await new Deno.Command('docker', { args: ['exec', dbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', sql], stdout: 'piped', stderr: 'piped' }).output();
  if (result.code !== 0) throw new Error('Local WhatsApp webhook database assertion failed.');
  return new TextDecoder().decode(result.stdout).trim();
}
async function sign(secret: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function request(raw: string, signature: string) {
  return new Request('http://127.0.0.1/functions/v1/whatsapp-webhook', { method: 'POST', headers: { 'x-hub-signature-256': signature, 'Content-Type': 'application/json' }, body: raw });
}

Deno.test('WhatsApp inbound: signature, tenant routing, persistence and deduplication with fictitious local data', async () => {
  const secret = `local-whatsapp-${crypto.randomUUID()}`;
  Deno.env.set('WHATSAPP_APP_SECRET', secret);
  Deno.env.set('WHATSAPP_PROVIDER_ENABLED', 'true');
  Deno.env.set('WHATSAPP_RECEIVE_ENABLED', 'true');
  const nonce = crypto.randomUUID();
  const email = `whatsapp-${nonce}@example.invalid`;
  const password = `${crypto.randomUUID()}!Aa9`;
  let ownerClient: any;
  let companyId = '';
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert(!created.error && created.data.user, 'local WhatsApp fixture user could not be created');
    createdUsers.push(created.data.user.id);
    ownerClient = createClient(baseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const session = await ownerClient.auth.signInWithPassword({ email, password });
    assert(!session.error, 'local WhatsApp fixture login failed');
    const company = await ownerClient.rpc('create_company_with_owner', { company_name: `WhatsApp E2E ${nonce.slice(0, 8)}` });
    assert(!company.error && company.data?.id, 'local WhatsApp company fixture could not be created');
    companyId = company.data.id;
    createdCompanies.push(companyId);
    const phoneId = `local-phone-${nonce.slice(0, 16)}`;
    const integration = await admin.from('company_integrations').upsert({ company_id: companyId, provider: 'whatsapp', status: 'connected', external_phone_id: phoneId }, { onConflict: 'company_id,provider' });
    assert(!integration.error, 'local WhatsApp integration fixture could not be created');

    const providerMessageId = `local-wa-${nonce}`;
    const phone = '5511999999999';
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: phone, profile: { name: 'Contato Fictício' } }],
      messages: [{ from: phone, id: providerMessageId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Mensagem de teste local' } }],
    } }] }] });
    const digest = await sign(secret, raw);
    const invalid = await handleWhatsAppWebhookRequest(request(raw, `sha256=${'0'.repeat(64)}`), { adminClient: admin });
    assert(invalid.status === 401 && (await invalid.json()).error === 'INVALID_SIGNATURE', 'invalid signature was not rejected');
    const beforeInvalid = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('external_message_id', providerMessageId);
    assert(beforeInvalid.count === 0, 'invalid signature produced a persisted message');

    const first = await handleWhatsAppWebhookRequest(request(raw, `sha256=${digest}`), { adminClient: admin });
    assert(first.status === 200 && (await first.json()).ok === true, 'valid signed webhook was not accepted');
    const message = await admin.from('messages').select('id,company_id,channel,sender_type,content,external_message_id').eq('company_id', companyId).eq('external_message_id', providerMessageId).single();
    assert(!message.error && message.data.channel === 'whatsapp' && message.data.sender_type === 'customer' && message.data.content === 'Mensagem de teste local', 'signed incoming message was not persisted to the correct company');
    const usageBeforeDuplicate = await localSql(`select coalesce(sum(count),0) from public.usage_counters where company_id='${companyId}' and metric='whatsapp_messages_received'`);
    const second = await handleWhatsAppWebhookRequest(request(raw, `sha256=${digest}`), { adminClient: admin });
    assert(second.status === 200, 'duplicate signed webhook did not return success');
    const messageCount = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('external_message_id', providerMessageId);
    const usageAfterDuplicate = await localSql(`select coalesce(sum(count),0) from public.usage_counters where company_id='${companyId}' and metric='whatsapp_messages_received'`);
    assert(messageCount.count === 1 && usageAfterDuplicate === usageBeforeDuplicate, 'duplicate webhook repeated the message or usage increment');
  } finally {
    if (companyId) await localSql(`delete from public.companies where id='${companyId}'`).catch(() => '');
    for (const userId of createdUsers) await admin.auth.admin.deleteUser(userId);
    if (previousSecret === undefined) Deno.env.delete('WHATSAPP_APP_SECRET'); else Deno.env.set('WHATSAPP_APP_SECRET', previousSecret);
    if (previousProviderEnabled === undefined) Deno.env.delete('WHATSAPP_PROVIDER_ENABLED'); else Deno.env.set('WHATSAPP_PROVIDER_ENABLED', previousProviderEnabled);
    if (previousReceiveEnabled === undefined) Deno.env.delete('WHATSAPP_RECEIVE_ENABLED'); else Deno.env.set('WHATSAPP_RECEIVE_ENABLED', previousReceiveEnabled);
  }
});
