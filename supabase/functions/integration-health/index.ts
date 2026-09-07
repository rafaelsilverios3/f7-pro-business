import { corsHeaders, json, auth, admin } from '../_shared/core.ts';
import { graphRequest, phoneValidation, publicProviderError } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req); const sb = admin();
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({}));
    const { data: members } = await sb.from('company_users').select('company_id,role,active').eq('user_id', user.id).eq('active', true);
    const ids = (members || []).filter((m) => ['admin', 'gestor'].includes(m.role)).map((m) => m.company_id).filter((id) => !body.company_id || id === body.company_id);
    const { data: integrations } = ids.length ? await sb.from('company_integrations').select('company_id,provider,status,external_phone_id').in('company_id', ids) : { data: [] };
    const result = [];
    for (const companyId of ids) {
      const integration = integrations?.find((item) => item.company_id === companyId && item.provider === 'whatsapp');
      let provider = 'unknown'; let phone = integration?.external_phone_id ? 'configured' : 'not_configured'; let providerDiagnostic = null; let graph_version = null;
      if (integration?.external_phone_id) {
        const meta = await graphRequest(`${integration.external_phone_id}?fields=id`);
        provider = meta.ok && phoneValidation(meta.data, integration.external_phone_id) ? 'ok' : 'error';
        providerDiagnostic = meta.ok ? null : publicProviderError(meta);
        graph_version = meta.graph_version;
      }
      const status = integration?.status || 'not_configured';
      result.push({ company_id: companyId, whatsapp: { status, database: 'ok', provider, provider_diagnostic: providerDiagnostic, graph_version, phone, webhook: 'not_tested', send: 'not_tested', receive: 'not_tested' }, ai: { status: 'not_configured', database: 'ok', provider: 'unknown' } });
    }
    return json({ integrations: result });
  } catch { return json({ code: 'INTERNAL_PROVIDER_ERROR', provider_status: 'unavailable' }, 500); }
});

