const SAFE_AUTOMATIC_ACTIONS = new Set(['ANSWER_WITH_OPTIONS', 'ANSWER_CONFIDENTLY']);

export function authorizeAutomaticAssistantDelivery(input: {
  settings: any;
  decision: any;
  provider_requires_human?: boolean;
  provider_confidence?: string;
  suggestion?: string;
}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const decision = input.decision && typeof input.decision === 'object' ? input.decision : {};
  if (settings.mode !== 'automatic' || settings.automatic_reply_enabled !== true) return { allowed: false, status: 'waiting_input', reason: 'automatic_reply_disabled' };
  if (input.provider_requires_human === true || decision.requires_human === true) return { allowed: false, status: 'handed_off', reason: 'human_review_required' };
  if (decision.auto_reply_eligible !== true || decision.policy_result?.allowed !== true) return { allowed: false, status: 'handed_off', reason: decision.policy_result?.reason || 'decision_not_authorized' };
  const ranks: Record<string, number> = { INSUFFICIENT: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CONFIRMED: 4 };
  const required = String(settings.auto_reply_min_confidence || 'high').toUpperCase();
  const decisionConfidence = String(decision.confidence || 'INSUFFICIENT').toUpperCase();
  const providerConfidence = String(input.provider_confidence || 'low').toUpperCase();
  if ((ranks[decisionConfidence] || 0) < (ranks[required] ?? ranks.HIGH)) return { allowed: false, status: 'handed_off', reason: 'confidence_below_threshold' };
  if ((ranks[providerConfidence] || 0) < Math.min(ranks[required] ?? ranks.HIGH, ranks.HIGH)) return { allowed: false, status: 'handed_off', reason: 'provider_confidence_below_threshold' };
  if (!SAFE_AUTOMATIC_ACTIONS.has(String(decision.selected_action || ''))) return { allowed: false, status: 'waiting_input', reason: 'action_not_automatable' };
  const suggestion = String(input.suggestion || '').trim();
  if (!suggestion || suggestion.length > 4000) return { allowed: false, status: 'failed', reason: 'invalid_response' };
  return { allowed: true, status: 'authorized', reason: 'independent_policy_passed' };
}
