const NON_REVENUE_STATUSES = new Set(['draft', 'cancelled', 'canceled']);

/** Drafts are not completed commercial transactions and must not enter KPIs. */
export function isRevenueSale(sale) {
  return !NON_REVENUE_STATUSES.has(String(sale?.status || '').trim().toLowerCase());
}

/** Draft RPC items may omit a persisted line total; derive it from quantity and price. */
export function saleItemTotal(item) {
  const total = Number(item?.total);
  if (item?.total !== null && item?.total !== undefined && Number.isFinite(total)) return total;
  const quantity = Number(item?.qty ?? item?.quantity);
  const price = Number(item?.price);
  return Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : 0;
}
