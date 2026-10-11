import { isRevenueSale } from './saleStatus.js';

const DAY_MS = 86_400_000;

const dateValue = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** @param {any} input */
export function buildCrmIntelligence(input = {}) {
  const { companyId, customers = [], sales = [], now = new Date() } = input;
  if (!companyId) throw new Error('company_id é obrigatório.');
  const nowMs = new Date(now).getTime();
  const validSales = sales.filter((sale) => sale?.company_id === companyId && isRevenueSale(sale));
  const salesByCustomer = new Map();
  for (const sale of validSales) {
    if (!sale.customer_id) continue;
    const rows = salesByCustomer.get(sale.customer_id) || [];
    rows.push(sale);
    salesByCustomer.set(sale.customer_id, rows);
  }
  return customers.filter((customer) => customer?.company_id === companyId).flatMap((customer) => {
    const customerSales = salesByCustomer.get(customer.id) || [];
    const lastSale = customerSales.reduce((latest, sale) => {
      const value = dateValue(sale.sale_date || sale.created_at);
      return value !== null && value > latest ? value : latest;
    }, dateValue(customer.last_purchase_date) || 0);
    const inactiveDays = lastSale ? Math.floor((nowMs - lastSale) / DAY_MS) : null;
    const signals = [];
    if (customer.status === 'lead') signals.push({ type: 'lead', priority: 'medium', customer_id: customer.id, reason: 'lead_without_conversion', recommended_action: 'HUMAN_FOLLOW_UP' });
    if (customer.status !== 'inactive' && inactiveDays !== null && inactiveDays >= 90) signals.push({ type: 'inactive_customer', priority: 'high', customer_id: customer.id, inactive_days: inactiveDays, reason: 'no_purchase_90_days', recommended_action: 'HUMAN_REACTIVATION_REVIEW' });
    if (customerSales.length >= 2) signals.push({ type: 'recurrence', priority: 'low', customer_id: customer.id, purchase_count: customerSales.length, reason: 'repeat_purchase_history', recommended_action: 'REVIEW_RECURRENT_NEEDS' });
    const latest = customerSales.slice().sort((a, b) => (dateValue(b.sale_date || b.created_at) || 0) - (dateValue(a.sale_date || a.created_at) || 0))[0];
    if (latest && Array.isArray(latest.items) && latest.items.length) signals.push({ type: 'upsell_context', priority: 'low', customer_id: customer.id, product_ids: latest.items.map((item) => item.product_id).filter(Boolean).slice(0, 10), reason: 'prior_purchase_context', recommended_action: 'REVIEW_COMPLEMENTARY_PRODUCTS' });
    return signals;
  });
}

export const CRM_INTELLIGENCE_POLICY = Object.freeze({ advisory_only: true, automatic_contact_allowed: false, automatic_sale_allowed: false, automatic_credit_approval_allowed: false, requires_human_approval: true });
