import { corsHeaders, json, auth, admin, userClient } from '../_shared/core.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req); const sb = admin(); const viewer = userClient(jwt);
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const { company_id: companyId } = await req.json();
    const { data: member } = await viewer.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
    if (!member?.active || !['admin', 'gestor'].includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { error } = await sb.from('company_integrations').update({ status: 'disconnected' }).eq('company_id', companyId).eq('provider', 'whatsapp');
    if (error) throw error;
    await sb.from('integration_logs').insert({ company_id: companyId, provider: 'whatsapp', event: 'disconnected', status: 'success', metadata: {} });
    return json({ status: 'disconnected' });
  } catch { return json({ code: 'PROVIDER_ERROR' }, 500); }
});
