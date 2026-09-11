import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
const roles = new Set(['admin', 'gestor']);
const stateFrom = (row: any, maxAgeMinutes: number) => {
  if (!row) return { state: 'UNKNOWN', reason_code: 'no_evidence' };
  const age = Date.now() - new Date(row.created_at).getTime();
  if (!Number.isFinite(age) || age > maxAgeMinutes * 60_000) return { state: 'UNKNOWN', reason_code: 'stale_evidence' };
  return row.status === 'success' ? { state: 'HEALTHY', reason_code: 'recent_success' } : { state: 'DEGRADED', reason_code: 'recent_failure' };
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const token = auth(req);
  const sb = admin();
  const { data: { user }, error: userError } = await sb.auth.getUser(token);
  if (userError || !user) return json({ code: 'AUTH_REQUIRED' }, 401);
  const body = await req.json().catch(() => ({})); const companyId = typeof body?.company_id === 'string' ? body.company_id : '';
  const membership = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
  if (membership.error || membership.data?.active === false || !roles.has(String(membership.data?.role || '').toLowerCase())) return json({ code: 'FORBIDDEN' }, 403);
  const events = await sb.from('integration_logs').select('provider,event,status,created_at').eq('company_id', companyId).in('provider', ['assistant','product_intelligence','whatsapp']).order('created_at', { ascending: false }).limit(200);
  if (events.error) return json({ code: 'HEALTH_LOOKUP_FAILED', internal_code: String(events.error.code || '').slice(0, 80) }, 500);
  const rows = events.data || [];
  const latest = (provider: string, match?: RegExp) => rows.find((row: any) => row.provider === provider && (!match || match.test(row.event)));
  const services = {
    openai: stateFrom(latest('assistant', /assistant_suggest|ASSISTANT_SUCCESS|ASSISTANT_FAILED/i), 1440),
    brave: stateFrom(latest('product_intelligence', /WEB_RESEARCH|WEB_SEARCH/i), 1440),
    whatsapp: stateFrom(latest('whatsapp', /inbound|send|connection/i), 1440),
    webhook: stateFrom(latest('whatsapp', /webhook|inbound/i), 1440),
    supabase: { state: 'HEALTHY', reason_code: 'health_query_succeeded' },
    realtime: { state: 'UNKNOWN', reason_code: 'client_evidence_required' },
    edge_functions: { state: 'HEALTHY', reason_code: 'health_function_running' },
  };
  await sb.from('integration_health_snapshots').upsert(Object.entries(services).map(([service, value]) => ({ company_id: companyId, service, state: value.state, reason_code: value.reason_code, evidence_at: new Date().toISOString(), checked_at: new Date().toISOString() })), { onConflict: 'company_id,service' });
  return json({ services, checked_at: new Date().toISOString() }, 200);
});
