import { admin, corsHeaders, json } from '../_shared/core.ts';
import { buildAutomationPlan } from '../_shared/automationEngine.ts';

const safe = (value: unknown, max = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const authorized = (req: Request) => { const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''; return Boolean(key && req.headers.get('Authorization') === `Bearer ${key}`); };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!authorized(req)) return json({ code: 'FORBIDDEN' }, 403);
  const body = await req.json().catch(() => ({}));
  const companyId = safe(body?.company_id, 80); const triggerType = safe(body?.trigger_type, 80); const eventId = safe(body?.event_id, 160);
  if (!companyId || !triggerType || !eventId) return json({ code: 'INVALID_AUTOMATION_EVENT' }, 400);
  const eventData = body?.event_data && typeof body.event_data === 'object' && !Array.isArray(body.event_data) ? body.event_data : {};
  const sb = admin();
  const rules = await sb.from('automations').select('id,company_id,name,active,trigger_type,conditions,actions').eq('company_id', companyId).eq('trigger_type', triggerType).eq('active', true).limit(100);
  if (rules.error) return json({ code: 'AUTOMATION_LOOKUP_FAILED', internal_code: safe(rules.error.code, 80) }, 500);
  const results = [];
  for (const rule of rules.data || []) {
    const idempotencyKey = `${triggerType}:${eventId}`;
    const plan = buildAutomationPlan(rule, { company_id: companyId, trigger_type: triggerType, event_id: eventId, event_data: eventData });
    const reserved = await sb.from('automation_runs').insert({ company_id: companyId, automation_id: rule.id, status: 'processing', trigger_data: { trigger: triggerType, event_id: eventId }, idempotency_key: idempotencyKey, started_at: new Date().toISOString(), trace_id: safe(body?.trace_id, 120) || null }).select('id').single();
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
    await sb.from('automation_runs').update({ status, result: { planned: plan.actions.length, executed, blocked }, action_count: executed, finished_at: new Date().toISOString() }).eq('id', reserved.data.id).eq('company_id', companyId);
    results.push({ automation_id: rule.id, status, executed, blocked });
  }
  return json({ status: 'completed', rules: results.length, results }, 200);
});
