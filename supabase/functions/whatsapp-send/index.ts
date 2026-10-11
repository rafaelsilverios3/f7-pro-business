import { corsHeaders, json, auth, admin } from '../_shared/core.ts';
import { sendWhatsAppText } from '../_shared/whatsappOutbound.ts';

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

    const { data: allowed, error: featureError } = await sb.rpc('company_has_feature_internal', { target_company: companyId, feature: 'whatsapp' });
    if (featureError) return stageFailure(sb, companyId, 'feature_lookup', safeCode(featureError) || 'INTERNAL_PROVIDER_ERROR', 500, requestId);
    if (!allowed) return json({ code: 'FEATURE_NOT_AVAILABLE' }, 403);

    const limited = await sb.rpc('consume_rate_limit', { target_company: companyId, target_user: user.id, target_metric: 'whatsapp-send', max_count: MAX_USER, window_seconds: 60 });
    if (limited.error || limited.data === false) return stageFailure(sb, companyId, 'rate_limit', limited.error ? (safeCode(limited.error) || 'INTERNAL_PROVIDER_ERROR') : 'RATE_LIMITED', limited.error ? 500 : 429, requestId);

    const outbound = await sendWhatsAppText({ sb, conversation, message, client_request_id: clientRequestId || null, sender_type: 'user', sender_user_id: user.id, request_id: requestId });
    if (!outbound.ok) return json({ code: outbound.code, stage: outbound.stage, internal_code: outbound.internal_code || undefined, http_status: outbound.provider_status || outbound.status, request_id: requestId }, outbound.status);
    return json({ message: outbound.message, request_id: requestId, deduplicated: outbound.deduplicated }, 200);
  } catch {
    return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable' }, 500);
  }
});
