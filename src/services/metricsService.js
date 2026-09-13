import { buildCrmFunnel, createPeriodContext, filterByPeriod, metricMeta, matchesPeriod, previousPeriodContext, projectionForPeriod, safeMargin, compareMetric } from '../lib/metrics.js';

const scoped = (rows, companyId) => rows.filter((row) => row?.company_id === companyId);
const validSales = (rows) => rows.filter((row) => row?.status !== 'cancelled');
const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);

export function requirePeriodContext(companyId, periodContext) {
  if (!companyId) throw new Error('company_id é obrigatório para métricas.');
  return periodContext?.company_id === companyId ? periodContext : createPeriodContext({ companyId, periodKey: periodContext?.period_key || 'month', timezone: periodContext?.timezone });
}

export function getSalesMetrics(companyId, sales = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = validSales(scoped(sales, companyId));
  const current = rows.filter((row) => matchesPeriod(row.sale_date || row.created_at, context));
  const revenue = sum(current, 'total');
  const profit = sum(current, 'profit');
  return { rows: current, count: current.length, revenue, profit, margin: safeMargin(profit, revenue), average_ticket: current.length ? revenue / current.length : 0, meta: metricMeta('supabase.sales', context, 'period_total') };
}

export function getCustomerMetrics(companyId, customers = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = scoped(customers, companyId);
  // A customer is active when they bought during the selected period. The
  // status/creation fallback keeps legacy records useful without inflating the
  // KPI with every customer ever registered.
  const active = rows.filter((row) => row.status === 'active' && matchesPeriod(row.created_date || row.created_at, context));
  const created = rows.filter((row) => matchesPeriod(row.created_date || row.created_at, context));
  return { total: rows.length, active: active.length, created: created.length, rows: created, meta: metricMeta('supabase.customers', context, 'period_total') };
}

export function getProductMetrics(companyId, products = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = scoped(products, companyId);
  return { rows, total: rows.length, critical: rows.filter((row) => (Number(row.stock) || 0) <= (Number(row.min_stock ?? row.minimum_stock) || 0)).length, meta: metricMeta('supabase.products', context, 'snapshot') };
}

export function getStockMetrics(companyId, products = [], movements = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const productRows = scoped(products, companyId);
  const movementRows = filterByPeriod(scoped(movements, companyId), 'created_date', context);
  return { stock_value: productRows.reduce((total, row) => total + (Number(row.stock) || 0) * (Number(row.cost_price) || 0), 0), movements: movementRows, critical: productRows.filter((row) => (Number(row.stock) || 0) <= (Number(row.min_stock ?? row.minimum_stock) || 0)).length, meta: metricMeta('supabase.products+stock_movements', context, 'snapshot+flow') };
}

export function getFinanceMetrics(companyId, entries = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = scoped(entries, companyId);
  const inPeriod = rows.filter((row) => matchesPeriod(row.paid_date || row.due_date || row.created_date, context));
  const paidExpenses = inPeriod.filter((row) => row.type === 'payable' && row.status === 'paid');
  const receivable = rows.filter((row) => row.type === 'receivable' && !['paid', 'cancelled', 'received'].includes(row.status));
  const payable = rows.filter((row) => row.type === 'payable' && !['paid', 'cancelled'].includes(row.status));
  return { expenses: sum(paidExpenses, 'amount'), receivable: sum(receivable, 'amount'), payable: sum(payable, 'amount'), projected_net: sum(receivable, 'amount') - sum(payable, 'amount'), rows: inPeriod, available: rows.length > 0, meta: metricMeta('supabase.financial_entries', context, 'flow+projection') };
}

export function getOpportunityMetrics(companyId, opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = scoped(opportunities, companyId);
  const isSnoozed = (row) => row?.metadata?.snooze_until && new Date(row.metadata.snooze_until).getTime() > Date.now();
  const isClosed = (row) => ['won', 'lost', 'descartada', 'descartado', 'converted', 'convertida_em_produto', 'resolvida', 'RESOLVIDA', 'DESCARTADA'].includes(row?.stage || row?.status || row?.metadata?.radar_state);
  const openRows = rows.filter((row) => !isClosed(row) && !isSnoozed(row));
  return { rows, open: openRows.length, pipeline: sum(openRows, 'value'), won: sum(rows.filter((row) => ['won', 'converted', 'convertida_em_produto'].includes(row.stage || row.status)), 'value'), meta: metricMeta('supabase.product_opportunities', context, 'snapshot') };
}

export function getDashboardMetrics(companyId, data = {}, periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const sales = getSalesMetrics(companyId, data.sales || [], context);
  const customersBase = getCustomerMetrics(companyId, data.customers || [], context);
  const salesCustomerIds = new Set(sales.rows.map((row) => row.customer_id).filter(Boolean));
  const customers = { ...customersBase, active: salesCustomerIds.size || customersBase.active };
  const products = getProductMetrics(companyId, data.products || [], context);
  const finance = getFinanceMetrics(companyId, data.fin || [], context);
  const opportunities = getOpportunityMetrics(companyId, data.opportunities || [], context);
  const previousContext = previousPeriodContext(context);
  const previousSales = previousContext ? getSalesMetrics(companyId, data.sales || [], previousContext) : null;
  const previousCustomersBase = previousContext ? getCustomerMetrics(companyId, data.customers || [], previousContext) : null;
  const previousCustomerIds = previousSales ? new Set(previousSales.rows.map((row) => row.customer_id).filter(Boolean)) : new Set();
  const previousCustomers = previousCustomersBase ? { ...previousCustomersBase, active: previousCustomerIds.size || previousCustomersBase.active } : null;
  const projection = projectionForPeriod(sales.revenue, context);
  return {
    company_id: companyId,
    period: context,
    previous_period: previousContext,
    sales,
    customers,
    products,
    finance: { ...finance, available: finance.available },
    opportunities,
    comparisons: {
      revenue: previousSales ? compareMetric(sales.revenue, previousSales.revenue) : null,
      sales: previousSales ? compareMetric(sales.count, previousSales.count) : null,
      ticket: previousSales ? compareMetric(sales.average_ticket, previousSales.average_ticket) : null,
      margin: previousSales ? compareMetric(sales.margin, previousSales.margin) : null,
      customers: previousCustomers ? compareMetric(customers.active, previousCustomers.active) : null,
    },
    funnel: buildCrmFunnel({ companyId, customers: data.customers || [], opportunities: data.opportunities || [], sales: data.sales || [], periodContext: context }),
    projection,
    meta: metricMeta('metricsService', context, 'composite'),
  };
}
