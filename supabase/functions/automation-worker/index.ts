import { admin, auth, corsHeaders, json, userClient } from '../_shared/core.ts';
import { buildAutomationPlan } from '../_shared/automationEngine.ts';
import { runRadarDetector } from '../_shared/radarDetector.ts';
import { CRM_AUTOMATION_TRIGGERS, activityMatchesTrigger, isActiveOpportunity, minimalActivitySignal, minimalOpportunitySignal, minimalQuoteSignal, safeTimezone, signalWindowKey } from '../_shared/crmAutomation.ts';

const safe = (value: unknown, max = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const CRM_TRIGGER_SET = new Set(CRM_AUTOMATION_TRIGGERS);
const CRM_LABELS: Record<string, { stage: string; title: string; message: string }> = {
  crm_activity_due_soon: { stage: 'CRM_ACTIVITY_DUE_SOON_DETECTED', title: 'Follow-up se aproximando', message: 'Você possui um follow-up comercial se aproximando.' },
  crm_activity_due_today: { stage: 'CRM_ACTIVITY_DUE_TODAY_DETECTED', title: 'Follow-up previsto para hoje', message: 'Você possui um follow-up comercial previsto para hoje.' },
  crm_activity_overdue: { stage: 'CRM_ACTIVITY_OVERDUE_DETECTED', title: 'Follow-up vencido', message: 'Você possui um follow-up comercial vencido.' },
  crm_opportunity_without_next_action: { stage: 'CRM_OPPORTUNITY_WITHOUT_NEXT_ACTION_DETECTED', title: 'Oportunidade sem próxima ação', message: 'Existe uma oportunidade ativa sem próxima ação registrada.' },
  quote_created: { stage: 'QUOTE_CREATED_DETECTED', title: 'Novo orçamento criado', message: 'Um novo orçamento precisa de acompanhamento comercial.' },
  quote_approved: { stage: 'QUOTE_APPROVED_DETECTED', title: 'Orçamento aprovado', message: 'Um orçamento aprovado está pronto para conversão humana.' },
  quote_no_response: { stage: 'QUOTE_NO_RESPONSE_DETECTED', title: 'Orçamento sem retorno', message: 'Há um orçamento aguardando retorno do cliente.' },
};

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

async function emitCrmEvent(sb: any, companyId: string, traceId: string, stage: string, counts: Record<string, unknown> = {}) {
  try { await sb.from('ai_run_events').insert({ company_id: companyId, trace_id: traceId, stage, status: 'success', counts }); } catch { /* observabilidade não pode impedir o lembrete */ }
}

async function collectCrmSignals(sb: any, companyId: string, triggerType: string, timezone: string, now: Date) {
  if (['crm_activity_due_soon', 'crm_activity_due_today', 'crm_activity_overdue'].includes(triggerType)) {
    let query = sb.from('crm_activities').select('id,company_id,customer_id,opportunity_id,assigned_to,activity_type,status,due_at').eq('company_id', companyId).eq('status', 'PENDENTE').not('due_at', 'is', null);
    if (triggerType === 'crm_activity_overdue') query = query.lt('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(200);
    else query = query.gte('due_at', now.toISOString()).lte('due_at', new Date(now.getTime() + 86_400_000).toISOString()).order('due_at', { ascending: true }).limit(200);
    const result = await query;
    if (result.error) throw result.error;
    return (result.data || []).filter((activity: any) => activityMatchesTrigger(activity, triggerType, now, timezone)).map(minimalActivitySignal);
  }
  if (triggerType === 'crm_opportunity_without_next_action') {
    const opportunities = await sb.from('opportunities').select('id,company_id,customer_id,assigned_user_id,stage').eq('company_id', companyId).limit(200);
    if (opportunities.error) throw opportunities.error;
    const active = (opportunities.data || []).filter(isActiveOpportunity);
    const ids = active.map((item: any) => item.id).filter(Boolean);
    if (!ids.length) return [];
    const pending = await sb.from('crm_activities').select('opportunity_id').eq('company_id', companyId).eq('status', 'PENDENTE').in('opportunity_id', ids);
    if (pending.error) throw pending.error;
    const pendingIds = new Set((pending.data || []).map((item: any) => item.opportunity_id).filter(Boolean));
    const assignedIds = active.map((item: any) => item.assigned_user_id).filter(Boolean);
    const members = assignedIds.length ? await sb.from('company_users').select('user_id').eq('company_id', companyId).eq('active', true).in('user_id', assignedIds) : { data: [], error: null };
    if (members.error) throw members.error;
    const activeMemberIds = new Set((members.data || []).map((item: any) => item.user_id));
    return active.filter((item: any) => !pendingIds.has(item.id)).map((item: any) => minimalOpportunitySignal({ ...item, assigned_user_id: activeMemberIds.has(item.assigned_user_id) ? item.assigned_user_id : null }));
  }
  if (['quote_created', 'quote_approved', 'quote_no_response'].includes(triggerType)) {
    const cutoff = new Date(now.getTime() - (triggerType === 'quote_no_response' ? 2 * 86_400_000 : 15 * 60_000)).toISOString();
    let query = sb.from('quotes').select('id,company_id,customer_id,seller_user_id,status,total,created_at,updated_at,approved_at,valid_until,sale_id').eq('company_id', companyId).limit(200);
    if (triggerType === 'quote_created') query = query.gte('created_at', cutoff).not('status', 'in', '(cancelled,refused,expired,converted)');
    if (triggerType === 'quote_approved') query = query.eq('status', 'approved').gte('approved_at', cutoff);
    if (triggerType === 'quote_no_response') query = query.in('status', ['sent', 'viewed', 'negotiating']).is('sale_id', null).or(`valid_until.is.null,valid_until.gte.${now.toISOString().slice(0, 10)}`).lte('created_at', cutoff);
    const result = await query;
    if (result.error) throw result.error;
    return (result.data || []).map(minimalQuoteSignal);
  }
  return [];
}

function notificationFor(triggerType: string, signal: any, params: Record<string, unknown> = {}) {
  const defaults = CRM_LABELS[triggerType] || { title: 'Lembrete de automação', message: 'Há um item comercial que precisa de atenção.' };
  const opportunity = triggerType === 'crm_opportunity_without_next_action';
  return {
    user_id: signal.assigned_to || null,
    type: 'automation',
    title: safe(params.title || defaults.title, 160),
    message: safe(params.message || defaults.message, 500),
    read: false,
    entity: opportunity ? 'opportunity' : triggerType.startsWith('quote_') ? 'quote' : 'crm_activity',
    entity_id: signal.activity_id || signal.opportunity_id || signal.quote_id || null,
  };
}

async function processCrmRule(sb: any, rule: any, input: { companyId: string; triggerType: string; eventId: string; eventData: Record<string, unknown>; traceId: string }) {
  const now = new Date();
  const timezone = safeTimezone(rule.timezone || 'UTC');
  const signals = await collectCrmSignals(sb, input.companyId, input.triggerType, timezone, now);
  const label = CRM_LABELS[input.triggerType];
  const totals = { eligible: signals.length, created: 0, duplicates: 0, blocked: 0 };
  for (const signal of signals) {
    const windowKey = signalWindowKey(signal, input.triggerType, timezone);
    const idempotencyKey = `${input.triggerType}:${windowKey}`;
    const plan = buildAutomationPlan(rule, { company_id: input.companyId, trigger_type: input.triggerType, event_id: input.eventId, event_data: { ...input.eventData, ...signal, window_key: windowKey } });
    const startedAt = new Date();
    const reserved = await sb.from('automation_runs').insert({ company_id: input.companyId, automation_id: rule.id, status: 'processing', trigger: 'CRM', trigger_data: { trigger: input.triggerType, event_id: input.eventId, crm_signal: signal, window_key: windowKey }, idempotency_key: idempotencyKey, started_at: startedAt.toISOString(), trace_id: input.traceId }).select('id').single();
    if (reserved.error?.code === '23505') { totals.duplicates += 1; await emitCrmEvent(sb, input.companyId, input.traceId, 'CRM_AUTOMATION_DUPLICATE_SKIPPED', { automation_id: rule.id, trigger_type: input.triggerType, entity_id: signal.activity_id || signal.opportunity_id || signal.quote_id }); continue; }
    if (reserved.error) { totals.blocked += 1; continue; }
    let executed = 0; let blocked = 0;
    for (const action of plan.actions) {
      if (action.execution !== 'allowed') { blocked += 1; continue; }
      const notification = await sb.from('notifications').insert({ company_id: input.companyId, ...notificationFor(input.triggerType, signal, action.params as Record<string, unknown>) });
      if (!notification.error) { executed += 1; await emitCrmEvent(sb, input.companyId, input.traceId, 'CRM_AUTOMATION_NOTIFICATION_CREATED', { automation_id: rule.id, trigger_type: input.triggerType, entity_id: signal.activity_id || signal.opportunity_id || signal.quote_id, assigned_to: signal.assigned_to || null }); }
    }
    const status = plan.status === 'skipped' ? 'skipped' : executed > 0 ? 'completed' : blocked > 0 ? 'blocked' : 'completed';
    const finishedAt = new Date();
    await sb.from('automation_runs').update({ status, result: { planned: plan.actions.length, executed, blocked, trigger: input.triggerType, entity_id: signal.activity_id || signal.opportunity_id || signal.quote_id }, action_count: executed, finished_at: finishedAt.toISOString(), duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()) }).eq('id', reserved.data.id).eq('company_id', input.companyId);
    if (label) await emitCrmEvent(sb, input.companyId, input.traceId, label.stage, { automation_id: rule.id, entity_id: signal.activity_id || signal.opportunity_id || signal.quote_id, assigned_to: signal.assigned_to || null });
    totals.created += executed;
    totals.blocked += blocked;
  }
  return totals;
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
  const { data: automationAllowed, error: automationGateError } = await sb.rpc('company_has_feature_internal', { target_company: companyId, feature: 'automations' });
  if (automationGateError) return json({ code: 'FEATURE_LOOKUP_FAILED' }, 500);
  if (!automationAllowed) return json({ code: 'FEATURE_NOT_AVAILABLE', message: 'Automações estão disponíveis a partir do plano BUSINESS.' }, 403);
  let rulesQuery = sb.from('automations').select('id,company_id,name,active,trigger_type,conditions,actions,timezone').eq('company_id', companyId).eq('trigger_type', triggerType).eq('active', true).is('deleted_at', null).limit(100);
  if (automationId) rulesQuery = rulesQuery.eq('id', automationId);
  const rules = await rulesQuery;
  if (rules.error) return json({ code: 'AUTOMATION_LOOKUP_FAILED', internal_code: safe(rules.error.code, 80) }, 500);
  const traceId = safe(body?.trace_id, 120) || crypto.randomUUID();
  const results = [];
  for (const rule of rules.data || []) {
    if (CRM_TRIGGER_SET.has(triggerType)) {
      try { const crm = await processCrmRule(sb, rule, { companyId, triggerType, eventId, eventData, traceId }); results.push({ automation_id: rule.id, status: 'completed', ...crm }); } catch (error) { results.push({ automation_id: rule.id, status: 'error', code: safe(error?.code || error?.message, 80) }); }
      continue;
    }
    let detectorResult = { signals_count: 0, opportunities_created: 0, opportunities_updated: 0 };
    if (['stock_below_min', 'client_inactive'].includes(triggerType)) {
      try { detectorResult = await runRadarDetector(sb, companyId, triggerType); } catch (error) { return json({ code: 'RADAR_DETECTOR_FAILED', internal_code: safe(error?.code || error?.message, 80) }, 500); }
    }
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
