import { corsHeaders, json, admin } from '../_shared/core.ts';
import { createAssistantHandoff } from '../_shared/assistantHandoff.ts';
import { classifyActionRisk } from '../_shared/actionRisk.ts';

const MAX_ATTEMPTS = 3;
const serviceAuthorized = (req: Request) => { const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''; return Boolean(key && req.headers.get('Authorization') === `Bearer ${key}`); };
const safe = (value: unknown, max = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const safeCode = (value: unknown) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(value || '')) ? String(value) : 'INTERNAL_PROVIDER_ERROR';

async function logJob(sb: any, companyId: string, event: string, status: string, metadata: Record<string, unknown>) {
  try { await sb.from('integration_logs').insert({ company_id: companyId, provider: 'f7_intelligence', event, status, metadata }); } catch { /* diagnostics are non-blocking */ }
}

async function finish(sb: any, jobId: string, status: string, errorCode?: string | null, errorStage?: string | null) {
  return sb.rpc('finish_assistant_job', { target_job: jobId, target_status: status, target_response_message: null, target_error_code: errorCode || null, target_error_stage: errorStage || null });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!serviceAuthorized(req)) return json({ code: 'FORBIDDEN' }, 403);
  const startedAt = Date.now();
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  const requestedJobId = typeof body?.job_id === 'string' ? body.job_id : null;
  const claim = await sb.rpc('claim_assistant_job', { target_job: requestedJobId });
  if (claim.error) return json({ code: 'JOB_CLAIM_FAILED', internal_code: safeCode(claim.error.code) }, 500);
  const job = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  if (!job?.id) return json({ status: 'idle' }, 200);
  await logJob(sb, job.company_id, 'INTELLIGENCE_JOB_CLAIMED', 'success', { job_id: job.id, event_id: job.intelligence_event_id || null, attempt_count: job.attempt_count });

  if (!job.intelligence_event_id) {
    await finish(sb, job.id, 'failed', 'INTELLIGENCE_EVENT_REQUIRED', 'event_lookup');
    return json({ code: 'INTELLIGENCE_EVENT_REQUIRED' }, 409);
  }
  const [settingsResult, eventResult] = await Promise.all([
    sb.from('company_assistant_settings').select('autonomy_mode,max_tool_calls_per_job,max_model_calls_per_job,max_research_rounds,max_job_runtime_ms').eq('company_id', job.company_id).maybeSingle(),
    sb.from('intelligence_events').select('*').eq('company_id', job.company_id).eq('id', job.intelligence_event_id).maybeSingle(),
  ]);
  if (settingsResult.error || !settingsResult.data || eventResult.error || !eventResult.data) {
    const code = safeCode(settingsResult.error?.code || eventResult.error?.code || 'INTELLIGENCE_CONTEXT_FAILED');
    const retry = job.attempt_count < MAX_ATTEMPTS;
    await finish(sb, job.id, retry ? 'queued' : 'failed', code, 'intelligence_context');
    if (eventResult.data?.id) await sb.from('intelligence_events').update({ status: retry ? 'PENDING' : 'FAILED', processed_at: retry ? null : new Date().toISOString(), safe_error_code: code }).eq('company_id', job.company_id).eq('id', eventResult.data.id);
    return json({ code, stage: 'intelligence_context' }, 500);
  }
  if (settingsResult.data.autonomy_mode !== 'SUPERVISED_AUTONOMOUS') {
    await finish(sb, job.id, 'cancelled', 'AUTONOMY_NOT_ENABLED', 'policy');
    await sb.from('intelligence_events').update({ status: 'CANCELLED', processed_at: new Date().toISOString(), safe_error_code: 'AUTONOMY_NOT_ENABLED' }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ status: 'cancelled', reason: 'AUTONOMY_NOT_ENABLED' }, 200);
  }
  if (eventResult.data.depth > eventResult.data.max_depth) {
    await finish(sb, job.id, 'failed', 'MAX_STEPS_REACHED', 'loop_guard');
    await sb.from('intelligence_events').update({ status: 'FAILED', processed_at: new Date().toISOString(), safe_error_code: 'MAX_STEPS_REACHED' }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ code: 'MAX_STEPS_REACHED', stage: 'loop_guard' }, 409);
  }

  await sb.from('intelligence_events').update({ status: 'PROCESSING' }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id).eq('status', 'PENDING');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const endpoint = `${Deno.env.get('SUPABASE_URL')}/functions/v1/assistant-suggest`;
  let assistantResponse: Response;
  try {
    assistantResponse = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: job.conversation_id, job_id: job.id }) });
  } catch {
    const retry = job.attempt_count < MAX_ATTEMPTS;
    await finish(sb, job.id, retry ? 'queued' : 'failed', 'ASSISTANT_UNAVAILABLE', 'assistant_request');
    await sb.from('intelligence_events').update({ status: retry ? 'PENDING' : 'FAILED', processed_at: retry ? null : new Date().toISOString(), safe_error_code: 'ASSISTANT_UNAVAILABLE' }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ code: 'ASSISTANT_UNAVAILABLE', stage: 'assistant_request' }, 503);
  }
  const suggestion = await assistantResponse.json().catch(() => null);
  if (!assistantResponse.ok || !suggestion?.success) {
    const code = safeCode(suggestion?.code || suggestion?.error);
    const retry = job.attempt_count < MAX_ATTEMPTS && [429,500,502,503,504].includes(assistantResponse.status);
    if (!retry) await createAssistantHandoff({ sb, company_id: job.company_id, conversation_id: job.conversation_id, job_id: job.id, trace_id: eventResult.data.correlation_id, reason: code, summary: 'A análise autônoma falhou de modo seguro e precisa de revisão humana.' });
    await finish(sb, job.id, retry ? 'queued' : 'handed_off', code, safeCode(suggestion?.stage || 'assistant_request'));
    await sb.from('intelligence_events').update({ status: retry ? 'PENDING' : 'FAILED', safe_error_code: code, processed_at: retry ? null : new Date().toISOString() }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ code, stage: safeCode(suggestion?.stage || 'assistant_request'), retry_scheduled: retry }, assistantResponse.status || 500);
  }

  const proposed = suggestion.intelligence?.proposed_actions?.[0] || {};
  const actionType = safe(proposed.action_type || 'SEND_CUSTOMER_MESSAGE', 80);
  const riskLevel = proposed.risk_level || classifyActionRisk(actionType);
  if (riskLevel === 'CRITICAL') {
    await finish(sb, job.id, 'failed', 'CRITICAL_ACTION_BLOCKED', 'risk_policy');
    await sb.from('intelligence_events').update({ status: 'FAILED', processed_at: new Date().toISOString(), safe_error_code: 'CRITICAL_ACTION_BLOCKED' }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ code: 'CRITICAL_ACTION_BLOCKED', stage: 'risk_policy' }, 403);
  }
  const decision = suggestion.decision || {};
  const elapsed = Date.now() - startedAt;
  if (elapsed > Number(settingsResult.data.max_job_runtime_ms || 60000)) {
    await finish(sb, job.id, 'handed_off', 'MAX_JOB_RUNTIME_REACHED', 'runtime_guard');
    await sb.from('intelligence_events').update({ status: 'FAILED', processed_at: new Date().toISOString(), safe_error_code: 'MAX_JOB_RUNTIME_REACHED' }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ code: 'MAX_JOB_RUNTIME_REACHED', stage: 'runtime_guard' }, 409);
  }
  await sb.from('assistant_jobs').update({ decision, specialist_key: decision.specialist || null, tools_used: Array.isArray(decision.tools) ? decision.tools.slice(0, Number(settingsResult.data.max_tool_calls_per_job || 8)) : [], research: suggestion.product_intelligence?.research_state || {}, confidence: decision.confidence || 'INSUFFICIENT', estimated_cost: 0, latency_ms: elapsed, approval_required: true }).eq('id', job.id).eq('company_id', job.company_id).eq('status', 'processing');
  const proposal = await sb.rpc('create_action_proposal', {
    target_company: job.company_id,
    target_job: job.id,
    target_event: job.intelligence_event_id,
    target_conversation: job.conversation_id,
    target_action_type: actionType,
    target_risk_level: riskLevel,
    target_title: safe(proposed.title || 'Responder cliente', 200),
    target_description: safe(suggestion.suggestion, 4000),
    target_payload: { proposed_text: safe(suggestion.suggestion, 4000), decision_summary: suggestion.intelligence?.decision_summary || null, reason_codes: suggestion.intelligence?.reason_codes || [], specialist: decision.specialist || null, decision, sources: suggestion.sources || [], product_intelligence: { candidates: suggestion.product_intelligence?.candidates || [], eligible_candidates: suggestion.product_intelligence?.candidates || [], rejected_candidates: suggestion.product_intelligence?.rejected_candidates || [], research_state: suggestion.product_intelligence?.research_state || null } },
    target_confidence: decision.confidence || 'INSUFFICIENT',
    target_evidence: suggestion.intelligence?.evidence || [],
    target_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });
  if (proposal.error || !proposal.data?.id) {
    const code = safeCode(proposal.error?.code || 'PROPOSAL_CREATE_FAILED');
    await finish(sb, job.id, 'failed', code, 'proposal_create');
    await sb.from('intelligence_events').update({ status: 'FAILED', processed_at: new Date().toISOString(), safe_error_code: code }).eq('company_id', job.company_id).eq('id', job.intelligence_event_id);
    return json({ code: 'PROPOSAL_CREATE_FAILED', stage: 'proposal_create' }, 500);
  }
  await logJob(sb, job.company_id, 'ACTION_PROPOSAL_CREATED', 'success', { job_id: job.id, event_id: job.intelligence_event_id, proposal_id: proposal.data.id, action_type: actionType, risk_level: riskLevel, confidence: decision.confidence || 'INSUFFICIENT', latency_ms: elapsed });
  return json({ status: 'waiting_approval', job_id: job.id, event_id: job.intelligence_event_id, proposal_id: proposal.data.id }, 200);
});
