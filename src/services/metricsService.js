import { buildCrmFunnel, createPeriodContext, filterByPeriod, metricMeta, matchesPeriod, projectionForPeriod, safeMargin } from '@/lib/metrics';

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
  // Active customers are a current snapshot; creation remains period-scoped.
  const active = rows.filter((row) => row.status === 'active');
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
  return { expenses: sum(paidExpenses, 'amount'), receivable: sum(receivable, 'amount'), payable: sum(payable, 'amount'), projected_net: sum(receivable, 'amount') - sum(payable, 'amount'), rows: inPeriod, meta: metricMeta('supabase.financial_entries', context, 'flow+projection') };
}

export function getOpportunityMetrics(companyId, opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = scoped(opportunities, companyId).filter((row) => matchesPeriod(row.created_date || row.created_at, context));
  return { rows, open: rows.filter((row) => !['won', 'lost'].includes(row.stage)).length, pipeline: sum(rows.filter((row) => !['won', 'lost'].includes(row.stage)), 'value'), won: sum(rows.filter((row) => row.stage === 'won'), 'value'), meta: metricMeta('supabase.opportunities', context, 'period_total') };
}

export function getDashboardMetrics(companyId, data = {}, periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const sales = getSalesMetrics(companyId, data.sales || [], context);
  const customers = getCustomerMetrics(companyId, data.customers || [], context);
  const products = getProductMetrics(companyId, data.products || [], context);
  const finance = getFinanceMetrics(companyId, data.fin || [], context);
  const opportunities = getOpportunityMetrics(companyId, data.opportunities || [], context);
  const projection = projectionForPeriod(sales.revenue, context);
  return { company_id: companyId, period: context, sales, customers, products, finance, opportunities, funnel: buildCrmFunnel({ companyId, customers: data.customers || [], opportunities: data.opportunities || [], sales: data.sales || [], periodContext: context }), projection, meta: metricMeta('metricsService', context, 'composite') };
}
