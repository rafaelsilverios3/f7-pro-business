import { externalProviderKey, modelProviderKey, validateReservationRequest, validateReservationResult } from './aiBudgetPolicy.js';
import { reportAIObservabilityFailure } from './aiMaintenance.js';

const STAGES = new Set(['REQUEST_RECEIVED','INTENT_RESOLVED','DOMAIN_SELECTED','CONTEXT_READY','TOOLS_SELECTED','RESEARCH_STARTED','RESEARCH_COMPLETED','CANDIDATES_READY','DECISION_READY','POLICY_CHECKED','BUDGET_RESERVED','COMPLETED','RESPONSE_CREATED','RESPONSE_SENT','HANDOFF_CREATED','FAILED']);
const safe = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

type BudgetInput = { company_id: string; ai_calls?: number; web_queries?: number; tokens?: number; estimated_cost?: number };
export type AIReservationResult = {
  allowed: boolean;
  reason: string;
  reservation_id?: string;
  rate_version?: string;
  currency?: string;
  reserved_cost?: number;
  estimated_cost?: number;
  reserved_tokens?: number;
  max_output_tokens?: number;
  reserved_external_queries?: number;
  web_queries?: number;
};

export async function reserveAIBudget(sb: any, input: BudgetInput) {
  const aiCalls = input.ai_calls ?? 0;
  const webQueries = input.web_queries ?? 0;
  const tokens = input.tokens ?? 0;
  const cost = input.estimated_cost ?? 0;
  const validation = validateReservationRequest({ companyId: input.company_id, aiCalls, webQueries, tokens, estimatedCost: cost });
  if (!validation.allowed) return validation;

  // Deprecated aggregate helper: it has no request id or rate-card identity.
  // The legacy SQL RPC is fail-closed; paid callers must use the v2 reservation APIs.
  const { data: settings, error: settingsError } = await sb.from('company_assistant_settings').select('max_daily_ai_cost').eq('company_id', input.company_id).maybeSingle();
  if (settingsError || !Number.isFinite(Number(settings?.max_daily_ai_cost)) || Number(settings?.max_daily_ai_cost) <= 0) {
    return { allowed: false, reason: 'ai_cost_budget_missing' };
  }

  const result = await sb.rpc('reserve_ai_budget', { target_company: input.company_id, requested_ai_calls: aiCalls, requested_web_queries: webQueries, requested_tokens: tokens, requested_cost: cost });
  if (result.error) return { allowed: false, reason: safe(result.error.code || 'budget_lookup_failed', 80) };
  return { allowed: result.data?.allowed === true, reason: safe(result.data?.reason || 'budget_denied', 80) };
}

export async function reserveAIModelBudget(sb: any, input: { company_id: string; request_key: string; model_key: string; settings?: Record<string, unknown> | null; input_tokens: number; max_output_tokens: number }): Promise<AIReservationResult> {
  const provider = modelProviderKey(Deno.env.get('AI_API_URL'));
  const model = String(input.model_key || '').trim();
  const requestKey = input.request_key;
  if (!input.company_id || !requestKey || !provider || !model || !Number.isSafeInteger(input.input_tokens) || input.input_tokens < 1 || !Number.isSafeInteger(input.max_output_tokens) || input.max_output_tokens < 1) {
    return { allowed: false, reason: 'ai_reservation_request_invalid' };
  }
  const result = await sb.rpc('reserve_ai_budget_v2', {
    target_company: input.company_id, request_key: requestKey, requested_kind: 'model_tokens', requested_provider: provider,
    requested_model: model, requested_input_tokens: input.input_tokens, requested_output_tokens: input.max_output_tokens,
    requested_external_queries: 0,
  });
  if (result.error) return { allowed: false, reason: safe(result.error.code || 'budget_lookup_failed', 80) };
  const data = result.data || {};
  const validation = validateReservationResult({ data, kind: 'model_tokens', inputTokens: input.input_tokens, maxOutputTokens: input.max_output_tokens });
  if (!validation.allowed) return { allowed: false, reason: validation.reason };
  return { allowed: true, reason: 'budget_reserved', reservation_id: data.reservation_id, rate_version: data.rate_version, currency: data.currency, reserved_cost: Number(data.reserved_cost), estimated_cost: Number(data.reserved_cost), reserved_tokens: Number(data.reserved_tokens), max_output_tokens: Number(data.max_output_tokens), reserved_external_queries: 0 };
}

export async function reserveAIExternalBudget(sb: any, input: { company_id: string; settings?: Record<string, unknown> | null; web_queries: number; request_key: string }): Promise<AIReservationResult> {
  const provider = externalProviderKey(Deno.env.get('WEB_SEARCH_PROVIDER'), Deno.env.get('WEB_SEARCH_API_URL'));
  if (!input.company_id || !input.request_key || !provider || !Number.isSafeInteger(input.web_queries) || input.web_queries < 1) {
    return { allowed: false, reason: 'external_reservation_request_invalid' };
  }
  const result = await sb.rpc('reserve_ai_budget_v2', {
    target_company: input.company_id, request_key: input.request_key, requested_kind: 'external_query', requested_provider: provider,
    requested_model: null, requested_input_tokens: 0, requested_output_tokens: 0, requested_external_queries: input.web_queries,
  });
  if (result.error) return { allowed: false, reason: safe(result.error.code || 'budget_lookup_failed', 80) };
  const data = result.data || {};
  const validation = validateReservationResult({ data, kind: 'external_query', externalQueries: input.web_queries });
  if (!validation.allowed) return { allowed: false, reason: validation.reason };
  return { allowed: true, reason: 'budget_reserved', reservation_id: data.reservation_id, rate_version: data.rate_version, currency: data.currency, reserved_cost: Number(data.reserved_cost), estimated_cost: Number(data.reserved_cost), reserved_tokens: 0, max_output_tokens: 0, reserved_external_queries: Number(data.reserved_external_queries), web_queries: Number(data.reserved_external_queries) };
}

export async function settleAIReservation(sb: any, input: { company_id: string; reservation_id: string; request_key: string; input_tokens?: number | null; output_tokens?: number | null; external_queries?: number | null; usage_reliable: boolean }) {
  const result = await sb.rpc('settle_ai_budget_v2', {
    target_company: input.company_id, target_reservation: input.reservation_id, request_key: input.request_key,
    usage_reliable: input.usage_reliable, actual_input_tokens: input.input_tokens ?? null,
    actual_output_tokens: input.output_tokens ?? null, actual_external_queries: input.external_queries ?? null,
  });
  if (result.error) return { settled: false, reason: safe(result.error.code || 'settlement_failed', 80) };
  return result.data || { settled: false, reason: 'settlement_failed' };
}

export async function markAIReservationUncertain(sb: any, input: { company_id: string; reservation_id: string; request_key: string; reason_code?: string }) {
  const result = await sb.rpc('mark_ai_budget_uncertain', {
    target_company: input.company_id, target_reservation: input.reservation_id, request_key: input.request_key,
    reason_code: safe(input.reason_code || 'provider_result_unknown', 80),
  });
  if (result.error) return { marked: false, reason: safe(result.error.code || 'uncertainty_record_failed', 80) };
  return result.data || { marked: false, reason: 'uncertainty_record_failed' };
}

export async function recordAIStage(sb: any, input: any) {
  const stage = STAGES.has(input.stage) ? input.stage : 'FAILED';
  const traceId = safe(input.trace_id);
  if (!traceId || !input.company_id) return;
  const status = stage === 'FAILED' ? 'failed' : stage === 'COMPLETED' ? 'completed' : stage === 'HANDOFF_CREATED' ? 'handed_off' : 'running';
  const mode = input.mode === 'supervised_autonomous' ? 'supervised_autonomous' : input.mode === 'automatic' ? 'automatic' : 'assisted';
  const numericMetric = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const duration = numericMetric(input.duration_ms);
  const summary = { company_id: input.company_id, trace_id: traceId, conversation_id: input.conversation_id || null, assistant_job_id: input.assistant_job_id || null, mode, status, current_stage: stage, provider: safe(input.provider, 80) || null, model: safe(input.model, 120) || null, tool_names: Array.isArray(input.tool_names) ? input.tool_names.slice(0, 30).map((item: unknown) => safe(item, 80)) : [], query_count: Math.max(0, Number(input.query_count || 0)), source_domains: Array.isArray(input.source_domains) ? input.source_domains.slice(0, 30).map((item: unknown) => safe(item, 160)) : [], candidate_count: Math.max(0, Number(input.candidate_count || 0)), confidence: safe(input.confidence, 40) || null, input_tokens: numericMetric(input.input_tokens), output_tokens: numericMetric(input.output_tokens), estimated_cost: numericMetric(input.estimated_cost), duration_ms: duration === null ? null : Math.max(0, duration), safe_error_code: safe(input.safe_error_code, 80) || null, finished_at: status === 'running' ? null : new Date().toISOString() };
  try {
    const { error: runError } = await sb.from('ai_runs').upsert(summary, { onConflict: 'company_id,trace_id' });
    if (runError) reportAIObservabilityFailure(status === 'running' ? 'run_start' : 'run_finalize', runError);
    const { error: eventError } = await sb.from('ai_run_events').insert({ company_id: input.company_id, trace_id: traceId, stage, status: stage === 'FAILED' ? 'error' : 'success', duration_ms: summary.duration_ms, counts: { queries: summary.query_count, sources: summary.source_domains.length, candidates: summary.candidate_count, reserved_tokens: numericMetric(input.reserved_tokens), reserved_cost: numericMetric(input.reserved_cost), provider_usage_reported: input.provider_usage_reported === true }, safe_error_code: summary.safe_error_code });
    if (eventError) reportAIObservabilityFailure('run_event', eventError);
  } catch (error) {
    reportAIObservabilityFailure(status === 'running' ? 'run_start' : 'run_finalize', error);
  }
}
