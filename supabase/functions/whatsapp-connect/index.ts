import { corsHeaders, json, auth, admin, userClient } from '../_shared/core.ts';
import { graphRequest, phoneValidation, publicProviderError } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
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
    const meta = await graphRequest(`${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,whatsapp_business_account`);
    if (!phoneValidation(meta.data, phoneId)) {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'connection_validation_failed', status: 'error', metadata: { http_status: meta.status, code: meta.code } });
      return json(publicProviderError(meta), 502);
    }
    const businessId = meta.data?.whatsapp_business_account?.id || null;
    if (body.business_id && businessId && String(body.business_id) !== String(businessId)) {
      await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'connection_validation_failed', status: 'error', metadata: { reason: 'business_mismatch' } });
      return json({ code: 'PROVIDER_ACCOUNT_MISMATCH' }, 409);
    }
    const { data: integration, error } = await sb.from('company_integrations').upsert({ company_id: companyId, provider: 'whatsapp', status: 'connected', external_phone_id: phoneId, external_business_id: businessId, external_account_id: businessId }, { onConflict: 'company_id,provider' }).select('id,company_id,provider,status,external_phone_id,external_business_id,external_account_id,created_at,updated_at').single();
    if (error) throw error;
    await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'connection_validated', status: 'success', metadata: { phone_configured: true, provider_status: 'ok' } });
    return json({ integration, provider: { status: 'ok', phone: 'configured', api_reachable: true } });
  } catch { return json({ code: 'PROVIDER_ERROR' }, 500); }
});
