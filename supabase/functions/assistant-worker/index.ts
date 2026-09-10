import { corsHeaders, json, admin } from '../_shared/core.ts';
import { authorizeAutomaticAssistantDelivery } from '../_shared/assistantJobPolicy.ts';
import { createAssistantHandoff } from '../_shared/assistantHandoff.ts';
import { sendWhatsAppText } from '../_shared/whatsappOutbound.ts';

const MAX_ATTEMPTS = 3;

function serviceAuthorized(req: Request) {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const header = req.headers.get('Authorization') || '';
  return Boolean(expected && header === `Bearer ${expected}`);
}

function safeCode(value: unknown) {
  const code = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'INTERNAL_PROVIDER_ERROR';
}

async function logJob(sb: any, companyId: string, event: string, status: string, metadata: Record<string, unknown>) {
  try { await sb.from('integration_logs').insert({ company_id: companyId, provider: 'assistant', event, status, metadata }); } catch { /* diagnostics are non-blocking */ }
}

async function finish(sb: any, jobId: string, status: string, responseMessageId?: string | null, errorCode?: string | null, errorStage?: string | null) {
  return sb.rpc('finish_assistant_job', { target_job: jobId, target_status: status, target_response_message: responseMessageId || null, target_error_code: errorCode || null, target_error_stage: errorStage || null });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!serviceAuthorized(req)) return json({ code: 'FORBIDDEN' }, 403);
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  const requestedJobId = typeof body?.job_id === 'string' ? body.job_id : null;
  const claim = await sb.rpc('claim_assistant_job', { target_job: requestedJobId });
  if (claim.error) return json({ code: 'JOB_CLAIM_FAILED', internal_code: safeCode(claim.error.code) }, 500);
  const job = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  if (!job?.id) return json({ status: 'idle' }, 200);
  await logJob(sb, job.company_id, 'ASSISTANT_JOB_CLAIMED', 'success', { job_id: job.id, trace_id: job.trace_id || null, attempt_count: job.attempt_count });

  const settingsResult = await sb.from('company_assistant_settings').select('mode,automatic_reply_enabled,auto_reply_min_confidence').eq('company_id', job.company_id).maybeSingle();
  if (settingsResult.error || !settingsResult.data) {
    const code = safeCode(settingsResult.error?.code);
    await finish(sb, job.id, job.attempt_count < MAX_ATTEMPTS ? 'queued' : 'failed', null, code, 'settings_lookup');
    return json({ code, stage: 'settings_lookup' }, 500);
  }
  if (settingsResult.data.mode !== 'automatic' || settingsResult.data.automatic_reply_enabled !== true) {
    await finish(sb, job.id, 'waiting_input', null, 'AUTOMATIC_MODE_DISABLED', 'policy');
    return json({ status: 'waiting_input', reason: 'automatic_reply_disabled' }, 200);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const endpoint = `${Deno.env.get('SUPABASE_URL')}/functions/v1/assistant-suggest`;
  let assistantResponse: Response;
  try {
    assistantResponse = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: job.conversation_id, job_id: job.id }) });
  } catch {
    await finish(sb, job.id, job.attempt_count < MAX_ATTEMPTS ? 'queued' : 'failed', null, 'ASSISTANT_UNAVAILABLE', 'assistant_request');
    return json({ code: 'ASSISTANT_UNAVAILABLE', stage: 'assistant_request' }, 503);
  }
  const suggestion = await assistantResponse.json().catch(() => null);
  if (!assistantResponse.ok || !suggestion?.success) {
    const code = safeCode(suggestion?.code || suggestion?.error);
    const retry = job.attempt_count < MAX_ATTEMPTS && [429, 500, 502, 503, 504].includes(assistantResponse.status);
    await finish(sb, job.id, retry ? 'queued' : 'failed', null, code, safeCode(suggestion?.stage || 'assistant_request'));
    return json({ code, stage: safeCode(suggestion?.stage || 'assistant_request'), retry_scheduled: retry }, assistantResponse.status || 500);
  }

  const policy = authorizeAutomaticAssistantDelivery({ settings: settingsResult.data, decision: suggestion.decision, provider_requires_human: suggestion.requires_human, provider_confidence: suggestion.confidence, suggestion: suggestion.suggestion });
  if (!policy.allowed) {
    if (policy.status === 'handed_off') {
      const handoff = await createAssistantHandoff({ sb, company_id: job.company_id, conversation_id: job.conversation_id, job_id: job.id, trace_id: suggestion.decision?.trace_id, reason: policy.reason, summary: suggestion.suggestion, decision: suggestion.decision, sources: suggestion.sources });
      if (handoff.error) {
        await finish(sb, job.id, 'failed', null, safeCode(handoff.error.code), 'handoff_create');
        return json({ code: 'HANDOFF_CREATE_FAILED', stage: 'handoff_create' }, 500);
      }
    }
    await finish(sb, job.id, policy.status, null, policy.reason, 'policy');
    await logJob(sb, job.company_id, policy.status === 'handed_off' ? 'ASSISTANT_HANDOFF_REQUIRED' : 'ASSISTANT_JOB_WAITING_INPUT', 'success', { job_id: job.id, trace_id: suggestion.decision?.trace_id || null, reason: policy.reason, selected_action: suggestion.decision?.selected_action || null });
    return json({ status: policy.status, reason: policy.reason }, 200);
  }

  const deliveryClaim = await sb.rpc('authorize_assistant_job_delivery', { target_job: job.id, target_trace: suggestion.decision?.trace_id || job.trace_id || '', target_decision: suggestion.decision });
  if (deliveryClaim.error || deliveryClaim.data !== true) {
    await finish(sb, job.id, 'failed', null, safeCode(deliveryClaim.error?.code || 'DELIVERY_ALREADY_CLAIMED'), 'delivery_claim');
    return json({ code: 'DELIVERY_NOT_AUTHORIZED', stage: 'delivery_claim' }, 409);
  }

  const conversationResult = await sb.from('conversations').select('id,company_id,lead_phone,channel,status').eq('id', job.conversation_id).eq('company_id', job.company_id).maybeSingle();
  if (conversationResult.error || !conversationResult.data) {
    await finish(sb, job.id, 'failed', null, safeCode(conversationResult.error?.code || 'CONVERSATION_NOT_FOUND'), 'conversation_lookup');
    return json({ code: 'CONVERSATION_NOT_FOUND', stage: 'conversation_lookup' }, 404);
  }
  const outbound = await sendWhatsAppText({ sb, conversation: conversationResult.data, message: suggestion.suggestion, client_request_id: job.id, sender_type: 'assistant', request_id: suggestion.decision?.trace_id || job.id });
  if (!outbound.ok) {
    await finish(sb, job.id, 'failed', null, outbound.code, outbound.stage);
    return json({ code: outbound.code, stage: outbound.stage }, outbound.status);
  }
  const finalized = await finish(sb, job.id, 'completed', outbound.message.id, null, null);
  if (finalized.error || finalized.data !== true) {
    await logJob(sb, job.company_id, 'ASSISTANT_JOB_FINALIZE_FAILED', 'error', { job_id: job.id, trace_id: suggestion.decision?.trace_id || null, stage: 'job_finalize', internal_code: safeCode(finalized.error?.code) });
    return json({ code: 'JOB_FINALIZE_FAILED', stage: 'job_finalize' }, 500);
  }
  await logJob(sb, job.company_id, 'ASSISTANT_JOB_COMPLETED', 'success', { job_id: job.id, trace_id: suggestion.decision?.trace_id || null, response_message_id: outbound.message.id, deduplicated: outbound.deduplicated });
  return json({ status: 'completed', job_id: job.id, response_message_id: outbound.message.id }, 200);
});
