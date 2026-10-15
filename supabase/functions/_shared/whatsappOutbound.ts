import { normalizePhone } from './phone.ts';

const OUTBOX_LEASE_MS = 30_000;

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
  let outboxId: string | null = null;
  let outboxAttempts = 1;
  if (conversation.channel !== 'whatsapp' || !content || content.length > 4000) return failure(sb, companyId, requestId, 'INVALID_PAYLOAD', 'payload_validation', 400);

  if (input.client_request_id) {
    const previous = await sb.from('messages').select('*').eq('company_id', companyId).eq('client_request_id', input.client_request_id).maybeSingle();
    if (previous.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'message_lookup', 500, safeCode(previous.error));
    if (previous.data) return { ok: true, message: previous.data, provider_status: 200, deduplicated: true };
  }

  if (input.client_request_id) {
    const outbox = await sb.from('whatsapp_outbox').select('id,status,provider_message_id,message_id,conversation_id,content,sender_type,sender_user_id,attempts,lease_expires_at,provider_call_started_at').eq('company_id', companyId).eq('client_request_id', input.client_request_id).maybeSingle();
    if (outbox.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'outbox_lookup', 500, safeCode(outbox.error));
    if (outbox.data) {
      if (outbox.data.status === 'sent' && outbox.data.message_id) {
        const stored = await sb.from('messages').select('*').eq('id', outbox.data.message_id).maybeSingle();
        if (!stored.error && stored.data) return { ok: true, message: stored.data, provider_status: 200, deduplicated: true };
      }
      if (outbox.data.status === 'provider_accepted') {
        // Provider acceptance is terminal for delivery: Never send it again.
        if (outbox.data.provider_message_id) {
          const reconciled = await sb.from('messages').insert({ company_id: companyId, conversation_id: conversation.id, sender_type: outbox.data.sender_type || input.sender_type, sender_user_id: outbox.data.sender_user_id || input.sender_user_id || null, content: outbox.data.content || content, message_type: 'text', channel: 'whatsapp', external_message_id: outbox.data.provider_message_id, external_status: 'sent', external_status_at: new Date().toISOString(), client_request_id: input.client_request_id }).select().single();
          if (!reconciled.error && reconciled.data) {
            await sb.from('whatsapp_outbox').update({ status: 'sent', message_id: reconciled.data.id, updated_at: new Date().toISOString() }).eq('id', outbox.data.id).eq('company_id', companyId);
            return { ok: true, message: reconciled.data, provider_status: 200, deduplicated: true };
          }
        }
        return failure(sb, companyId, requestId, 'OUTBOUND_RECONCILIATION_REQUIRED', 'outbox_reconciliation', 409, outbox.data.status);
      }
      if (outbox.data.status === 'sending') {
        const leaseExpired = !outbox.data.lease_expires_at || Date.parse(outbox.data.lease_expires_at) <= Date.now();
        if (!leaseExpired) return failure(sb, companyId, requestId, 'OUTBOUND_IN_FLIGHT', 'outbox_lease', 409, 'sending');
        if (outbox.data.provider_call_started_at) {
          await sb.from('whatsapp_outbox').update({ status: 'delivery_unknown', lease_expires_at: null, last_error_code: 'PROVIDER_RESPONSE_UNKNOWN', updated_at: new Date().toISOString() }).eq('id', outbox.data.id).eq('company_id', companyId).eq('status', 'sending');
          return failure(sb, companyId, requestId, 'OUTBOUND_RECONCILIATION_REQUIRED', 'outbox_reconciliation', 409, 'delivery_unknown');
        }
        await sb.from('whatsapp_outbox').update({ status: 'retryable', lease_expires_at: null, last_error_code: 'LEASE_EXPIRED_BEFORE_PROVIDER_CALL', updated_at: new Date().toISOString() }).eq('id', outbox.data.id).eq('company_id', companyId).eq('status', 'sending');
      }
    }
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
  if (input.client_request_id && !outboxId) {
    const created = await sb.from('whatsapp_outbox').insert({ company_id: companyId, conversation_id: conversation.id, client_request_id: input.client_request_id, content, sender_type: input.sender_type, sender_user_id: input.sender_user_id || null, status: 'pending', attempts: 0 }).select('id,attempts,status').single();
    if (created.error) {
      if (safeCode(created.error) === '23505') {
        const concurrent = await sb.from('whatsapp_outbox').select('id,status,provider_message_id,lease_expires_at,provider_call_started_at,attempts').eq('company_id', companyId).eq('client_request_id', input.client_request_id).maybeSingle();
        if (concurrent.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'outbox_lookup', 500, safeCode(concurrent.error));
        if (concurrent.data?.status === 'provider_accepted' || concurrent.data?.status === 'delivery_unknown' || concurrent.data?.provider_message_id || concurrent.data?.provider_call_started_at) return failure(sb, companyId, requestId, 'OUTBOUND_RECONCILIATION_REQUIRED', 'outbox_reconciliation', 409, concurrent.data?.status || 'delivery_unknown');
        if (concurrent.data && (concurrent.data.status === 'pending' || concurrent.data.status === 'retryable')) {
          outboxId = concurrent.data.id;
          outboxAttempts = Number(concurrent.data.attempts || 0) + 1;
          const claimed = await sb.from('whatsapp_outbox').update({ status: 'sending', attempts: outboxAttempts, lease_expires_at: new Date(Date.now() + OUTBOX_LEASE_MS).toISOString(), attempt_token: requestId, updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId).eq('status', concurrent.data.status).select('id').maybeSingle();
          if (claimed.error || !claimed.data) return failure(sb, companyId, requestId, 'OUTBOUND_IN_FLIGHT', 'outbox_lease', 409, safeCode(claimed.error) || 'concurrent_claim');
        } else return failure(sb, companyId, requestId, 'OUTBOUND_IN_FLIGHT', 'outbox_lease', 409, concurrent.data?.status || 'sending');
      }
      return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'outbox_insert', 500, safeCode(created.error));
    }
    outboxId = created.data?.id || null;
    outboxAttempts = Number(created.data?.attempts || 0) + 1;
    const leaseExpiresAt = new Date(Date.now() + OUTBOX_LEASE_MS).toISOString();
    const claimed = await sb.from('whatsapp_outbox').update({ status: 'sending', attempts: outboxAttempts, lease_expires_at: leaseExpiresAt, attempt_token: requestId, provider_call_started_at: null, updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId).eq('status', 'pending').select('id').maybeSingle();
    if (claimed.error || !claimed.data) return failure(sb, companyId, requestId, 'OUTBOUND_IN_FLIGHT', 'outbox_lease', 409, safeCode(claimed.error) || 'concurrent_claim');
  }
  if (outboxId) {
    const callStarted = await sb.from('whatsapp_outbox').update({ provider_call_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId).eq('status', 'sending').eq('attempt_token', requestId).select('id').maybeSingle();
    if (callStarted.error || !callStarted.data) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'outbox_call_marker', 500, safeCode(callStarted.error) || 'call_not_marked');
  }
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v20.0';
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${version}/${integration.external_phone_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: content } }),
    });
  } catch (error) {
    const errorName = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    if (outboxId) await sb.from('whatsapp_outbox').update({ status: 'delivery_unknown', lease_expires_at: null, last_error_code: errorName === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_RESPONSE_UNKNOWN', updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId).eq('status', 'sending').eq('attempt_token', requestId);
    return failure(sb, companyId, requestId, 'OUTBOUND_RECONCILIATION_REQUIRED', 'outbox_reconciliation', 409, errorName === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_RESPONSE_UNKNOWN');
  }
  const providerPayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (outboxId) await sb.from('whatsapp_outbox').update({ status: 'failed', provider_status: response.status, last_error_code: 'PROVIDER_ERROR', updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId);
    return failure(sb, companyId, requestId, 'PROVIDER_ERROR', 'meta_send', response.status >= 400 && response.status <= 599 ? response.status : 502, null, response.status);
  }
  const externalId = providerPayload?.messages?.[0]?.id;
  if (!externalId) {
    if (outboxId) await sb.from('whatsapp_outbox').update({ status: 'failed', provider_status: response.status, last_error_code: 'PROVIDER_ERROR', updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId);
    return failure(sb, companyId, requestId, 'PROVIDER_ERROR', 'meta_send', 502, null, response.status);
  }
  if (outboxId) {
    const accepted = await sb.from('whatsapp_outbox').update({ status: 'provider_accepted', provider_message_id: externalId, provider_status: response.status, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId).eq('status', 'sending').eq('attempt_token', requestId);
    if (accepted.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'outbox_acceptance', 500, safeCode(accepted.error), response.status);
  }

  const now = new Date().toISOString();
  const inserted = await sb.from('messages').insert({ company_id: companyId, conversation_id: conversation.id, sender_type: input.sender_type, sender_user_id: input.sender_user_id || null, content, message_type: 'text', channel: 'whatsapp', external_message_id: externalId, external_status: 'sent', external_status_at: now, client_request_id: input.client_request_id || null }).select().single();
  if (inserted.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'message_insert', 500, safeCode(inserted.error), response.status);
  if (outboxId) {
    const finalized = await sb.from('whatsapp_outbox').update({ status: 'sent', message_id: inserted.data?.id || null, updated_at: new Date().toISOString() }).eq('id', outboxId).eq('company_id', companyId);
    if (finalized.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'outbox_finalize', 500, safeCode(finalized.error), response.status);
  }
  const conversationUpdate = await sb.from('conversations').update({ last_message_at: now, status: 'in_progress' }).eq('id', conversation.id).eq('company_id', companyId);
  if (conversationUpdate.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'conversation_update', 500, safeCode(conversationUpdate.error));
  const usage = await sb.rpc('increment_usage', { target_company: companyId, target_metric: 'whatsapp_messages_sent', target_period: now.slice(0, 10), amount: 1 });
  if (usage.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'usage_increment', 500, safeCode(usage.error));
  const successLog = await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: input.sender_type === 'assistant' ? 'assistant_message_sent' : 'message_sent', status: 'success', external_id: externalId, metadata: { stage: 'success_log', request_id: requestId, http_status: response.status } });
  if (successLog.error) return failure(sb, companyId, requestId, 'INTERNAL_PROVIDER_ERROR', 'success_log', 500, safeCode(successLog.error));
  return { ok: true, message: inserted.data, provider_status: response.status, deduplicated: false };
}
