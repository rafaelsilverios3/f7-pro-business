import { corsHeaders, json, admin } from '../_shared/core.ts';
import { normalizePhone } from '../_shared/phone.ts';
import { messageContent, mediaDetails, webhookItems, timestamp } from '../_shared/webhook.ts';
import { getWhatsAppWebhookChallenge, verifyWhatsAppWebhookSignature } from '../_shared/whatsappWebhookSecurity.ts';

const MEDIA_LIMIT = 10 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/jpeg','image/png','image/webp','video/mp4','audio/ogg','audio/mpeg','audio/mp4','application/pdf']);
async function downloadMedia(sb: any, companyId: string, conversationId: string, externalId: string, media: any) {
  if (!media?.media_id) return { path: null, size: null };
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN') || '';
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v20.0';
  const metaResponse = await fetch(`https://graph.facebook.com/${version}/${media.media_id}`, { headers: { Authorization: `Bearer ${token}` } });
  const metadata = await metaResponse.json().catch(() => ({}));
  if (!metaResponse.ok || typeof metadata?.url !== 'string') return { path: null, size: null };
  const mime = String(metadata.mime_type || media.mime_type || '').toLowerCase();
  const size = Number(metadata.file_size || 0);
  if (!MEDIA_TYPES.has(mime) || (size > MEDIA_LIMIT)) return { path: null, size: null };
  const fileResponse = await fetch(metadata.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileResponse.ok) return { path: null, size: null };
  const blob = await fileResponse.blob();
  if (blob.size > MEDIA_LIMIT || !MEDIA_TYPES.has((blob.type || mime).toLowerCase())) return { path: null, size: null };
  const ext = (media.filename || media.media_type || 'media').split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  const path = `${companyId}/${conversationId}/${externalId}/${crypto.randomUUID()}.${ext}`;
  const uploaded = await sb.storage.from('whatsapp-media').upload(path, blob, { contentType: blob.type || mime, upsert: false });
  if (uploaded.error) return { path: null, size: null };
  return { path, size: blob.size };
}

async function validSignature(req: Request, body: string) {
  return verifyWhatsAppWebhookSignature(req.headers.get('x-hub-signature-256'), body, Deno.env.get('WHATSAPP_APP_SECRET'));
}

type SafeWebhookError = { stage: string; code: string | null; message: string };

function safeError(error: unknown, stage: string): SafeWebhookError {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof candidate.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(candidate.code) ? candidate.code : null;
  let message = typeof candidate.message === 'string' ? candidate.message : 'Operação do webhook falhou';
  message = message
    .replace(/bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password|authorization|jwt|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[+]?\d[\d\s().-]{7,}\d\b/g, '[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/(['"]).*?\1/g, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted]')
    .slice(0, 240);
  return { stage, code, message };
}

function stageError(error: unknown, stage: string): never {
  throw safeError(error, stage);
}

async function logSafe(sb: any, companyId: string | null, event: string, status: string, metadata: Record<string, unknown>) {
  try {
    const result = await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event, status, metadata });
    return result?.error || null;
  } catch (error) { return error; }
}

async function enqueueSupervisedIntelligence(sb: any, message: { companyId: string; conversationId: string; messageId: string; providerMessageId: string; occurredAt: string }) {
  const settings = await sb.from('company_assistant_settings').select('autonomy_mode').eq('company_id', message.companyId).maybeSingle();
  if (settings.error) stageError(settings.error, 'assistant_settings_lookup');
  if (settings.data?.autonomy_mode !== 'SUPERVISED_AUTONOMOUS') return;
  const queued = await sb.rpc('enqueue_intelligence_event', {
    target_company: message.companyId,
    target_event_type: 'CUSTOMER_MESSAGE_RECEIVED',
    target_source_type: 'WHATSAPP_MESSAGE',
    target_source_id: message.providerMessageId,
    target_conversation: message.conversationId,
    target_message: message.messageId,
    target_actor_type: 'CUSTOMER',
    target_actor_id: null,
    target_payload: { channel: 'whatsapp', message_id: message.messageId },
    target_occurred_at: message.occurredAt,
    target_correlation_id: crypto.randomUUID(),
    target_causation_id: null,
    target_depth: 0,
    target_idempotency_key: `whatsapp:customer_message:${message.providerMessageId}`,
  });
  if (queued.error) stageError(queued.error, 'assistant_job_enqueue');
  const jobId = queued.data?.job_id;
  if (!jobId || queued.data?.status !== 'QUEUED') return;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const dispatch = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/assistant-worker`, { method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) }).catch(() => null);
  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === 'function') {
    (globalThis as any).EdgeRuntime.waitUntil(dispatch);
  }
}

async function processStatus(sb: any, companyId: string, status: any) {
  if (!status?.id) return;
  const update: Record<string, unknown> = { external_status: String(status.status || 'unknown'), external_status_at: timestamp(status.timestamp) };
  const error = status.errors?.[0];
  if (error) { update.external_error_code = error.code ? String(error.code).slice(0, 80) : null; update.external_error_title = error.title ? String(error.title).slice(0, 200) : null; update.external_error_details = String(error.message || error.error_data?.details || '').slice(0, 500) || null; }
  else { update.external_error_code = null; update.external_error_title = null; update.external_error_details = null; }
  const result = await sb.from('messages').update(update).eq('external_message_id', status.id).eq('channel', 'whatsapp').eq('company_id', companyId);
  if (result.error) stageError(result.error, 'status_update');
  const logError = await logSafe(sb, companyId, 'whatsapp_status', 'success', { external_id: status.id, status: update.external_status });
  if (logError) stageError(logError, 'success_log');
}

async function processMessage(sb: any, value: any, message: any) {
  if (!message?.id || !value?.metadata?.phone_number_id) return;
  const integrationResult = await sb.from('company_integrations').select('company_id').eq('provider', 'whatsapp').eq('external_phone_id', value.metadata.phone_number_id).eq('status', 'connected').maybeSingle();
  if (integrationResult.error) stageError(integrationResult.error, 'integration_lookup');
  const integration = integrationResult.data;
  if (!integration) return;
  const companyId = integration.company_id;
  const phone = normalizePhone(message.from || '');
  const profile = value.contacts?.find((contact: any) => contact.wa_id === message.from)?.profile?.name || value.contacts?.[0]?.profile?.name || null;
  let customerId = null;
  if (phone) {
    const customer = await sb.from('customers').select('id').eq('company_id', companyId).eq('phone', phone).maybeSingle();
    if (customer.error) stageError(customer.error, 'customer_lookup');
    customerId = customer.data?.id || null;
  }
  const contactResult = await sb.from('whatsapp_contacts').upsert({ company_id: companyId, customer_id: customerId, wa_id: String(message.from || ''), phone, name: profile }, { onConflict: 'company_id,wa_id' });
  if (contactResult.error) stageError(contactResult.error, 'contact_upsert');
  // WhatsApp contacts have one continuous history. Reuse the most recent
  // conversation regardless of its commercial status; finished/opportunity
  // conversations are reopened or advanced instead of duplicated.
  const conversationResult = await sb.from('conversations').select('id,status,customer_id').eq('company_id', companyId).eq('channel', 'whatsapp').eq('lead_phone', phone).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1);
  if (conversationResult.error) stageError(conversationResult.error, 'conversation_lookup');
  let conversation = conversationResult.data?.[0] || null;
  if (!conversation) {
    const created = await sb.from('conversations').insert({ company_id: companyId, customer_id: customerId, channel: 'whatsapp', status: 'open', lead_phone: phone, lead_name: profile, last_message_at: new Date().toISOString() }).select('id,status').single();
    if (created.error) stageError(created.error, 'conversation_insert');
    conversation = created.data;
  }
  const parsed = messageContent(message);
  const media = mediaDetails(message);
  const storedMedia = media ? await downloadMedia(sb, companyId, conversation.id, message.id, media) : { path: null, size: null };
  const existing = await sb.from('messages').select('id').eq('company_id', companyId).eq('channel', 'whatsapp').eq('external_message_id', message.id).maybeSingle();
  if (existing.error) stageError(existing.error, 'message_lookup');
  const inserted = await sb.from('messages').upsert({ company_id: companyId, conversation_id: conversation.id, sender_type: 'customer', content: media?.caption || parsed.content, message_type: parsed.type, channel: 'whatsapp', external_message_id: message.id, external_status: 'received', external_status_at: new Date().toISOString(), media_path: storedMedia.path, media_mime_type: media?.mime_type || null, media_filename: media?.filename || null, media_size: storedMedia.size, media_caption: media?.caption || null, media_type: media?.media_type || null }, { onConflict: 'company_id,channel,external_message_id' }).select('id').single();
  if (inserted.error) stageError(inserted.error, 'message_upsert');
  const nextStatus = conversation.status === 'finished' ? 'open' : conversation.status === 'opportunity' ? 'opportunity' : conversation.status || 'open';
  const conversationUpdate = await sb.from('conversations').update({ last_message_at: new Date().toISOString(), customer_id: customerId || undefined, lead_name: profile || undefined, status: nextStatus }).eq('id', conversation.id).eq('company_id', companyId);
  if (conversationUpdate.error) stageError(conversationUpdate.error, 'conversation_update');
  if (!existing.data) {
    const usage = await sb.rpc('increment_usage', { target_company: companyId, target_metric: 'whatsapp_messages_received', target_period: new Date().toISOString().slice(0, 10), amount: 1 });
    if (usage.error) stageError(usage.error, 'usage_increment');
  }
  const logError = await logSafe(sb, companyId, 'whatsapp_inbound', 'success', { external_id: message.id, message_type: parsed.type });
  if (logError) stageError(logError, 'success_log');
  if (!existing.data && inserted.data?.id) await enqueueSupervisedIntelligence(sb, { companyId, conversationId: conversation.id, messageId: inserted.data.id, providerMessageId: message.id, occurredAt: timestamp(message.timestamp) });
}

export async function handleWhatsAppWebhookRequest(req: Request, dependencies: { adminClient?: any } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'GET') { const challenge = getWhatsAppWebhookChallenge(new URL(req.url), Deno.env.get('WHATSAPP_VERIFY_TOKEN')); if (challenge !== null) return new Response(challenge, { status: 200 }); return json({ error: 'verification failed' }, 403); }
  const providerEnabled = (Deno.env.get('WHATSAPP_PROVIDER_ENABLED') || '').trim().toLowerCase() === 'true';
  const receiveEnabled = (Deno.env.get('WHATSAPP_RECEIVE_ENABLED') || '').trim().toLowerCase() === 'true';
  if (!providerEnabled || !receiveEnabled) return json({ error: 'WHATSAPP_RECEIVE_DISABLED' }, 503);
  try {
    const raw = await req.text(); if (new TextEncoder().encode(raw).byteLength > 2_000_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413); if (!(await validSignature(req, raw))) return json({ error: 'INVALID_SIGNATURE' }, 401);
    const payload = JSON.parse(raw); const sb = dependencies.adminClient || admin();
    for (const value of webhookItems(payload)) {
      const companyLookup = await sb.from('company_integrations').select('company_id').eq('provider', 'whatsapp').eq('external_phone_id', value.metadata?.phone_number_id || '').eq('status', 'connected').maybeSingle();
      const companyId = companyLookup.data?.company_id || null;
      if (companyLookup.error) {
        const safe = safeError(companyLookup.error, 'integration_lookup');
        for (const item of [...(Array.isArray(value.statuses) ? value.statuses : []), ...(Array.isArray(value.messages) ? value.messages : [])]) {
          await logSafe(sb, companyId, 'whatsapp_webhook_error', 'error', { item: Array.isArray(value.statuses) && value.statuses.includes(item) ? 'status' : 'message', external_id: item?.id || null, stage: safe.stage, code: safe.code, error: safe.message });
        }
        continue;
      }
      if (Array.isArray(value.statuses)) for (const status of value.statuses) {
        try { if (companyId) await processStatus(sb, companyId, status); }
        catch (error) { const safe = error && typeof error === 'object' && 'stage' in error ? error as SafeWebhookError : safeError(error, 'status_processing'); await logSafe(sb, companyId, 'whatsapp_webhook_error', 'error', { item: 'status', external_id: status?.id || null, stage: safe.stage, code: safe.code, error: safe.message }); }
      }
      if (Array.isArray(value.messages)) for (const message of value.messages) {
        try { await processMessage(sb, value, message); }
        catch (error) { const safe = error && typeof error === 'object' && 'stage' in error ? error as SafeWebhookError : safeError(error, 'message_processing'); await logSafe(sb, companyId, 'whatsapp_webhook_error', 'error', { item: 'message', external_id: message?.id || null, stage: safe.stage, code: safe.code, error: safe.message }); }
      }
    }
    return json({ ok: true });
  } catch { return json({ error: 'INVALID_WEBHOOK' }, 400); }
}

if (import.meta.main) Deno.serve((req) => handleWhatsAppWebhookRequest(req));

