const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const finiteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

function roundCostUpToMicrounits(value) {
  return Math.ceil(Number(value) * 1_000_000) / 1_000_000;
}

/**
 * Build a conservative token/cost reservation from existing company settings.
 * The configured rate must be the current upper-bound rate for the selected model.
 */
export function planModelReservation({ settings, rateCard, inputTokens, maxOutputTokens }) {
  const cap = Number(settings?.max_daily_ai_cost);
  const maxCalls = Number(settings?.max_daily_ai_calls);
  const maxTokens = Number(settings?.max_tokens_per_request);
  const input = Number(inputTokens);
  const output = Number(maxOutputTokens);

  if (!finitePositive(cap)) return { allowed: false, reason: 'ai_cost_budget_missing' };
  if (!rateCard || !rateCard.rate_version || !rateCard.currency
    || !finiteNonNegative(rateCard.input_cost_per_1k) || !finiteNonNegative(rateCard.output_cost_per_1k)
    || Number(rateCard.input_cost_per_1k) + Number(rateCard.output_cost_per_1k) <= 0) {
    return { allowed: false, reason: 'ai_model_price_missing' };
  }
  if (settings?.ai_budget_currency !== rateCard.currency) return { allowed: false, reason: 'budget_currency_mismatch' };
  if (!finitePositive(maxCalls)) return { allowed: false, reason: 'ai_call_limit_missing' };
  if (!finitePositive(maxTokens)) return { allowed: false, reason: 'ai_token_limit_missing' };
  if (!Number.isSafeInteger(input) || input < 1 || !Number.isSafeInteger(output) || output < 1) {
    return { allowed: false, reason: 'ai_token_reservation_invalid' };
  }

  const totalTokens = input + output;
  if (!Number.isSafeInteger(totalTokens)) {
    return { allowed: false, reason: 'ai_token_reservation_invalid' };
  }
  if (output > maxTokens) {
    return { allowed: false, reason: 'output_tokens_exceeded' };
  }

  const estimatedCost = roundCostUpToMicrounits((Number(rateCard.input_cost_per_1k) * input + Number(rateCard.output_cost_per_1k) * output) / 1000);
  if (!Number.isFinite(estimatedCost) || estimatedCost <= 0) {
    return { allowed: false, reason: 'ai_cost_estimate_invalid' };
  }
  if (estimatedCost > cap) return { allowed: false, reason: 'daily_ai_cost_exceeded' };

  return {
    allowed: true,
    input_tokens: input,
    max_output_tokens: output,
    reserved_tokens: totalTokens,
    estimated_cost: estimatedCost,
  };
}

/** External search providers may be metered independently of model tokens. */
export function planExternalReservation({ settings, rateCard, webQueries }) {
  const cap = Number(settings?.max_daily_ai_cost);
  const count = Number(webQueries);
  if (!finitePositive(cap)) return { allowed: false, reason: 'ai_cost_budget_missing' };
  if (!Number.isSafeInteger(count) || count < 1) return { allowed: false, reason: 'web_query_reservation_invalid' };
  if (!rateCard?.rate_version || !rateCard?.currency || !finitePositive(rateCard.cost_per_query)) return { allowed: false, reason: 'web_query_price_missing' };
  if (settings?.ai_budget_currency !== rateCard.currency) return { allowed: false, reason: 'budget_currency_mismatch' };
  const cost = Number(rateCard.cost_per_query) * count;
  if (!finitePositive(cost)) return { allowed: false, reason: 'web_query_price_missing' };
  const roundedCost = roundCostUpToMicrounits(cost);
  if (roundedCost > cap) return { allowed: false, reason: 'daily_ai_cost_exceeded' };
  return { allowed: true, web_queries: count, estimated_cost: roundedCost };
}

export function validateReservationRequest({ companyId, aiCalls = 0, webQueries = 0, tokens = 0, estimatedCost = 0 }) {
  const cost = Number(estimatedCost);
  if (!companyId || !Number.isSafeInteger(aiCalls) || aiCalls < 0 || !Number.isSafeInteger(webQueries) || webQueries < 0 || !Number.isSafeInteger(tokens) || tokens < 0 || !Number.isFinite(cost) || cost < 0) {
    return { allowed: false, reason: 'budget_request_invalid' };
  }
  if (aiCalls === 0 && webQueries === 0) return { allowed: false, reason: 'budget_request_empty' };
  if (aiCalls > 0 && (tokens < 1 || cost <= 0)) return { allowed: false, reason: 'ai_cost_reservation_required' };
  if (webQueries > 0 && cost <= 0) return { allowed: false, reason: 'web_query_price_missing' };
  return { allowed: true };
}

/** Provider metrics are accepted only as bounded integer counts; raw payloads are never returned. */
export function readProviderUsage(usage, { reservedInputTokens, maxOutputTokens } = {}) {
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens);
  // Actual usage may exceed the estimate or requested output cap. If the
  // provider reports trustworthy bounded counts, settlement must charge them.
  const valid = Number.isSafeInteger(input) && input >= 0 && input <= 10_000_000
    && Number.isSafeInteger(output) && output >= 0 && output <= 10_000_000
    && input + output > 0
    && Number.isSafeInteger(Number(reservedInputTokens)) && Number(reservedInputTokens) >= 0
    && Number.isSafeInteger(Number(maxOutputTokens)) && Number(maxOutputTokens) >= 0;
  return valid ? { input_tokens: input, output_tokens: output, reported: true } : { input_tokens: null, output_tokens: null, reported: false };
}

/** UTF-8 bytes are a conservative token upper bound: a token cannot encode fewer than one byte. */
export function conservativeInputTokenUpperBound(value, framingTokens = 64) {
  if (!Number.isSafeInteger(framingTokens) || framingTokens < 0) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return null;
  const bytes = new TextEncoder().encode(text).length;
  const total = bytes + framingTokens;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export function normalizeRequestKey(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

/** Never start a paid provider call from an incomplete or malformed RPC result. */
export function validateReservationResult({ data, kind, inputTokens = 0, maxOutputTokens = 0, externalQueries = 0 }) {
  if (data?.allowed !== true) {
    const reason = typeof data?.reason === 'string' && /^[a-z0-9_]{1,80}$/.test(data.reason) ? data.reason : 'budget_denied';
    return { allowed: false, reason };
  }
  const cost = Number(data.reserved_cost);
  const validCommon = typeof data.reservation_id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.reservation_id)
    && typeof data.rate_version === 'string' && data.rate_version.trim().length > 0
    && typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency)
    && Number.isFinite(cost) && cost > 0;
  const validModel = kind === 'model_tokens'
    && Number.isSafeInteger(Number(data.reserved_tokens)) && Number(data.reserved_tokens) === inputTokens + maxOutputTokens
    && Number.isSafeInteger(Number(data.max_output_tokens)) && Number(data.max_output_tokens) === maxOutputTokens
    && Number(data.reserved_external_queries) === 0;
  const validExternal = kind === 'external_query'
    && Number.isSafeInteger(Number(data.reserved_external_queries)) && Number(data.reserved_external_queries) === externalQueries
    && Number(data.reserved_tokens) === 0;
  return validCommon && (validModel || validExternal)
    ? { allowed: true }
    : { allowed: false, reason: 'reservation_response_invalid' };
}

export function modelProviderKey(endpoint) {
  try {
    const url = new URL(endpoint || 'https://api.openai.com/v1/chat/completions');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.origin.toLowerCase();
  } catch { return null; }
}

export function externalProviderKey(provider, endpoint) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'brave') return 'brave';
  if (!normalized || normalized === 'disabled' || typeof endpoint !== 'string' || !endpoint.trim()) return null;
  return modelProviderKey(endpoint);
}
