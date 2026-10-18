import { buildCrmFunnel, buildRevenueSeries, createPeriodContext, filterByPeriod, metricMeta, matchesPeriod, previousPeriodContext, projectionForPeriod, safeMargin, compareMetric } from '../lib/metrics.js';
import { isRevenueSale } from '../lib/saleStatus.js';

const scoped = (rows, companyId) => rows.filter((row) => row?.company_id === companyId);
const validSales = (rows) => rows.filter(isRevenueSale);
const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
const openOpportunity = (row) => {
  const state = String(row?.metadata?.radar_state || row?.stage || row?.status || '').trim().toLocaleLowerCase('pt-BR');
  const closed = ['won', 'lost', 'descartada', 'descartado', 'converted', 'convertida_em_produto', 'resolvida', 'resolved', 'closed', 'encerrada', 'encerrado'].includes(state);
  const snoozeUntil = row?.metadata?.snooze_until;
  const snoozed = snoozeUntil && Number.isFinite(new Date(snoozeUntil).getTime()) && new Date(snoozeUntil).getTime() > Date.now();
  return !closed && !snoozed;
};

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const rowDate = (row) => row?.sale_date || row?.created_at || row?.created_date || null;
const dateTime = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const dayMs = 86_400_000;
const dateOnlyValue = (value) => {
  const parsed = dateTime(value);
  return parsed === null ? null : new Date(parsed).toISOString().slice(0, 10);
};
const daysSince = (value, asOf) => {
  const from = dateTime(value); const to = dateTime(asOf);
  return from === null || to === null ? null : Math.max(0, Math.floor((to - from) / dayMs));
};
const itemQuantity = (item) => finiteNumber(item?.qty ?? item?.quantity, 0);
const itemRevenue = (item) => {
  const total = Number(item?.total);
  if (Number.isFinite(total)) return total;
  return itemQuantity(item) * finiteNumber(item?.price, 0);
};
const priorityRank = (row) => {
  const raw = String(row?.metadata?.priority || row?.confidence_level || '').trim().toLocaleLowerCase('pt-BR');
  if (['crítica', 'critica', 'critical', 'alta', 'high'].includes(raw)) return 3;
  if (['média', 'media', 'medium', 'normal'].includes(raw)) return 2;
  if (['baixa', 'low'].includes(raw)) return 1;
  return 0;
};
const priorityLabel = (row) => {
  const rank = priorityRank(row);
  return rank === 3 ? 'Alta' : rank === 2 ? 'Média' : rank === 1 ? 'Baixa' : 'Indisponível';
};
const opportunitySummary = (row) => ({
  id: row.id,
  title: row.title || 'Oportunidade aberta',
  origin: row.source || row.source_type || row.metadata?.source_type || 'INTERNA',
  priority: priorityLabel(row),
  score: Number.isFinite(Number(row.opportunity_score)) ? Number(row.opportunity_score) : null,
  summary: row.description || row.metadata?.suggested_action || row.metadata?.signal_type || 'Evidência disponível no Opportunity Radar.',
  customer_id: row.metadata?.entity_type === 'customer' ? row.metadata?.entity_id : row.customer_id || null,
  product_id: row.metadata?.entity_type === 'product' ? row.metadata?.entity_id : row.product_id || null,
  supplier_id: row.metadata?.entity_type === 'supplier' ? row.metadata?.entity_id : row.supplier_id || null,
  entity_type: row.metadata?.entity_type || null,
  date: row.updated_at || row.created_at || row.created_date || null,
  priority_rank: priorityRank(row),
});

function opportunityByEntity(companyId, opportunities = []) {
  const byEntity = new Map();
  scoped(opportunities, companyId).filter(openOpportunity).forEach((row) => {
    const type = row.metadata?.entity_type;
    const id = row.metadata?.entity_id || row.customer_id || row.product_id || row.supplier_id;
    if (!type || !id || byEntity.has(`${type}:${id}`)) return;
    byEntity.set(`${type}:${id}`, opportunitySummary(row));
  });
  return byEntity;
}

function asOfDate(periodContext, sales = [], customers = []) {
  const today = new Date().toISOString().slice(0, 10);
  if (periodContext?.end_date && periodContext.end_date < today) return `${periodContext.end_date}T23:59:59Z`;
  if (periodContext?.end_date && periodContext.end_date >= today) return `${today}T23:59:59Z`;
  const known = [...sales, ...customers].map(rowDate).map(dateTime).filter((value) => value !== null);
  return new Date(known.length ? Math.max(...known) : Date.now()).toISOString();
}

function periodWindow(periodContext, asOf) {
  if (periodContext?.period_key !== 'all' && periodContext?.start_date) return { start: periodContext.start_date, end: dateOnlyValue(asOf) || periodContext.end_date };
  const end = dateOnlyValue(asOf) || new Date().toISOString().slice(0, 10);
  const startDate = new Date(`${end}T12:00:00Z`); startDate.setUTCDate(startDate.getUTCDate() - 29);
  return { start: startDate.toISOString().slice(0, 10), end: end };
}

function salesByCustomer(companyId, sales = []) {
  const grouped = new Map();
  validSales(scoped(sales, companyId)).forEach((sale) => {
    if (!sale.customer_id) return;
    const list = grouped.get(sale.customer_id) || []; list.push(sale); grouped.set(sale.customer_id, list);
  });
  return grouped;
}

export function getTopCustomerMetrics(companyId, customers = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext);
  const names = new Map(scoped(customers, companyId).map((row) => [row.id, row.name || row.email || 'Cliente']));
  const opportunityMap = opportunityByEntity(companyId, opportunities);
  const groups = new Map();
  validSales(scoped(sales, companyId)).filter((row) => matchesPeriod(rowDate(row), context)).forEach((sale) => {
    if (!sale.customer_id) return;
    const item = groups.get(sale.customer_id) || { customer_id: sale.customer_id, revenue: 0, purchases: 0 };
    item.revenue += finiteNumber(sale.total); item.purchases += 1; groups.set(sale.customer_id, item);
  });
  const rows = [...groups.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((row) => ({
    ...row, name: names.get(row.customer_id) || 'Cliente', average_ticket: row.purchases ? row.revenue / row.purchases : 0,
    opportunity: opportunityMap.get(`customer:${row.customer_id}`) || null,
  }));
  return { rows, available: rows.length > 0, meta: metricMeta('supabase.sales+customers', context, 'period_ranking') };
}

export function getDecliningCustomerMetrics(companyId, customers = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const previous = previousPeriodContext(context);
  if (!previous) return { rows: [], available: false, meta: metricMeta('supabase.sales+customers', context, 'period_comparison') };
  const names = new Map(scoped(customers, companyId).map((row) => [row.id, row.name || row.email || 'Cliente']));
  const opportunityMap = opportunityByEntity(companyId, opportunities); const current = new Map(); const prior = new Map();
  validSales(scoped(sales, companyId)).forEach((sale) => {
    if (!sale.customer_id) return;
    const target = matchesPeriod(rowDate(sale), context) ? current : matchesPeriod(rowDate(sale), previous) ? prior : null;
    if (target) target.set(sale.customer_id, (target.get(sale.customer_id) || 0) + finiteNumber(sale.total));
  });
  const rows = [...prior.entries()].map(([customer_id, previous_revenue]) => {
    const current_revenue = current.get(customer_id) || 0; const delta = current_revenue - previous_revenue;
    const variation_percent = previous_revenue > 0 ? delta / previous_revenue * 100 : null;
    return { customer_id, name: names.get(customer_id) || 'Cliente', previous_revenue, current_revenue, delta, variation_percent, opportunity: opportunityMap.get(`customer:${customer_id}`) || null };
  }).filter((row) => row.previous_revenue > 0 && row.current_revenue < row.previous_revenue && Number.isFinite(row.variation_percent) && row.variation_percent <= -10 && Math.abs(row.delta) >= 1)
    .sort((a, b) => a.variation_percent - b.variation_percent).slice(0, 5);
  return { rows, available: rows.length > 0, meta: metricMeta('supabase.sales+customers', context, 'period_comparison') };
}

export function getInactiveCustomerMetrics(companyId, customers = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const asOf = asOfDate(context, sales, customers); const names = new Map(scoped(customers, companyId).map((row) => [row.id, row.name || row.email || 'Cliente']));
  const opportunityMap = opportunityByEntity(companyId, opportunities); const grouped = salesByCustomer(companyId, sales); const rows = [];
  scoped(customers, companyId).filter((customer) => customer.status !== 'lead').forEach((customer) => {
    const history = grouped.get(customer.id) || []; const latest = history.map((sale) => rowDate(sale)).filter(Boolean).sort().at(-1) || customer.last_purchase_date || customer.updated_date || customer.created_date;
    const inactive_days = daysSince(latest, asOf); if (inactive_days === null || inactive_days < 90) return;
    rows.push({ customer_id: customer.id, name: names.get(customer.id) || 'Cliente', last_purchase: history.length ? latest : null, last_activity: latest, inactive_days, opportunity: opportunityMap.get(`customer:${customer.id}`) || null });
  });
  rows.sort((a, b) => b.inactive_days - a.inactive_days);
  return { rows: rows.slice(0, 5), available: rows.length > 0, threshold_days: 90, meta: metricMeta('supabase.sales+customers', context, 'snapshot_inactivity') };
}

function productSales(companyId, sales = [], products = [], periodContext) {
  const productByName = new Map(scoped(products, companyId).map((row) => [String(row.name || '').trim().toLocaleLowerCase(), row])); const groups = new Map();
  validSales(scoped(sales, companyId)).filter((sale) => matchesPeriod(rowDate(sale), periodContext)).forEach((sale) => (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
    const linked = item.product_id ? null : productByName.get(String(item.name || '').trim().toLocaleLowerCase()); const product_id = item.product_id || linked?.id || null; const key = product_id || String(item.name || '').trim(); if (!key) return;
    const row = groups.get(key) || { product_id, name: item.name || linked?.name || 'Produto', quantity: 0, revenue: 0, sales_count: 0 };
    row.quantity += itemQuantity(item); row.revenue += itemRevenue(item); row.sales_count += 1; groups.set(key, row);
  }));
  return groups;
}

export function getTopProductMetrics(companyId, products = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const groups = productSales(companyId, sales, products, context); const total = [...groups.values()].reduce((sumValue, row) => sumValue + row.revenue, 0); const opportunityMap = opportunityByEntity(companyId, opportunities);
  const rows = [...groups.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((row) => ({ ...row, share: total > 0 ? row.revenue / total * 100 : 0, opportunity: row.product_id ? opportunityMap.get(`product:${row.product_id}`) || null : null }));
  return { rows, available: rows.length > 0, total_revenue: total, meta: metricMeta('supabase.sales+products', context, 'period_ranking') };
}

export function getNoTurnoverProductMetrics(companyId, products = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const asOf = asOfDate(context, sales, products); const window = periodWindow(context, asOf); const opportunityMap = opportunityByEntity(companyId, opportunities); const valid = validSales(scoped(sales, companyId)); const productByName = new Map(scoped(products, companyId).map((row) => [String(row.name || '').trim().toLocaleLowerCase(), row.id]));
  const productHistory = new Map(); valid.forEach((sale) => (Array.isArray(sale.items) ? sale.items : []).forEach((item) => { const id = item.product_id || productByName.get(String(item.name || '').trim().toLocaleLowerCase()); if (id) productHistory.set(id, [...(productHistory.get(id) || []), rowDate(sale)]); }));
  const rows = scoped(products, companyId).filter((product) => product.item_type !== 'service' && finiteNumber(product.stock) > 0).filter((product) => {
    const history = productHistory.get(product.id) || []; return !history.some((date) => { const day = dateOnlyValue(date); return day && day >= window.start && day <= window.end; });
  }).map((product) => ({ product_id: product.id, name: product.name || 'Produto', stock: finiteNumber(product.stock), last_sale: (productHistory.get(product.id) || []).filter(Boolean).sort().at(-1) || null, opportunity: opportunityMap.get(`product:${product.id}`) || null }));
  return { rows: rows.slice(0, 5), available: rows.length > 0, window_days: Math.max(1, Math.round((new Date(`${window.end}T12:00:00Z`).getTime() - new Date(`${window.start}T12:00:00Z`).getTime()) / dayMs) + 1), meta: metricMeta('supabase.sales+products', context, 'snapshot_no_turnover') };
}

export function getCriticalStockMetrics(companyId, products = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const opportunityMap = opportunityByEntity(companyId, opportunities); const currentQty = new Map(productSales(companyId, sales, products, context));
  const rows = scoped(products, companyId).filter((product) => product.item_type !== 'service').map((product) => { const stock = finiteNumber(product.stock); const minimum = finiteNumber(product.min_stock ?? product.minimum_stock); const recent_quantity = currentQty.get(product.id)?.quantity || 0; return { product_id: product.id, name: product.name || 'Produto', stock, minimum_stock: minimum, recent_quantity, status: stock <= 0 ? 'zerado' : stock <= minimum ? 'abaixo do mínimo' : 'normal', opportunity: opportunityMap.get(`product:${product.id}`) || null }; }).filter((row) => row.stock <= 0 || row.stock <= row.minimum_stock).sort((a, b) => (a.stock <= 0 ? 0 : 1) - (b.stock <= 0 ? 0 : 1) || b.recent_quantity - a.recent_quantity).slice(0, 5);
  return { rows, available: rows.length > 0, meta: metricMeta('supabase.products+sales', context, 'snapshot_critical_stock') };
}

export function getDemandLowStockMetrics(companyId, products = [], sales = [], opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const opportunityMap = opportunityByEntity(companyId, opportunities); const groups = productSales(companyId, sales, products, context);
  const rows = scoped(products, companyId).filter((product) => product.item_type !== 'service' && finiteNumber(product.stock) > 0 && finiteNumber(product.stock) <= finiteNumber(product.min_stock ?? product.minimum_stock)).map((product) => { const sold = groups.get(product.id); return sold ? { product_id: product.id, name: product.name || 'Produto', stock: finiteNumber(product.stock), minimum_stock: finiteNumber(product.min_stock ?? product.minimum_stock), recent_quantity: sold.quantity, revenue: sold.revenue, opportunity: opportunityMap.get(`product:${product.id}`) || null } : null; }).filter((row) => row && row.recent_quantity >= 2).sort((a, b) => b.recent_quantity - a.recent_quantity).slice(0, 5);
  return { rows, available: rows.length > 0, rule: 'estoque <= mínimo e pelo menos 2 unidades vendidas no período', meta: metricMeta('supabase.products+sales', context, 'period_demand_low_stock') };
}

export function getPriorityOpportunityMetrics(companyId, opportunities = [], periodContext) {
  const context = requirePeriodContext(companyId, periodContext); const rows = scoped(opportunities, companyId).filter(openOpportunity).map(opportunitySummary).sort((a, b) => b.priority_rank - a.priority_rank || (b.score ?? -1) - (a.score ?? -1) || (dateTime(b.date) ?? 0) - (dateTime(a.date) ?? 0)).slice(0, 5);
  return { rows, available: rows.length > 0, meta: metricMeta('supabase.product_opportunities', context, 'snapshot_priority') };
}

export function getActionableMetrics(companyId, data = {}, periodContext) {
  return {
    topCustomers: getTopCustomerMetrics(companyId, data.customers || [], data.sales || [], data.opportunities || [], periodContext),
    decliningCustomers: getDecliningCustomerMetrics(companyId, data.customers || [], data.sales || [], data.opportunities || [], periodContext),
    inactiveCustomers: getInactiveCustomerMetrics(companyId, data.customers || [], data.sales || [], data.opportunities || [], periodContext),
    topProducts: getTopProductMetrics(companyId, data.products || [], data.sales || [], data.opportunities || [], periodContext),
    noTurnoverProducts: getNoTurnoverProductMetrics(companyId, data.products || [], data.sales || [], data.opportunities || [], periodContext),
    criticalStock: getCriticalStockMetrics(companyId, data.products || [], data.sales || [], data.opportunities || [], periodContext),
    demandLowStock: getDemandLowStockMetrics(companyId, data.products || [], data.sales || [], data.opportunities || [], periodContext),
    priorityOpportunities: getPriorityOpportunityMetrics(companyId, data.opportunities || [], periodContext),
  };
}

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
  const labels = { completed: 'Concluídas', complete: 'Concluídas', paid: 'Pagas', cancelled: 'Canceladas', canceled: 'Canceladas', pending: 'Pendentes', draft: 'Rascunhos', refunded: 'Estornadas', failed: 'Falhas' };
  const groups = new Map();
  rows.forEach((row) => {
    const rawStatus = String(row.status || 'unknown').trim().toLocaleLowerCase('pt-BR');
    const status = labels[rawStatus] || (rawStatus === 'unknown' ? 'Sem status' : rawStatus);
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
  const actionable = getActionableMetrics(companyId, data, context);
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
    actionable,
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
