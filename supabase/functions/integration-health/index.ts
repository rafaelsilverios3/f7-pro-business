import { corsHeaders, json, auth, admin } from '../_shared/core.ts';
import { graphRequest, phoneValidation } from '../_shared/whatsapp.ts';

function safeProviderDiagnostic(result: { status?: number; meta_error?: Record<string, unknown> | null; graph_version?: string }) {
  const meta = result.meta_error || {};
  return {
    http_status: Number.isInteger(result.status) ? result.status : null,
    meta_code: typeof meta.code === 'number' || typeof meta.code === 'string' ? meta.code : null,
    meta_type: typeof meta.type === 'string' ? meta.type : null,
    graph_version: result.graph_version || null,
  };
}

export async function handleIntegrationHealthRequest(req: Request, dependencies: { adminClient?: any } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req); const sb = dependencies.adminClient || admin();
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({}));
    const { data: members } = await sb.from('company_users').select('company_id,role,active').eq('user_id', user.id).eq('active', true);
    const ids = ((members || []) as Array<{ company_id: string; role: string }>).filter((m) => ['admin', 'gestor'].includes(m.role)).map((m) => m.company_id).filter((id: string) => !body.company_id || id === body.company_id);
    const { data: integrations } = ids.length ? await sb.from('company_integrations').select('company_id,provider,status,external_phone_id').in('company_id', ids) : { data: [] };
    const { data: inboundLogs } = ids.length ? await sb.from('integration_logs').select('company_id,event,status,created_at').in('company_id', ids).eq('provider', 'whatsapp').eq('event', 'whatsapp_inbound').eq('status', 'success').order('created_at', { ascending: false }).limit(200) : { data: [] };
    const { data: outboundMessages } = ids.length ? await sb.from('messages').select('company_id,channel,external_status,external_message_id,created_at').in('company_id', ids).eq('channel', 'whatsapp').not('external_message_id', 'is', null).in('external_status', ['sent', 'delivered', 'read']).order('created_at', { ascending: false }).limit(200) : { data: [] };
    const result = [];
    const providerEnabled = (Deno.env.get('WHATSAPP_PROVIDER_ENABLED') || '').trim().toLowerCase() === 'true';
    const sendEnabled = providerEnabled && (Deno.env.get('WHATSAPP_SEND_ENABLED') || '').trim().toLowerCase() === 'true';
    const receiveEnabled = providerEnabled && (Deno.env.get('WHATSAPP_RECEIVE_ENABLED') || '').trim().toLowerCase() === 'true';
    for (const companyId of ids) {
      const integration = (integrations || []).find((item: any) => item.company_id === companyId && item.provider === 'whatsapp');
      const phoneId = typeof integration?.external_phone_id === 'string' ? integration.external_phone_id.trim() : '';
      let provider = providerEnabled ? 'unknown' : 'disabled'; let phone = phoneId ? 'configured' : 'not_configured'; let providerDiagnostic = null; let graph_version = null;
      if (phoneId && providerEnabled) {
        const meta = await graphRequest(`${phoneId}?fields=id`);
        provider = meta.ok && phoneValidation(meta.data, phoneId) ? 'ok' : 'error';
        providerDiagnostic = provider === 'ok' ? null : safeProviderDiagnostic(meta);
        graph_version = meta.graph_version;
      }
      const status = integration?.status || 'not_configured';
      const inboundConfirmed = (inboundLogs || []).some((log: any) => log.company_id === companyId);
      const outboundConfirmed = (outboundMessages || []).some((message: any) => message.company_id === companyId);
      result.push({ company_id: companyId, whatsapp: { status, database: 'ok', provider, provider_enabled: providerEnabled, provider_diagnostic: providerDiagnostic, graph_version, phone, webhook: receiveEnabled ? (inboundConfirmed ? 'ok' : 'not_tested') : 'disabled', send_enabled: sendEnabled, send: sendEnabled ? (outboundConfirmed ? 'ready' : 'not_tested') : 'disabled', receive_enabled: receiveEnabled, receive: receiveEnabled ? (inboundConfirmed ? 'ready' : 'not_tested') : 'disabled' }, ai: { status: 'not_configured', database: 'ok', provider: 'unknown' } });
    }
    return json({ integrations: result });
  } catch { return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable' }, 500); }
}

if (import.meta.main) Deno.serve((req) => handleIntegrationHealthRequest(req));

