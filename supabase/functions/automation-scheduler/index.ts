import { admin, corsHeaders, json } from '../_shared/core.ts';

const clean = (value: unknown, max = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const validSchedulerRequest = (req: Request) => {
  const configured = Deno.env.get('F7_SCHEDULER_SECRET') || '';
  const provided = req.headers.get('x-f7-scheduler-secret') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return Boolean((configured && provided && provided === configured) || (service && req.headers.get('Authorization') === `Bearer ${service}`));
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!validSchedulerRequest(req)) return json({ code: 'FORBIDDEN' }, 403);
  const sb = admin(); const tickId = crypto.randomUUID(); const started = Date.now();
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await sb.from('automation_runs').update({ status: 'failed', safe_error_code: 'SCHEDULER_STALLED', error_message: 'Execução interrompida pelo scheduler após 20 minutos.', finished_at: new Date().toISOString(), stalled_at: new Date().toISOString() }).eq('status', 'processing').lt('started_at', cutoff);
  const emit = async (companyId: string, stage: string, status = 'success', counts: Record<string, unknown> = {}) => { try { await sb.from('ai_run_events').insert({ company_id: companyId, trace_id: tickId, stage, status, counts }); } catch { /* observabilidade não pode impedir o despacho */ } };
  const claimed = await sb.rpc('claim_due_automations', { batch_size: 50 });
  if (claimed.error) return json({ code: 'SCHEDULER_CLAIM_FAILED' }, 500);
  const companies = [...new Set((claimed.data || []).map((row: any) => row.company_id))];
  await Promise.all(companies.map((companyId) => emit(companyId, 'SCHEDULER_TICK_STARTED')));
  const results: any[] = [];
  for (const automation of claimed.data || []) {
    const scheduledFor = automation.next_run_at;
    await emit(automation.company_id, 'AUTOMATION_DUE', 'success', { automation_id: automation.id, scheduled_for: scheduledFor });
    await emit(automation.company_id, 'AUTOMATION_CLAIMED', 'success', { automation_id: automation.id });
    try {
      const next = await sb.rpc('calculate_automation_next_run', { target_frequency: automation.schedule_frequency, target_weekday: automation.schedule_weekday, target_time: automation.schedule_time, target_timezone: automation.timezone || 'UTC', anchor: scheduledFor });
      const nextRunAt = next.data || null;
      await emit(automation.company_id, 'AUTOMATION_STARTED', 'success', { automation_id: automation.id });
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/automation-worker`, { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: automation.company_id, trigger_type: automation.trigger_type, event_id: `scheduled:${automation.id}:${scheduledFor}`, automation_id: automation.id, scheduled_for: scheduledFor, trigger: 'SCHEDULED', event_data: { scheduled_for: scheduledFor, scheduler_tick: tickId } }) });
      const detail = await response.json().catch(() => ({})); const failed = !response.ok;
      const result = { status: failed ? 'failed' : 'success', trigger: 'SCHEDULED', scheduled_for: scheduledFor, detail: failed ? { code: clean(detail?.code || 'AUTOMATION_WORKER_FAILED') } : detail };
      await sb.rpc('release_automation_claim', { target_id: automation.id, target_token: automation.claim_token, target_next_run: nextRunAt, target_result: result, target_failed: failed });
      await emit(automation.company_id, failed ? 'AUTOMATION_FAILED' : 'AUTOMATION_COMPLETED', failed ? 'error' : 'success', { automation_id: automation.id });
      results.push({ automation_id: automation.id, company_id: automation.company_id, ...result });
    } catch { const result = { status: 'failed', trigger: 'SCHEDULED', scheduled_for: scheduledFor, code: 'AUTOMATION_DISPATCH_FAILED' }; const next = await sb.rpc('calculate_automation_next_run', { target_frequency: automation.schedule_frequency, target_weekday: automation.schedule_weekday, target_time: automation.schedule_time, target_timezone: automation.timezone || 'UTC', anchor: scheduledFor }); await sb.rpc('release_automation_claim', { target_id: automation.id, target_token: automation.claim_token, target_next_run: next.data || null, target_result: result, target_failed: true }); await emit(automation.company_id, 'AUTOMATION_FAILED', 'error', { automation_id: automation.id }); results.push({ automation_id: automation.id, company_id: automation.company_id, ...result }); }
  }
  await Promise.all(companies.map((companyId) => emit(companyId, 'SCHEDULER_TICK_COMPLETED', 'success', { due: results.filter((row) => row.company_id === companyId).length })));
  return json({ status: 'completed', tick_id: tickId, duration_ms: Date.now() - started, due: results.length, results }, 200);
});
