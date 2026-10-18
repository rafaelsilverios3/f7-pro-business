import { reportAIObservabilityFailure } from './aiMaintenance.js';

const RUN_FIELDS = new Set([
  'conversation_id', 'assistant_job_id', 'intelligence_event_id', 'action_proposal_id',
  'mode', 'status', 'current_stage', 'provider', 'model', 'tool_names', 'query_count',
  'source_domains', 'candidate_count', 'confidence', 'input_tokens', 'output_tokens',
  'estimated_cost', 'duration_ms', 'safe_error_code', 'started_at', 'finished_at',
]);
const RUN_STATUSES = new Set(['running', 'completed', 'failed', 'handed_off']);
const RUN_MODES = new Set(['assisted', 'automatic', 'supervised_autonomous']);
const TEXT_FIELDS = new Set(['provider', 'model', 'current_stage', 'confidence']);
const INTEGER_FIELDS = new Set(['query_count', 'candidate_count', 'input_tokens', 'output_tokens', 'duration_ms']);

function safeLabel(value, max = 120) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  return normalized || null;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function buildAIRunPayload({ companyId, traceId, patch = {}, now = new Date().toISOString() }) {
  const payload = { company_id: companyId, trace_id: traceId, mode: 'assisted' };
  for (const [field, value] of Object.entries(patch)) {
    if (!RUN_FIELDS.has(field)) continue;
    if (field === 'mode') {
      if (RUN_MODES.has(value)) payload.mode = value;
      continue;
    }
    if (field === 'status') {
      if (RUN_STATUSES.has(value)) payload.status = value;
      continue;
    }
    if (TEXT_FIELDS.has(field)) {
      const normalized = safeLabel(value, field === 'current_stage' ? 80 : 120);
      if (normalized) payload[field] = normalized;
      continue;
    }
    if (field === 'safe_error_code') {
      const normalized = typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : null;
      if (normalized) payload[field] = normalized;
      continue;
    }
    if (field === 'tool_names' || field === 'source_domains') {
      if (!Array.isArray(value)) continue;
      payload[field] = value.slice(0, 30).map((item) => safeLabel(item, field === 'source_domains' ? 160 : 80)).filter(Boolean);
      continue;
    }
    if (INTEGER_FIELDS.has(field)) {
      if (value === null && ['input_tokens', 'output_tokens'].includes(field)) payload[field] = null;
      else if (Number.isSafeInteger(value) && value >= 0) payload[field] = value;
      continue;
    }
    if (field === 'estimated_cost') {
      if (value === null) payload[field] = null;
      else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) payload[field] = value;
      continue;
    }
    if (field.endsWith('_id')) {
      if (value === null || (typeof value === 'string' && value.length <= 80)) payload[field] = value;
      continue;
    }
    if (field === 'started_at' || field === 'finished_at') {
      const timestamp = validTimestamp(value);
      if (timestamp) payload[field] = timestamp;
    }
  }

  if (!payload.current_stage) payload.current_stage = 'REQUEST_RECEIVED';
  if (payload.status && payload.status !== 'running' && !payload.finished_at) payload.finished_at = validTimestamp(now);
  if (payload.status === 'running') payload.finished_at = null;
  return payload;
}

/** Persist one allowlisted row and observe PostgREST error results as well as throws. */
export async function persistAIRun(sb, { companyId, traceId, patch, operation = 'run_finalize' }) {
  const payload = buildAIRunPayload({ companyId, traceId, patch });
  try {
    const { error } = await sb.from('ai_runs').upsert(payload, { onConflict: 'company_id,trace_id' });
    if (error) {
      reportAIObservabilityFailure(operation, error);
      return false;
    }
    return true;
  } catch (error) {
    reportAIObservabilityFailure(operation, error);
    return false;
  }
}

export async function persistAIRunEvent(sb, { companyId, traceId, event }) {
  try {
    const { error } = await sb.from('ai_run_events').insert(event);
    if (error) {
      reportAIObservabilityFailure('run_event', error);
      return false;
    }
    return true;
  } catch (error) {
    reportAIObservabilityFailure('run_event', error);
    return false;
  }
}
