import { buildCrmFunnel, buildRevenueSeries, createPeriodContext, filterByPeriod, metricMeta, matchesPeriod, previousPeriodContext, projectionForPeriod, safeMargin, compareMetric } from '../lib/metrics.js';

const scoped = (rows, companyId) => rows.filter((row) => row?.company_id === companyId);
const validSales = (rows) => rows.filter((row) => row?.status !== 'cancelled');
const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
const openOpportunity = (row) => {
  const state = row?.stage || row?.status || row?.metadata?.radar_state;
  const closed = ['won', 'lost', 'descartada', 'descartado', 'converted', 'convertida_em_produto', 'resolvida', 'RESOLVIDA', 'DESCARTADA'].includes(state);
  const snoozed = row?.metadata?.snooze_until && new Date(row.metadata.snooze_until).getTime() > Date.now();
  return !closed && !snoozed;
};

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
  const openRows = rows.filter(openOpportunity);
  return { rows, open: openRows.length, pipeline: sum(openRows, 'value'), won: sum(rows.filter((row) => ['won', 'converted', 'convertida_em_produto'].includes(row.stage || row.status)), 'value'), meta: metricMeta('supabase.product_opportunities', context, 'snapshot') };
}

export function getSalesStatusMetrics(companyId, sales = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = scoped(sales, companyId).filter((row) => matchesPeriod(row.sale_date || row.created_at, context));
  const groups = new Map();
  rows.forEach((row) => {
    const status = String(row.status || 'unknown');
    const item = groups.get(status) || { status, count: 0, value: 0 };
    item.count += 1; item.value += Number(row.total) || 0; groups.set(status, item);
  });
  return { rows: [...groups.values()].sort((a, b) => b.count - a.count), meta: metricMeta('supabase.sales', context, 'period_distribution') };
}

export function getPaymentMethodMetrics(companyId, sales = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = validSales(scoped(sales, companyId)).filter((row) => matchesPeriod(row.sale_date || row.created_at, context));
  const groups = new Map();
  rows.forEach((row) => {
    const method = String(row.payment_method || '').trim();
    if (!method) return;
    const item = groups.get(method) || { method, count: 0, value: 0 };
    item.count += 1; item.value += Number(row.total) || 0; groups.set(method, item);
  });
  const result = [...groups.values()].sort((a, b) => b.value - a.value);
  const total = result.reduce((value, row) => value + row.value, 0);
  return { rows: result.map((row) => ({ ...row, percent: total > 0 ? row.value / total * 100 : 0 })), available: result.length > 0, meta: metricMeta('supabase.sales.payment_method', context, 'period_distribution') };
}

export function getCustomerCompositionMetrics(companyId, sales = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const rows = validSales(scoped(sales, companyId));
  const current = rows.filter((row) => matchesPeriod(row.sale_date || row.created_at, context));
  const firstPurchase = new Map();
  rows.forEach((row) => {
    if (!row.customer_id) return;
    const date = row.sale_date || row.created_at;
    if (!date) return;
    const previous = firstPurchase.get(row.customer_id);
    if (!previous || new Date(date).getTime() < new Date(previous).getTime()) firstPurchase.set(row.customer_id, date);
  });
  const ids = new Set(current.map((row) => row.customer_id).filter(Boolean));
  let novo = 0; let recorrente = 0;
  ids.forEach((id) => {
    const first = firstPurchase.get(id);
    if (first && matchesPeriod(first, context)) novo += 1;
    else if (first) recorrente += 1;
  });
  return { active: ids.size, novo, recorrente, available: ids.size > 0, meta: metricMeta('supabase.sales.customer_id', context, 'period_composition') };
}

export function getOpportunityOriginMetrics(companyId, opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const groups = new Map();
  scoped(opportunities, companyId).filter(openOpportunity).forEach((row) => {
    const origin = String(row.metadata?.entity_type || row.source || row.metadata?.signal_type || '').trim();
    if (!origin) return;
    const item = groups.get(origin) || { origin, count: 0 };
    item.count += 1; groups.set(origin, item);
  });
  return { rows: [...groups.values()].sort((a, b) => b.count - a.count), available: groups.size > 0, meta: metricMeta('supabase.product_opportunities', context, 'snapshot_distribution') };
}

export function getOpportunityPriorityMetrics(companyId, opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const labels = { high: 'Alta', alta: 'Alta', medium: 'Média', media: 'Média', médio: 'Média', low: 'Baixa', baixa: 'Baixa' };
  const groups = new Map();
  scoped(opportunities, companyId).filter(openOpportunity).forEach((row) => {
    const raw = String(row.metadata?.priority || row.confidence_level || '').trim().toLocaleLowerCase('pt-BR');
    const priority = labels[raw];
    if (!priority) return;
    groups.set(priority, (groups.get(priority) || 0) + 1);
  });
  const order = ['Alta', 'Média', 'Baixa'];
  return { rows: order.filter((priority) => groups.has(priority)).map((priority) => ({ priority, count: groups.get(priority) })), available: groups.size > 0, meta: metricMeta('supabase.product_opportunities.priority', context, 'snapshot_distribution') };
}

export function getStockHealthMetrics(companyId, products = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const groups = { normal: 0, baixo: 0, zerado: 0 };
  scoped(products, companyId).filter((row) => row.item_type !== 'service').forEach((row) => {
    const stock = Number(row.stock) || 0;
    const minimum = Number(row.min_stock ?? row.minimum_stock) || 0;
    if (stock <= 0) groups.zerado += 1;
    else if (stock <= minimum) groups.baixo += 1;
    else groups.normal += 1;
  });
  return { rows: Object.entries(groups).map(([health, count]) => ({ health, count })), meta: metricMeta('supabase.products', context, 'snapshot_distribution') };
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
  const charts = {
    revenue: buildRevenueSeries(data.sales || [], context),
    salesStatus: getSalesStatusMetrics(companyId, data.sales || [], context),
    payments: getPaymentMethodMetrics(companyId, data.sales || [], context),
    customers: getCustomerCompositionMetrics(companyId, data.sales || [], context),
    opportunitiesByOrigin: getOpportunityOriginMetrics(companyId, data.opportunities || [], context),
    opportunityPriority: getOpportunityPriorityMetrics(companyId, data.opportunities || [], context),
    stockHealth: getStockHealthMetrics(companyId, data.products || [], context),
  };
  return {
    company_id: companyId,
    period: context,
    previous_period: previousContext,
    sales,
    customers,
    products,
    finance: { ...finance, available: finance.available },
    opportunities,
    charts,
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
