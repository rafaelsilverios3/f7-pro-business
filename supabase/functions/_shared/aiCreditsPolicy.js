/**
 * Server-side F7 AI Credits calculation primitives.
 * Credits are integer units; no browser-supplied balance, price, rate, or ceiling
 * may be used for authorization. Callers must load these values from trusted
 * plan, wallet, tariff, and FX records before invoking these functions.
 */
export const DEFAULT_AI_CREDIT_CONFIRMATION_POLICY = Object.freeze({
  threshold_credits: 20,
  balance_percent_bps: 1000,
});

const isSafeIntegerAtLeastZero = (value) => Number.isSafeInteger(value) && value >= 0;

export function calculateMaximumAICredits({
  provider_cost_microunits,
  fx_brl_micros_per_currency_unit,
  markup_bps = 10_000,
  credit_value_brl_micros = 10_000,
}) {
  if (!isSafeIntegerAtLeastZero(provider_cost_microunits)
    || !Number.isSafeInteger(fx_brl_micros_per_currency_unit) || fx_brl_micros_per_currency_unit <= 0
    || !Number.isSafeInteger(markup_bps) || markup_bps < 10_000 || markup_bps > 1_000_000
    || !Number.isSafeInteger(credit_value_brl_micros) || credit_value_brl_micros <= 0) {
    return { allowed: false, reason: 'AI_CREDITS_PRICING_INVALID' };
  }

  const numerator = BigInt(provider_cost_microunits)
    * BigInt(fx_brl_micros_per_currency_unit)
    * BigInt(markup_bps);
  const denominator = 1_000_000n * 10_000n * BigInt(credit_value_brl_micros);
  const credits = numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
  if (credits > BigInt(Number.MAX_SAFE_INTEGER)) return { allowed: false, reason: 'AI_CREDITS_PRICING_OVERFLOW' };
  return { allowed: true, max_credits: Number(credits) };
}

export function evaluateAICreditConfirmation({
  max_credits,
  monthly_balance,
  extra_balance,
  threshold_credits = DEFAULT_AI_CREDIT_CONFIRMATION_POLICY.threshold_credits,
  balance_percent_bps = DEFAULT_AI_CREDIT_CONFIRMATION_POLICY.balance_percent_bps,
}) {
  if (!isSafeIntegerAtLeastZero(max_credits)
    || !isSafeIntegerAtLeastZero(monthly_balance)
    || !isSafeIntegerAtLeastZero(extra_balance)
    || !Number.isSafeInteger(threshold_credits) || threshold_credits < 0
    || !Number.isSafeInteger(balance_percent_bps) || balance_percent_bps < 0 || balance_percent_bps > 10_000) {
    return { allowed: false, reason: 'AI_CREDITS_CONFIRMATION_CONFIG_INVALID' };
  }
  const balance = monthly_balance + extra_balance;
  if (!Number.isSafeInteger(balance)) return { allowed: false, reason: 'AI_CREDITS_BALANCE_OVERFLOW' };
  if (max_credits > balance) return { allowed: false, reason: 'AI_CREDITS_INSUFFICIENT', balance };
  const percentageThreshold = Number((BigInt(balance) * BigInt(balance_percent_bps)) / 10_000n);
  const confirmationThreshold = Math.min(threshold_credits, percentageThreshold);
  return {
    allowed: true,
    confirmation_required: max_credits > confirmationThreshold,
    max_credits,
    balance,
    minimum_balance_after: balance - max_credits,
    confirmation_threshold: confirmationThreshold,
  };
}
