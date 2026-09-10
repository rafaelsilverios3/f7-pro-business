function safeText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : null;
}

function safeArray(value: unknown, limit: number) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

export async function createAssistantHandoff(input: {
  sb: any;
  company_id: string;
  conversation_id: string;
  job_id?: string | null;
  trace_id?: string | null;
  reason: string;
  summary?: string | null;
  decision?: any;
  sources?: any[];
}) {
  const decision = input.decision && typeof input.decision === 'object' ? input.decision : {};
  const result = await input.sb.rpc('create_assistant_handoff', {
    target_company: input.company_id,
    target_conversation: input.conversation_id,
    target_job: input.job_id || null,
    target_trace: safeText(input.trace_id || decision.trace_id, 120),
    target_reason: safeText(input.reason, 80) || 'human_review_required',
    target_summary: safeText(input.summary || decision.explanation, 2000),
    target_known_facts: safeArray([...(safeArray(decision.known_facts, 20)), ...(safeArray(decision.discovered_facts, 20))], 30),
    target_unresolved_facts: safeArray(decision.unresolved_facts, 20),
    target_candidates: safeArray(decision.candidates, 10),
    target_sources: safeArray(input.sources, 10).map((source: any) => ({
      type: safeText(source?.type || source?.source_type, 80),
      domain: safeText(source?.domain || source?.source_domain, 160),
    })),
  });
  return result;
}
