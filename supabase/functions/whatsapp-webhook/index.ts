import { corsHeaders, json, admin } from '../_shared/core.ts';
import { normalizePhone } from '../_shared/phone.ts';
import { messageContent, webhookItems, timestamp } from '../_shared/webhook.ts';

async function validSignature(req: Request, body: string) {
  const signature = req.headers.get('x-hub-signature-256') || '';
  if (!signature.startsWith('sha256=')) return false;
  const secret = Deno.env.get('WHATSAPP_APP_SECRET') || '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from((signature.slice(7).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body));
}

async function logSafe(sb: any, companyId: string | null, event: string, status: string, metadata: Record<string, unknown>) {
  try { await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event, status, metadata }); } catch { /* logging never blocks webhook */ }
}

async function processStatus(sb: any, companyId: string, status: any) {
  if (!status?.id) return;
  const update: Record<string, unknown> = { external_status: String(status.status || 'unknown'), external_status_at: timestamp(status.timestamp) };
  const error = status.errors?.[0];
  if (error) { update.external_error_code = error.code ? String(error.code).slice(0, 80) : null; update.external_error_title = error.title ? String(error.title).slice(0, 200) : null; update.external_error_details = String(error.message || error.error_data?.details || '').slice(0, 500) || null; }
  else { update.external_error_code = null; update.external_error_title = null; update.external_error_details = null; }
  const result = await sb.from('messages').update(update).eq('external_message_id', status.id).eq('channel', 'whatsapp').eq('company_id', companyId);
  if (result.error) throw result.error;
  await logSafe(sb, companyId, 'whatsapp_status', 'success', { external_id: status.id, status: update.external_status });
}

async function processMessage(sb: any, value: any, message: any) {
  if (!message?.id || !value?.metadata?.phone_number_id) return;
  const { data: integration } = await sb.from('company_integrations').select('company_id').eq('provider', 'whatsapp').eq('external_phone_id', value.metadata.phone_number_id).eq('status', 'connected').maybeSingle();
  if (!integration) return;
  const companyId = integration.company_id;
  const phone = normalizePhone(message.from || '');
  const profile = value.contacts?.find((contact: any) => contact.wa_id === message.from)?.profile?.name || value.contacts?.[0]?.profile?.name || null;
  let customerId = null;
  if (phone) { const customer = await sb.from('customers').select('id').eq('company_id', companyId).eq('phone', phone).maybeSingle(); customerId = customer.data?.id || null; }
  await sb.from('whatsapp_contacts').upsert({ company_id: companyId, customer_id: customerId, wa_id: String(message.from || ''), phone, name: profile }, { onConflict: 'company_id,wa_id' });
  let conversation = (await sb.from('conversations').select('id').eq('company_id', companyId).eq('channel', 'whatsapp').eq('lead_phone', phone).in('status', ['open', 'ai', 'waiting_human', 'in_progress']).maybeSingle()).data;
  if (!conversation) { const created = await sb.from('conversations').insert({ company_id: companyId, customer_id: customerId, channel: 'whatsapp', status: 'open', lead_phone: phone, lead_name: profile, last_message_at: new Date().toISOString() }).select('id').single(); if (created.error) throw created.error; conversation = created.data; }
  const parsed = messageContent(message); const existing = await sb.from('messages').select('id').eq('company_id', companyId).eq('channel', 'whatsapp').eq('external_message_id', message.id).maybeSingle(); const inserted = await sb.from('messages').upsert({ company_id: companyId, conversation_id: conversation.id, sender_type: 'customer', content: parsed.content, message_type: parsed.type, channel: 'whatsapp', external_message_id: message.id, external_status: 'received', external_status_at: new Date().toISOString() }, { onConflict: 'company_id,channel,external_message_id' });
  if (inserted.error) throw inserted.error;
  await sb.from('conversations').update({ last_message_at: new Date().toISOString(), customer_id: customerId || undefined }).eq('id', conversation.id).eq('company_id', companyId);
  if (!existing.data) await sb.rpc('increment_usage', { target_company: companyId, target_metric: 'whatsapp_messages_received', target_period: new Date().toISOString().slice(0, 10), amount: 1 });
  await logSafe(sb, companyId, 'whatsapp_inbound', 'success', { external_id: message.id, message_type: parsed.type });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'GET') { const url = new URL(req.url); if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN')) return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }); return json({ error: 'verification failed' }, 403); }
  try {
    const raw = await req.text(); if (raw.length > 2_000_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413); if (!(await validSignature(req, raw))) return json({ error: 'INVALID_SIGNATURE' }, 401);
    const payload = JSON.parse(raw); const sb = admin();
    for (const value of webhookItems(payload)) {
      const companyId = (await sb.from('company_integrations').select('company_id').eq('provider', 'whatsapp').eq('external_phone_id', value.metadata?.phone_number_id || '').eq('status', 'connected').maybeSingle()).data?.company_id || null;
      if (Array.isArray(value.statuses)) for (const status of value.statuses) { try { if (companyId) await processStatus(sb, companyId, status); } catch { await logSafe(sb, companyId, 'whatsapp_webhook_error', 'error', { item: 'status', external_id: status?.id || null }); } }
      if (Array.isArray(value.messages)) for (const message of value.messages) { try { await processMessage(sb, value, message); } catch { await logSafe(sb, companyId, 'whatsapp_webhook_error', 'error', { item: 'message', external_id: message?.id || null }); } }
    }
    return json({ ok: true });
  } catch { return json({ error: 'INVALID_WEBHOOK' }, 400); }
});

