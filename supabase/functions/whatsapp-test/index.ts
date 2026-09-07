import { corsHeaders, json, auth, admin, userClient } from '../_shared/core.ts';
import { graphRequest, phoneValidation, publicProviderError } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req); const sb = admin(); const viewer = userClient(jwt);
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const { company_id: companyId } = await req.json();
    const { data: member } = await viewer.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
    if (!member?.active || !['admin', 'gestor'].includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { data: allowed } = await viewer.rpc('company_has_feature', { target_company: companyId, feature: 'whatsapp' });
    if (!allowed) return json({ code: 'FEATURE_NOT_AVAILABLE' }, 403);
    const { data: integration } = await sb.from('company_integrations').select('external_phone_id,status').eq('company_id', companyId).eq('provider', 'whatsapp').maybeSingle();
    if (!integration?.external_phone_id) return json({ api_reachable: false, number_configured: false, webhook_configured: 'unknown', send_ready: false, receive_ready: 'unknown', status: 'not_configured' });
    const meta = await graphRequest(`${integration.external_phone_id}?fields=id,display_phone_number,verified_name,quality_rating,whatsapp_business_account`);
    const valid = meta.ok && phoneValidation(meta.data, integration.external_phone_id);
    const result = { api_reachable: meta.ok, number_configured: valid, webhook_configured: 'unknown', send_ready: valid && integration.status === 'connected', receive_ready: valid && integration.status === 'connected' ? 'unknown' : false, status: valid ? 'ok' : 'error' };
    await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'connection_tested', status: valid ? 'success' : 'error', metadata: { api_reachable: meta.ok, number_configured: valid, provider_status: result.status } });
    return json(valid ? result : { ...result, ...publicProviderError(meta) }, valid ? 200 : 502);
  } catch { return json({ code: 'PROVIDER_ERROR' }, 500); }
});
