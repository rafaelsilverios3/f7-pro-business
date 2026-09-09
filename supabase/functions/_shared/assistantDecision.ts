export type AssistantNextAction = 'SEARCH_MORE' | 'ASK_CUSTOMER' | 'ANSWER_WITH_OPTIONS' | 'ANSWER_CONFIDENTLY' | 'CHECK_STOCK' | 'PREPARE_QUOTE' | 'HANDOFF_HUMAN' | 'STOP';
export type AssistantDecision = {
  trace_id: string;
  intent: 'part_research' | 'catalog_lookup' | 'general_support' | 'commercial_action';
  domain: string;
  objective: string;
  investigation_state: 'researching' | 'candidates_found' | 'confirmed' | 'blocked';
  known_facts: any[];
  discovered_facts: any[];
  inferred_facts: any[];
  unresolved_facts: string[];
  evidence: any[];
  confidence: 'CONFIRMED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  candidates: Array<{ part_number: string; confidence: string; source_type?: string; score?: number }>;
  conflicts: string[];
  risks: string[];
  possible_actions: AssistantNextAction[];
  selected_action: AssistantNextAction;
  next_action: AssistantNextAction;
  requires_human: boolean;
  policy_result: { allowed: boolean; reason: string };
  explanation: string;
  auto_reply_eligible: boolean;
};

const rank = { CONFIRMED: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INSUFFICIENT: 0 } as const;

export function createAssistantDecision(input: {
  text?: string;
  candidates?: any[];
  researchPending?: boolean;
  unresolvedQuestions?: string[];
  automaticReplyEnabled?: boolean;
  minConfidence?: string;
  graveConflict?: boolean;
  traceId?: string;
  domain?: string;
  objective?: string;
  knownFacts?: any[];
  discoveredFacts?: any[];
  inferredFacts?: any[];
  evidence?: any[];
}) : AssistantDecision {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const normalized = candidates.map((candidate) => ({ part_number: String(candidate?.part_number || '').slice(0, 80), confidence: String(candidate?.confidence_level || 'INSUFFICIENT').toUpperCase(), source_type: typeof candidate?.source_type === 'string' ? candidate.source_type.slice(0, 80) : undefined, score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : undefined })).filter((candidate) => candidate.part_number);
  const best = normalized.reduce((current, candidate) => (rank[candidate.confidence as keyof typeof rank] || 0) > (rank[current as keyof typeof rank] || 0) ? candidate.confidence : current, 'INSUFFICIENT');
  const unresolved = Array.isArray(input.unresolvedQuestions) ? input.unresolvedQuestions.slice(0, 10).map((item) => String(item).slice(0, 120)) : [];
  const intent = /\b(pn|p\/?n|c[oó]digo|filtro|correia|rolamento|pe[cç]a|compatibilidade)\b/i.test(String(input.text || '')) ? 'part_research' : 'general_support';
  const min = String(input.minConfidence || 'HIGH').toUpperCase() as keyof typeof rank;
  const eligible = Boolean(input.automaticReplyEnabled) && !input.graveConflict && (rank[best as keyof typeof rank] || 0) >= (rank[min] ?? rank.HIGH);
  const next_action = eligible ? (best === 'CONFIRMED' ? 'ANSWER_CONFIDENTLY' : 'ANSWER_WITH_OPTIONS') : input.researchPending ? 'SEARCH_MORE' : normalized.length ? 'ASK_CUSTOMER' : 'HANDOFF_HUMAN';
  const policyReason = !input.automaticReplyEnabled ? 'automatic_reply_disabled' : input.graveConflict ? 'grave_source_conflict' : eligible ? 'confidence_policy_passed' : 'confidence_below_threshold';
  return { trace_id: String(input.traceId || crypto.randomUUID()), intent, domain: String(input.domain || 'general').slice(0, 80), objective: String(input.objective || input.text || '').slice(0, 240), investigation_state: best === 'CONFIRMED' ? 'confirmed' : normalized.length ? 'candidates_found' : input.researchPending ? 'researching' : 'blocked', known_facts: Array.isArray(input.knownFacts) ? input.knownFacts.slice(0, 30) : [], discovered_facts: Array.isArray(input.discoveredFacts) ? input.discoveredFacts.slice(0, 30) : [], inferred_facts: Array.isArray(input.inferredFacts) ? input.inferredFacts.slice(0, 20) : [], unresolved_facts: unresolved, evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 30) : [], confidence: best as AssistantDecision['confidence'], candidates: normalized.slice(0, 10), conflicts: input.graveConflict ? ['source_conflict'] : [], risks: input.graveConflict ? ['technical_misidentification'] : [], possible_actions: ['SEARCH_MORE', 'ASK_CUSTOMER', 'ANSWER_WITH_OPTIONS', 'ANSWER_CONFIDENTLY', 'HANDOFF_HUMAN'], selected_action: next_action, next_action, requires_human: !eligible, policy_result: { allowed: eligible, reason: policyReason }, explanation: policyReason, auto_reply_eligible: eligible };
}
