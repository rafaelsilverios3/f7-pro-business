import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
const roles = new Set(['admin', 'gestor']);
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const token = auth(req);
  const sb = admin();
  const { data: { user }, error: userError } = await sb.auth.getUser(token);
  if (userError || !user) return json({ code: 'AUTH_REQUIRED' }, 401);
  const body = await req.json().catch(() => ({}));
  const companyId = typeof body?.company_id === 'string' ? body.company_id : '';
  const membership = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
  if (membership.error || membership.data?.active === false || !roles.has(String(membership.data?.role || '').toLowerCase())) return json({ code: 'FORBIDDEN' }, 403);
  const runs = await sb.from('ai_runs').select('trace_id,mode,status,current_stage,provider,model,tool_names,query_count,source_domains,candidate_count,confidence,input_tokens,output_tokens,estimated_cost,duration_ms,safe_error_code,started_at,finished_at').eq('company_id', companyId).order('started_at', { ascending: false }).limit(50);
  if (runs.error) return json({ code: 'INSPECTOR_LOOKUP_FAILED', internal_code: String(runs.error.code || '').slice(0, 80) }, 500);
  return json({ runs: runs.data || [] }, 200);
});
