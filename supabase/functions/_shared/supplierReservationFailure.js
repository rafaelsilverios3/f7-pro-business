export function classifySupplierReservationFailure(reason) {
  if (reason === 'ai_cost_budget_missing') return { code: 'AI_BUDGET_NOT_CONFIGURED', status: 402 };
  if (reason === 'daily_ai_cost_exceeded') return { code: 'AI_BUDGET_INSUFFICIENT', status: 402 };
  if (reason === 'daily_web_queries_exceeded' || reason === 'daily_web_queries_disabled') return { code: 'WEB_RESEARCH_LIMIT_REACHED', status: 429 };
  if (reason === 'rate_card_missing_or_ambiguous') return { code: 'WEB_RESEARCH_RATE_NOT_CONFIGURED', status: 503 };
  if (reason === 'budget_currency_mismatch' || reason === 'cost_reservation_invalid') return { code: 'AI_BUDGET_CONFIGURATION_INVALID', status: 503 };
  return { code: 'EXTERNAL_RESEARCH_BUDGET_UNAVAILABLE', status: 503 };
}
