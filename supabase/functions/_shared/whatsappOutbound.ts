import { normalizePhone } from './phone.ts';

export type WhatsAppOutboundResult =
  | { ok: true; message: any; provider_status: number; deduplicated: boolean }
  | { ok: false; code: string; stage: string; status: number; internal_code?: string | null; provider_status?: number | null };

function safeCode(error: unknown) {
  const code = error && typeof error === 'object' && typeof (error as Record<string, unknown>).code === 'string' ? String((error as Record<string, unknown>).code) : '';
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : null;
}

async function failure(sb: any, companyId: string, requestId: string, code: string, stage: string, status: number, internalCode?: string | null, providerStatus?: number | null, diagnostic: Record<string, unknown> = {}): Promise<WhatsAppOutboundResult> {
  await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'message_send_failed', status: 'error', metadata: { stage, code, internal_code: internalCode || undefined, http_status: providerStatus || status, request_id: requestId, ...diagnostic } });
  return { ok: false, code, stage, status, internal_code: internalCode, provider_status: providerStatus };
}

export async function sendWhatsAppText(input: {
  sb: any;
  conversation: { id: string; company_id: string; lead_phone?: string | null; channel?: string };
  message: string;
  client_request_id?: string | null;
  sender_type: 'user' | 'assistant';
  sender_user_id?: string | null;
  request_id?: string;
}): Promise<WhatsAppOutboundResult> {
  const { sb, conversation } = input;
  const requestId = input.request_id || crypto.randomUUID();
  const companyId = conversation.company_id;
  const content = String(input.message || '').trim();
  if (conversation.channel !== 'whatsapp' || !content || content.length > 4000) return failure(sb, companyId, requestId, 'INVALID_PAYLOAD', 'payload_validation', 400);

  if (input.client_request_id) {
    const previous = await sb.from('messages').select('*').eq('company_id', companyId).eq('client_request_id', input.client_request_id).maybeSingle();
    if (previous.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'message_lookup', 500, safeCode(previous.error));
    if (previous.data) return { ok: true, message: previous.data, provider_status: 200, deduplicated: true };
  }

  const integrationResult = await sb.from('company_integrations').select('external_phone_id,status').eq('company_id', companyId).eq('provider', 'whatsapp').maybeSingle();
  if (integrationResult.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'integration_lookup', 500, safeCode(integrationResult.error));
  const integration = integrationResult.data;
  const integrationDiagnostic = { integration_found: Boolean(integration), integration_status: integration?.status || null, has_external_phone_id: Boolean(String(integration?.external_phone_id || '').trim()) };
  if (!integration) return failure(sb, companyId, requestId, 'INTEGRATION_NOT_FOUND', 'integration_lookup', 503, null, null, integrationDiagnostic);
  if (integration.status !== 'connected') return failure(sb, companyId, requestId, 'INTEGRATION_NOT_CONNECTED', 'integration_lookup', 503, null, null, integrationDiagnostic);
  if (!String(integration.external_phone_id || '').trim()) return failure(sb, companyId, requestId, 'PHONE_ID_MISSING', 'integration_lookup', 503, null, null, integrationDiagnostic);

  const to = normalizePhone(conversation.lead_phone || '');
  if (to.length < 8) return failure(sb, companyId, requestId, 'INVALID_PAYLOAD', 'recipient_validation', 400);
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v20.0';
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${version}/${integration.external_phone_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: content } }),
    });
  } catch {
    return failure(sb, companyId, requestId, 'PROVIDER_UNAVAILABLE', 'meta_send', 503);
  }
  const providerPayload = await response.json().catch(() => ({}));
  if (!response.ok) return failure(sb, companyId, requestId, 'PROVIDER_ERROR', 'meta_send', response.status >= 400 && response.status <= 599 ? response.status : 502, null, response.status);
  const externalId = providerPayload?.messages?.[0]?.id;
  if (!externalId) return failure(sb, companyId, requestId, 'PROVIDER_ERROR', 'meta_send', 502, null, response.status);

  const now = new Date().toISOString();
  const inserted = await sb.from('messages').insert({ company_id: companyId, conversation_id: conversation.id, sender_type: input.sender_type, sender_user_id: input.sender_user_id || null, content, message_type: 'text', channel: 'whatsapp', external_message_id: externalId, external_status: 'sent', external_status_at: now, client_request_id: input.client_request_id || null }).select().single();
  if (inserted.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'message_insert', 500, safeCode(inserted.error));
  const conversationUpdate = await sb.from('conversations').update({ last_message_at: now, status: 'in_progress' }).eq('id', conversation.id).eq('company_id', companyId);
  if (conversationUpdate.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'conversation_update', 500, safeCode(conversationUpdate.error));
  const usage = await sb.rpc('increment_usage', { target_company: companyId, target_metric: 'whatsapp_messages_sent', target_period: now.slice(0, 10), amount: 1 });
  if (usage.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'usage_increment', 500, safeCode(usage.error));
  const successLog = await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: input.sender_type === 'assistant' ? 'assistant_message_sent' : 'message_sent', status: 'success', external_id: externalId, metadata: { stage: 'success_log', request_id: requestId, http_status: response.status } });
  if (successLog.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'success_log', 500, safeCode(successLog.error));
  return { ok: true, message: inserted.data, provider_status: response.status, deduplicated: false };
}
