const MAX_DAILY_LIMIT = 1000;
const MAX_DAILY_BUDGET = 1000;
const MAX_REQUEST_TOKENS = 100000;
const MAX_RATE = 1_000_000;
// Deliberately narrow until the product has a documented accounting/FX policy.
export const SUPPORTED_AI_CURRENCIES = Object.freeze(['BRL', 'EUR', 'USD']);

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const reasonValid = (value) => typeof value === 'string' && value.trim().length >= 8 && value.length <= 500
  && !/(?:bearer\s|api[_-]?key\s*[:=]|token\s*[:=]|sk-[\w-]{12,}|eyJ[\w-]{20,}\.)/i.test(value);

export function validateCompanyAiBudget(input) {
  if (!input || typeof input.consumption_enabled !== 'boolean' || !reasonValid(input.reason)) {
    return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
  }
  if (!input.consumption_enabled) return { allowed: true };
  const calls = Number(input.daily_calls);
  const webQueries = Number(input.daily_web_queries);
  const budget = Number(input.daily_budget);
  const tokens = Number(input.max_tokens_per_request);
  if (!Number.isInteger(calls) || calls < 1 || calls > MAX_DAILY_LIMIT
    || !Number.isInteger(webQueries) || webQueries < 0 || webQueries > MAX_DAILY_LIMIT
    || !finite(input.daily_budget) || budget <= 0 || budget > MAX_DAILY_BUDGET
    || !Number.isInteger(tokens) || tokens < 256 || tokens > MAX_REQUEST_TOKENS
    || typeof input.currency !== 'string' || !SUPPORTED_AI_CURRENCIES.includes(input.currency)) {
    return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
  }
  return { allowed: true };
}

export function validateAiRateCard(input) {
  if (!input || !reasonValid(input.reason) || !['model_tokens', 'external_query'].includes(input.rate_kind)
    || typeof input.provider_key !== 'string' || input.provider_key.trim().length < 1 || input.provider_key.trim().length > 200
    || typeof input.rate_version !== 'string' || input.rate_version.trim().length < 1 || input.rate_version.trim().length > 80
    || typeof input.currency !== 'string' || !SUPPORTED_AI_CURRENCIES.includes(input.currency)
    || typeof input.source_reference !== 'string' || input.source_reference.length > 500
    || typeof input.enabled !== 'boolean') return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
  try {
    const source = new URL(input.source_reference);
    if (source.protocol !== 'https:' || source.username || source.password || source.search || source.hash) return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
  } catch { return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' }; }
  if (input.rate_kind === 'model_tokens') {
    let providerOrigin = null;
    try {
      const provider = new URL(input.provider_key);
      if (provider.protocol === 'https:' && !provider.username && !provider.password && provider.pathname === '/' && !provider.search && !provider.hash) providerOrigin = provider.origin.toLowerCase();
    } catch { /* invalid provider endpoint key */ }
    if (providerOrigin !== input.provider_key.trim().toLowerCase()
      || typeof input.model_key !== 'string' || input.model_key.trim().length < 1 || input.model_key.trim().length > 160
      || !finite(input.input_cost_per_1k) || !finite(input.output_cost_per_1k)
      || Number(input.input_cost_per_1k) < 0 || Number(input.output_cost_per_1k) < 0
      || Number(input.input_cost_per_1k) + Number(input.output_cost_per_1k) <= 0
      || Number(input.input_cost_per_1k) > MAX_RATE || Number(input.output_cost_per_1k) > MAX_RATE) {
      return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
    }
  } else {
    const provider = String(input.provider_key).trim();
    let validProvider = provider.toLowerCase() === 'brave';
    try {
      const parsed = new URL(provider);
      validProvider ||= parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash && parsed.origin.toLowerCase() === provider.toLowerCase();
    } catch { /* external provider key is not an HTTPS origin */ }
    if (!validProvider || input.model_key || !finite(input.cost_per_query) || Number(input.cost_per_query) <= 0 || Number(input.cost_per_query) > 1000) {
      return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
    }
  }
  const effectiveFrom = Date.parse(input.effective_from);
  if (!Number.isFinite(effectiveFrom) || effectiveFrom < Date.now() - 300_000) return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
  if (input.effective_until && Date.parse(input.effective_until) <= effectiveFrom) return { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
  return { allowed: true };
}

export function validateAiRateCardEnabled(input) {
  return input && typeof input.enabled === 'boolean' && typeof input.rate_card_id === 'string'
    && input.rate_card_id.length <= 80 && reasonValid(input.reason)
    ? { allowed: true }
    : { allowed: false, reason: 'AI_FINANCIAL_CONFIG_INVALID' };
}
