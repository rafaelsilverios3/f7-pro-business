const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * The published plan price is the backend-owned monthly amount. Annual terms
 * use twelve months at the same monthly rate; no discount is implied.
 */
export function priceForBillingPeriod(plan, billingPeriod) {
  const period = String(billingPeriod || '').toLowerCase();
  const configuredPeriod = String(plan?.billing_period || '').toLowerCase();
  const base = Number(plan?.price_minor);
  if (!Number.isSafeInteger(base) || base <= 0 || !['month', 'year'].includes(configuredPeriod)) return null;
  if (!['month', 'year'].includes(period)) return null;
  if (period === configuredPeriod) return base;
  if (configuredPeriod === 'month' && period === 'year') {
    const annual = base * 12;
    return Number.isSafeInteger(annual) && annual <= MAX_SAFE_MINOR ? annual : null;
  }
  // A yearly-only catalog entry cannot be silently divided into a monthly price.
  return null;
}

export function billingPeriodLabel(period) {
  return String(period).toLowerCase() === 'year' ? 'anual' : 'mensal';
}
