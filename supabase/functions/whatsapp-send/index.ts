import { corsHeaders, json, auth, admin } from '../_shared/core.ts';
import { normalizePhone } from '../_shared/phone.ts';

const ALLOWED_ROLES = ['admin', 'gestor', 'comercial', 'vendedor', 'atendimento'];
const MAX_USER = 30;

function safeCode(error: unknown) {
  const code = error && typeof error === 'object' && typeof (error as Record<string, unknown>).code === 'string' ? (error as Record<string, string>).code : null;
  return code && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : null;
}

async function stageFailure(sb: any, companyId: string, stage: string, code: string, status: number, requestId: string) {
  await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'message_send_failed', status: 'error', metadata: { stage, code, http_status: status, request_id: requestId } });
  return json({ code, stage, http_status: status, request_id: requestId }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const requestId = crypto.randomUUID();
  try {
    const jwt = auth(req);
    const sb = admin();
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);

    const body = await req.json();
    const { conversation_id: conversationId, message, client_request_id: clientRequestId } = body;
    if (!conversationId || typeof message !== 'string' || !message.trim() || message.length > 4000) return json({ code: 'INVALID_PAYLOAD' }, 400);

    const { data: conversation, error: conversationError } = await sb.from('conversations').select('id,company_id,lead_phone,channel,status').eq('id', conversationId).maybeSingle();
    if (conversationError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'conversation_lookup', internal_code: safeCode(conversationError) }, 500);
    if (!conversation || conversation.channel !== 'whatsapp') return json({ code: 'NOT_FOUND' }, 404);

    const companyId = conversation.company_id;
    const { data: member, error: memberError } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
    if (memberError) return stageFailure(sb, companyId, 'membership_lookup', safeCode(memberError) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    if (!member?.active || !ALLOWED_ROLES.includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);

    const { data: allowed, error: featureError } = await sb.rpc('company_has_feature', { target_company: companyId, feature: 'whatsapp' });
    if (featureError) return stageFailure(sb, companyId, 'feature_lookup', safeCode(featureError) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    if (!allowed) return json({ code: 'FEATURE_NOT_AVAILABLE' }, 403);

    const limited = await sb.rpc('consume_rate_limit', { target_company: companyId, target_user: user.id, target_metric: 'whatsapp-send', max_count: MAX_USER, window_seconds: 60 });
    if (limited.error || limited.data === false) return stageFailure(sb, companyId, 'rate_limit', limited.error ? (safeCode(limited.error) || 'INTERNAL_PROVIDER_ERROR') : 'RATE_LIMITED', limited.error ? 500 : 429, requestId);

    const { data: integration, error: integrationError } = await sb.from('company_integrations').select('external_phone_id,status').eq('company_id', companyId).eq('provider', 'whatsapp').maybeSingle();
    if (integrationError) return stageFailure(sb, companyId, 'integration_lookup', safeCode(integrationError) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    const integrationMeta = { stage: 'integration_lookup', integration_found: Boolean(integration), integration_status: integration?.status || null, has_external_phone_id: Boolean(String(integration?.external_phone_id || '').trim()), request_id: requestId };
    if (!integration) {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'whatsapp_send_failed', status: 'error', metadata: { ...integrationMeta, code: 'INTEGRATION_NOT_FOUND' } });
      return json({ code: 'INTEGRATION_NOT_FOUND', stage: 'integration_lookup', request_id: requestId }, 503);
    }
    if (integration.status !== 'connected') {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'whatsapp_send_failed', status: 'error', metadata: { ...integrationMeta, code: 'INTEGRATION_NOT_CONNECTED' } });
      return json({ code: 'INTEGRATION_NOT_CONNECTED', stage: 'integration_lookup', request_id: requestId }, 503);
    }
    if (!String(integration.external_phone_id || '').trim()) {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'whatsapp_send_failed', status: 'error', metadata: { ...integrationMeta, code: 'PHONE_ID_MISSING' } });
      return json({ code: 'PHONE_ID_MISSING', stage: 'integration_lookup', request_id: requestId }, 503);
    }

    const to = normalizePhone(conversation.lead_phone || '');
    if (to.length < 8) return json({ code: 'INVALID_PAYLOAD' }, 400);

    if (clientRequestId) {
      const { data: previous, error: previousError } = await sb.from('messages').select('*').eq('company_id', companyId).eq('client_request_id', clientRequestId).maybeSingle();
      if (previousError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'message_lookup', internal_code: safeCode(previousError) }, 500);
      if (previous) return json({ message: previous, request_id: requestId }, 200);
    }

    const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v20.0';
    const response = await fetch(`https://graph.facebook.com/${version}/${integration.external_phone_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: message.trim() } }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'message_send_failed', status: 'error', metadata: { stage: 'meta_send', request_id: requestId, http_status: response.status, code: result?.error?.code || null } });
      return json({ code: 'PROVIDER_ERROR', provider_status: 'rejected', http_status: response.status }, response.status >= 400 && response.status <= 599 ? response.status : 502);
    }

    const externalId = result?.messages?.[0]?.id;
    if (!externalId) return json({ code: 'PROVIDER_ERROR', provider_status: 'unavailable' }, 502);
    const now = new Date().toISOString();
    const inserted = await sb.from('messages').insert({ company_id: companyId, conversation_id: conversationId, sender_type: 'user', sender_user_id: user.id, content: message.trim(), message_type: 'text', channel: 'whatsapp', external_message_id: externalId, external_status: 'sent', external_status_at: now, client_request_id: clientRequestId || null }).select().single();
    if (inserted.error) return stageFailure(sb, companyId, 'message_insert', safeCode(inserted.error) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    const conversationUpdate = await sb.from('conversations').update({ last_message_at: now, status: 'in_progress' }).eq('id', conversationId).eq('company_id', companyId);
    if (conversationUpdate.error) return stageFailure(sb, companyId, 'conversation_update', safeCode(conversationUpdate.error) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    const usage = await sb.rpc('increment_usage', { target_company: companyId, target_metric: 'whatsapp_messages_sent', target_period: now.slice(0, 10), amount: 1 });
    if (usage.error) return stageFailure(sb, companyId, 'usage_increment', safeCode(usage.error) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    const successLog = await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'message_sent', status: 'success', external_id: externalId, metadata: { stage: 'success_log', request_id: requestId, http_status: response.status } });
    if (successLog.error) return stageFailure(sb, companyId, 'success_log', safeCode(successLog.error) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    return json({ message: inserted.data, request_id: requestId }, 200);
  } catch {
    return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable' }, 500);
  }
});
