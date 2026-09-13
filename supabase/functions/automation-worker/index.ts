import { admin, auth, corsHeaders, json, userClient } from '../_shared/core.ts';
import { buildAutomationPlan } from '../_shared/automationEngine.ts';
import { runRadarDetector } from '../_shared/radarDetector.ts';

const safe = (value: unknown, max = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
async function authorized(req: Request, companyId: string, sb: any) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (key && req.headers.get('Authorization') === `Bearer ${key}`) return true;
  try {
    const jwt = auth(req); const client = userClient(jwt); const { data: { user } = {} } = await client.auth.getUser();
    if (!user?.id || !companyId) return false;
    const membership = await sb.from('company_users').select('role').eq('company_id', companyId).eq('user_id', user.id).eq('active', true).maybeSingle();
    return Boolean(membership.data && ['admin', 'gestor'].includes(membership.data.role));
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await req.json().catch(() => ({}));
  const companyId = safe(body?.company_id, 80); const triggerType = safe(body?.trigger_type, 80); const eventId = safe(body?.event_id, 160); const automationId = safe(body?.automation_id, 80);
  if (!companyId || !triggerType || !eventId) return json({ code: 'INVALID_AUTOMATION_EVENT' }, 400);
  const eventData = body?.event_data && typeof body.event_data === 'object' && !Array.isArray(body.event_data) ? body.event_data : {};
  const sb = admin();
  if (!(await authorized(req, companyId, sb))) return json({ code: 'FORBIDDEN' }, 403);
  const { data: automationAllowed, error: automationGateError } = await sb.rpc('company_has_feature', { target_company: companyId, feature: 'automations' });
  if (automationGateError) return json({ code: 'FEATURE_LOOKUP_FAILED' }, 500);
  if (!automationAllowed) return json({ code: 'FEATURE_NOT_AVAILABLE', message: 'Automações estão disponíveis a partir do plano BUSINESS.' }, 403);
  let rulesQuery = sb.from('automations').select('id,company_id,name,active,trigger_type,conditions,actions').eq('company_id', companyId).eq('trigger_type', triggerType).eq('active', true).is('deleted_at', null).limit(100);
  if (automationId) rulesQuery = rulesQuery.eq('id', automationId);
  const rules = await rulesQuery;
  if (rules.error) return json({ code: 'AUTOMATION_LOOKUP_FAILED', internal_code: safe(rules.error.code, 80) }, 500);
  let detectorResult = { signals_count: 0, opportunities_created: 0, opportunities_updated: 0 };
  if (['stock_below_min', 'client_inactive'].includes(triggerType)) {
    try { detectorResult = await runRadarDetector(sb, companyId, triggerType); } catch (error) { return json({ code: 'RADAR_DETECTOR_FAILED', internal_code: safe(error?.code || error?.message, 80) }, 500); }
  }
  const results = [];
  for (const rule of rules.data || []) {
    const idempotencyKey = `${triggerType}:${eventId}`;
    const plan = buildAutomationPlan(rule, { company_id: companyId, trigger_type: triggerType, event_id: eventId, event_data: eventData });
    const reserved = await sb.from('automation_runs').insert({ company_id: companyId, automation_id: rule.id, status: 'processing', trigger: safe(body?.trigger || 'EVENT', 40), scheduled_for: body?.scheduled_for || null, trigger_data: { trigger: triggerType, event_id: eventId, scheduler_tick: safe(body?.event_data?.scheduler_tick, 80) || null }, idempotency_key: idempotencyKey, started_at: new Date().toISOString(), trace_id: safe(body?.trace_id, 120) || null, signals_count: detectorResult.signals_count, opportunities_created: detectorResult.opportunities_created, opportunities_updated: detectorResult.opportunities_updated }).select('id').single();
    if (reserved.error?.code === '23505') { results.push({ automation_id: rule.id, status: 'deduplicated' }); continue; }
    if (reserved.error) { results.push({ automation_id: rule.id, status: 'error', code: safe(reserved.error.code, 80) }); continue; }
    let executed = 0; let blocked = 0;
    for (const action of plan.actions) {
      if (action.execution !== 'allowed') { blocked += 1; continue; }
      const params = action.params as Record<string, unknown>;
      const notification = await sb.from('notifications').insert({ company_id: companyId, type: 'automation', title: safe(params.title || rule.name, 160), message: safe(params.message || 'Automação executada.', 500), read: false });
      if (!notification.error) executed += 1;
    }
    const status = plan.status === 'skipped' ? 'skipped' : executed > 0 ? 'completed' : blocked > 0 ? 'blocked' : 'completed';
    const finishedAt = new Date();
    await sb.from('automation_runs').update({ status, result: { planned: plan.actions.length, executed, blocked, trigger: safe(body?.trigger || 'EVENT', 40) }, action_count: executed, finished_at: finishedAt.toISOString(), duration_ms: Math.max(0, finishedAt.getTime() - new Date(body?.started_at || finishedAt).getTime()) }).eq('id', reserved.data.id).eq('company_id', companyId);
    results.push({ automation_id: rule.id, status, executed, blocked, ...detectorResult });
  }
  return json({ status: 'completed', rules: results.length, results }, 200);
});
