const CATALOG_ERROR = 'PLAN_CATALOG_UNAVAILABLE';

export function buildActivePlanCatalog(plans, features = []) {
  if (!Array.isArray(plans) || plans.length === 0 || !Array.isArray(features)) {
    throw new Error(CATALOG_ERROR);
  }

  const codes = new Set();
  for (const plan of plans) {
    const code = typeof plan?.code === 'string' ? plan.code.trim().toLowerCase() : '';
    const name = typeof plan?.name === 'string' ? plan.name.trim() : '';
    const price = plan?.price_minor == null ? null : Number(plan.price_minor);
    const currency = String(plan?.currency || '').toUpperCase();
    const period = String(plan?.billing_period || '').toLowerCase();
    if (!code || !name || codes.has(code)
      || (price !== null && (!Number.isSafeInteger(price) || price < 0))
      || (currency && !/^[A-Z]{3}$/.test(currency))
      || !['month', 'year'].includes(period)) {
      throw new Error(CATALOG_ERROR);
    }
    codes.add(code);
  }

  return plans.map((plan) => ({
    ...plan,
    code: plan.code.trim().toLowerCase(),
    price_minor: plan.price_minor == null ? null : Number(plan.price_minor),
    currency: String(plan.currency || 'BRL').toUpperCase(),
    billing_period: String(plan.billing_period).toLowerCase(),
    features: features
      .filter((feature) => feature.plan_id === plan.id)
      .map(({ plan_id, ...feature }) => feature),
  }));
}

export function planCatalogUnavailable() {
  return new Error(CATALOG_ERROR);
}
