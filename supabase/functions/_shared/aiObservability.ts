const STAGES = new Set(['REQUEST_RECEIVED','INTENT_RESOLVED','DOMAIN_SELECTED','CONTEXT_READY','TOOLS_SELECTED','RESEARCH_STARTED','RESEARCH_COMPLETED','CANDIDATES_READY','DECISION_READY','POLICY_CHECKED','RESPONSE_CREATED','RESPONSE_SENT','HANDOFF_CREATED','COMPLETED','FAILED']);
const safe = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

export async function reserveAIBudget(sb: any, input: { company_id: string; ai_calls?: number; web_queries?: number; tokens?: number; estimated_cost?: number }) {
  const result = await sb.rpc('reserve_ai_budget', { target_company: input.company_id, requested_ai_calls: Math.max(0, Math.floor(input.ai_calls || 0)), requested_web_queries: Math.max(0, Math.floor(input.web_queries || 0)), requested_tokens: Math.max(0, Math.floor(input.tokens || 0)), requested_cost: Math.max(0, Number(input.estimated_cost || 0)) });
  if (result.error) return { allowed: false, reason: safe(result.error.code || 'budget_lookup_failed', 80) };
  return { allowed: result.data?.allowed === true, reason: safe(result.data?.reason || 'budget_denied', 80) };
}

export async function recordAIStage(sb: any, input: any) {
  const stage = STAGES.has(input.stage) ? input.stage : 'FAILED';
  const traceId = safe(input.trace_id);
  if (!traceId || !input.company_id) return;
  const status = stage === 'FAILED' ? 'failed' : stage === 'COMPLETED' ? 'completed' : stage === 'HANDOFF_CREATED' ? 'handed_off' : 'running';
  const mode = input.mode === 'supervised_autonomous' ? 'supervised_autonomous' : input.mode === 'automatic' ? 'automatic' : 'assisted';
  const summary = { company_id: input.company_id, trace_id: traceId, conversation_id: input.conversation_id || null, assistant_job_id: input.assistant_job_id || null, mode, status, current_stage: stage, provider: safe(input.provider, 80) || null, model: safe(input.model, 120) || null, tool_names: Array.isArray(input.tool_names) ? input.tool_names.slice(0, 30).map((item: unknown) => safe(item, 80)) : [], query_count: Math.max(0, Number(input.query_count || 0)), source_domains: Array.isArray(input.source_domains) ? input.source_domains.slice(0, 30).map((item: unknown) => safe(item, 160)) : [], candidate_count: Math.max(0, Number(input.candidate_count || 0)), confidence: safe(input.confidence, 40) || null, input_tokens: Number.isFinite(Number(input.input_tokens)) ? Number(input.input_tokens) : null, output_tokens: Number.isFinite(Number(input.output_tokens)) ? Number(input.output_tokens) : null, estimated_cost: Number.isFinite(Number(input.estimated_cost)) ? Number(input.estimated_cost) : null, duration_ms: Number.isFinite(Number(input.duration_ms)) ? Math.max(0, Number(input.duration_ms)) : null, safe_error_code: safe(input.safe_error_code, 80) || null, finished_at: status === 'running' ? null : new Date().toISOString() };
  try {
    await sb.from('ai_runs').upsert(summary, { onConflict: 'company_id,trace_id' });
    await sb.from('ai_run_events').insert({ company_id: input.company_id, trace_id: traceId, stage, status: stage === 'FAILED' ? 'error' : 'success', duration_ms: summary.duration_ms, counts: { queries: summary.query_count, sources: summary.source_domains.length, candidates: summary.candidate_count }, safe_error_code: summary.safe_error_code });
  } catch { /* observability never changes the business result */ }
}
