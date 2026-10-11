const DAY_MS = 86_400_000;
export const INACTIVITY_DAYS = 90;
export const RECENT_PURCHASE_DAYS = 30;

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const dateMs = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const dateOnly = (value) => {
  const parsed = dateMs(value);
  return parsed === null ? null : new Date(parsed).toISOString().slice(0, 10);
};
const saleDate = (sale) => sale?.sale_date || sale?.created_at || sale?.created_date || null;
const validSale = (sale) => sale?.status !== 'cancelled';
const daysSince = (value, nowMs) => {
  const from = dateMs(value);
  return from === null ? null : Math.max(0, Math.floor((nowMs - from) / DAY_MS));
};
const itemQuantity = (item) => number(item?.qty ?? item?.quantity);
const itemValue = (item) => {
  const total = Number(item?.total);
  return Number.isFinite(total) ? total : itemQuantity(item) * number(item?.price);
};
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const closedOpportunity = new Set(['won', 'lost', 'descartada', 'descartado', 'converted', 'convertida_em_produto', 'resolvida', 'resolved', 'closed', 'encerrada', 'encerrado']);

/** @typedef {import('../types/f7Domain').Customer} Customer */
/** @typedef {import('../types/f7Domain').Sale} Sale */
/** @typedef {import('../types/f7Domain').CrmActivity} CrmActivity */
/** @typedef {import('../types/f7Domain').Opportunity} Opportunity */

/**
 * Derives post-sale facts from already loaded tenant data. This is advisory
 * only: it never changes customer status/tags and never creates contact work.
 */
/** @param {{customer?: Customer, sales?: Sale[], activities?: CrmActivity[], opportunities?: Opportunity[], now?: Date, recentDays?: number, inactiveDays?: number}} [options] */
export function buildCustomerRelationshipFacts({ customer, sales = [], activities = [], opportunities = [], now = new Date(), recentDays = RECENT_PURCHASE_DAYS, inactiveDays = INACTIVITY_DAYS } = {}) {
  const nowMs = dateMs(now) || Date.now();
  const history = sales.filter((sale) => validSale(sale) && sale.customer_id === customer?.id && dateMs(saleDate(sale)) !== null).sort((a, b) => dateMs(saleDate(a)) - dateMs(saleDate(b)));
  const dates = history.map(saleDate);
  const lastPurchase = dates.at(-1) || null;
  const daysSinceLastPurchase = lastPurchase ? daysSince(lastPurchase, nowMs) : null;
  const intervals = dates.slice(1).map((date, index) => Math.floor((dateMs(date) - dateMs(dates[index])) / DAY_MS)).filter((value) => value > 0);
  const sufficientHistory = history.length >= 3 && intervals.length >= 2;
  const medianIntervalDays = median(intervals);
  const averageIntervalDays = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
  const pendingActivities = activities.filter((activity) => activity.customer_id === customer?.id && activity.status === 'PENDENTE');
  const postSaleActivity = lastPurchase ? activities.some((activity) => {
    if (activity.customer_id !== customer?.id || activity.status === 'CANCELADA') return false;
    return [activity.completed_at, activity.created_at, activity.due_at].some((activityDate) => dateMs(activityDate) !== null && dateMs(activityDate) >= dateMs(lastPurchase));
  }) : false;
  const products = new Map();
  history.forEach((sale) => (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
    const key = item.product_id || item.productId || item.id || String(item.name || '').trim().toLocaleLowerCase('pt-BR');
    if (!key) return;
    const current = products.get(key) || { id: item.product_id || item.productId || item.id || null, name: item.name || item.product_name || 'Produto', quantity: 0, purchase_count: 0, total_value: 0, last_purchase: null, sale_keys: new Set() };
    current.quantity += itemQuantity(item);
    const saleKey = sale.id || saleDate(sale);
    if (saleKey && !current.sale_keys.has(saleKey)) { current.sale_keys.add(saleKey); current.purchase_count += 1; }
    current.total_value += itemValue(item);
    current.last_purchase = saleDate(sale);
    products.set(key, current);
  }));
  const relatedOpportunities = opportunities.filter((item) => item.customer_id === customer?.id || (item.metadata?.entity_type === 'customer' && item.metadata?.entity_id === customer?.id));
  const openOpportunities = relatedOpportunities.filter((item) => !closedOpportunity.has(String(item.metadata?.radar_state || item.stage || item.status || '').toLocaleLowerCase('pt-BR')));
  const revenue = history.reduce((sum, sale) => sum + number(sale.total), 0);
  const overdueRepurchase = Boolean(sufficientHistory && medianIntervalDays > 0 && daysSinceLastPurchase !== null && daysSinceLastPurchase > medianIntervalDays);
  return {
    purchases: history.length,
    revenue,
    average_ticket: history.length ? revenue / history.length : 0,
    first_purchase: dates[0] || null,
    last_purchase: lastPurchase ? dateOnly(lastPurchase) : null,
    days_since_last_purchase: daysSinceLastPurchase,
    inactive_days: daysSinceLastPurchase,
    is_recent_purchase: daysSinceLastPurchase !== null && daysSinceLastPurchase <= recentDays,
    is_inactive: daysSinceLastPurchase === null || daysSinceLastPurchase >= inactiveDays,
    without_post_sale_followup: Boolean(lastPurchase && daysSinceLastPurchase !== null && daysSinceLastPurchase <= recentDays && !postSaleActivity),
    pending_followups: pendingActivities.length,
    open_opportunities: openOpportunities.length,
    activities,
    overdue_repurchase: overdueRepurchase,
    purchase_pattern: {
      sufficient_history: sufficientHistory,
      interval_days: medianIntervalDays,
      median_interval_days: medianIntervalDays,
      average_interval_days: averageIntervalDays === null ? null : Math.round(averageIntervalDays * 100) / 100,
      days_since_last_purchase: daysSinceLastPurchase,
      explanation: sufficientHistory ? 'Mediana calculada somente com os intervalos entre compras válidas.' : 'Histórico insuficiente para estimar recorrência.',
    },
    products: [...products.values()].map((product) => { const copy = { ...product }; delete copy.sale_keys; return { ...copy, repeated: copy.purchase_count >= 2 }; }).sort((a, b) => b.quantity - a.quantity || b.purchase_count - a.purchase_count),
    history,
  };
}

/** Builds all customer facts in one pass over sales/activities/opportunities. */
/** @param {{companyId?: string, customers?: Customer[], sales?: Sale[], activities?: CrmActivity[], opportunities?: Opportunity[], now?: Date}} [options] */
export function buildCustomerRelationshipIndex({ companyId, customers = [], sales = [], activities = [], opportunities = [], now = new Date() } = {}) {
  const scopedCustomers = customers.filter((customer) => !companyId || customer?.company_id === companyId);
  const scopedSales = sales.filter((sale) => !companyId || sale?.company_id === companyId).filter(validSale);
  const salesByCustomer = new Map(); const activitiesByCustomer = new Map(); const opportunitiesByCustomer = new Map();
  scopedSales.forEach((sale) => { if (sale.customer_id) salesByCustomer.set(sale.customer_id, [...(salesByCustomer.get(sale.customer_id) || []), sale]); });
  activities.filter((activity) => !companyId || activity?.company_id === companyId).forEach((activity) => { if (activity.customer_id) activitiesByCustomer.set(activity.customer_id, [...(activitiesByCustomer.get(activity.customer_id) || []), activity]); });
  opportunities.filter((opportunity) => !companyId || opportunity?.company_id === companyId).forEach((opportunity) => { const id = opportunity.customer_id || (opportunity.metadata?.entity_type === 'customer' ? opportunity.metadata?.entity_id : null); if (id) opportunitiesByCustomer.set(id, [...(opportunitiesByCustomer.get(id) || []), opportunity]); });
  return new Map(scopedCustomers.map((customer) => [customer.id, buildCustomerRelationshipFacts({ customer, sales: salesByCustomer.get(customer.id) || [], activities: activitiesByCustomer.get(customer.id) || [], opportunities: opportunitiesByCustomer.get(customer.id) || [], now })]));
}

export const customerRelationshipHelpers = { dateOnly, dateMs, saleDate, validSale };
