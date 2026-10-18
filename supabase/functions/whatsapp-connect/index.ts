import { corsHeaders, json, auth, admin, userClient } from '../_shared/core.ts';
import { graphRequest, phoneValidation, publicProviderError } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let stage = 'start';
  try {
    const jwt = auth(req); const sb = admin(); const viewer = userClient(jwt);
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json();
    const companyId = typeof body?.company_id === 'string' ? body.company_id : '';
    const phoneId = typeof body?.phone_number_id === 'string' ? body.phone_number_id.trim() : '';
    if (!companyId || !/^\d{6,30}$/.test(phoneId)) return json({ code: 'INVALID_PAYLOAD' }, 400);
    const membership = await viewer.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
    const role = String(membership.data?.role || '').toLowerCase();
    if (membership.error || membership.data?.active !== true || !['admin', 'gestor'].includes(role)) {
      await sb.from('integration_logs').insert({ company_id: companyId || null, provider: 'whatsapp', event: 'connection_authorization_failed', status: 'error', metadata: { reason: membership.error ? 'membership_query' : 'role_or_inactive', role, active: membership.data?.active ?? null, query_error: membership.error?.code || null } });
      return json({ code: 'FORBIDDEN' }, 403);
    }
    const { data: allowed } = await viewer.rpc('company_has_feature', { target_company: companyId, feature: 'whatsapp' });
    if (!allowed) return json({ code: 'FEATURE_NOT_AVAILABLE' }, 403);
    if ((Deno.env.get('WHATSAPP_PROVIDER_ENABLED') || '').trim().toLowerCase() !== 'true') {
      return json({ code: 'WHATSAPP_PROVIDER_DISABLED' }, 503);
    }
    stage = 'meta_validation';
    const meta = await graphRequest(`${phoneId}?fields=id,display_phone_number,verified_name,quality_rating`);
    if (!phoneValidation(meta.data, phoneId)) {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'whatsapp.meta_validation_failed', status: 'error', metadata: { meta_code: meta.meta_error?.code || null, meta_subcode: meta.meta_error?.subcode || null, meta_type: meta.meta_error?.type || null, graph_version: meta.graph_version, http_status: meta.status } });
      const providerError = publicProviderError(meta);
      const providerStatus = meta.status && meta.status >= 400 && meta.status <= 599 ? meta.status : 502;
      return json({ ...providerError, http_status: providerStatus }, providerStatus);
    }
    stage = 'integration_upsert';
    const { data: integration, error: integrationError } = await sb.from('company_integrations').upsert({ company_id: companyId, provider: 'whatsapp', status: 'connected', external_phone_id: phoneId, external_business_id: null, external_account_id: null }, { onConflict: 'company_id,provider' }).select('id,company_id,provider,status,external_phone_id,external_business_id,external_account_id,created_at,updated_at').single();
    if (integrationError) return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable', stage, internal_code: typeof integrationError.code === 'string' ? integrationError.code.slice(0, 80) : null }, 500);
    stage = 'success_log';
    const logResult = await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'connection_validated', status: 'success', metadata: { phone_configured: true, provider_status: 'ok' } });
    if (logResult.error) return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable', stage, internal_code: typeof logResult.error.code === 'string' ? logResult.error.code.slice(0, 80) : null }, 500);
    stage = 'complete';
    return json({ integration, provider: { status: 'ok', phone: 'configured', api_reachable: true } });
  } catch (error) {
    const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const internalCode = typeof candidate.code === 'string' && candidate.code.length <= 80 ? candidate.code : null;
    return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable', stage, internal_code: internalCode }, 500);
  }
});
