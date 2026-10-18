import { invokeEdgeFunction } from '@/services/integrationsService';

const MAX_ITEMS = 3;
const MAX_SIGNALS = 12;
const SEVERITIES = new Set(['info', 'positive', 'attention', 'critical']);

const text = (value, max = 180) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const safeName = (value, fallback) => text(value, 100) || fallback;

function signal({ signal_type, title, description, severity = 'info', evidence_type, entity_type = null, entity_id = null, action, value = null }) {
  return { signal_type, title: text(title, 140), description: text(description, 280), severity: SEVERITIES.has(severity) ? severity : 'info', evidence_type: text(evidence_type, 80), entity_type: entity_type ? text(entity_type, 40) : null, entity_id: entity_id || null, action: text(action, 180), value: Number.isFinite(Number(value)) ? Number(value) : null };
}

export function buildExecutiveIntelligenceContext(companyId, metrics, periodContext) {
  const actionable = metrics?.actionable || {};
  const sales = metrics?.charts ? {
    revenue: number(metrics.faturamento), count: number(metrics.numVendas), average_ticket: number(metrics.ticketMedio), margin: number(metrics.margem),
  } : {};
  const customers = { total: number(metrics?.clientesTotal), active: number(metrics?.clientesAtivos), new: number(metrics?.novosClientes) };
  const products = { total: number(metrics?.charts?.stockHealth?.reduce?.((sum, row) => sum + number(row.count), 0)), critical: number(metrics?.estoqueCritico) };
  const finance = { available: Boolean(metrics?.financeAvailable), expenses: number(metrics?.despesas), receivable: number(metrics?.contasReceber), payable: number(metrics?.contasPagar), projected_net: number(metrics?.fluxoCaixa) };
  const opportunities = { open: number(metrics?.oportunidadesAbertas), priority: number(actionable.priorityOpportunities?.rows?.length), pipeline: number(metrics?.charts?.opportunitiesByOrigin?.rows?.reduce?.((sum, row) => sum + number(row.count), 0)) };
  const signals = [];
  const topCustomer = actionable.topCustomers?.rows?.[0];
  if (topCustomer) signals.push(signal({ signal_type: 'top_customer', title: `Cliente com maior compra: ${safeName(topCustomer.name, 'Cliente')}`, description: `${number(topCustomer.purchases)} compra(s) e ${number(topCustomer.revenue).toFixed(2)} de faturamento no período.`, severity: 'positive', evidence_type: 'period_customer_revenue', entity_type: 'customer', entity_id: topCustomer.customer_id, action: 'Acompanhar relacionamento comercial.' }));
  const decline = actionable.decliningCustomers?.rows?.[0];
  if (decline) signals.push(signal({ signal_type: 'customer_decline', title: `Queda de compra: ${safeName(decline.name, 'Cliente')}`, description: `Faturamento atual ${number(decline.current_revenue).toFixed(2)} versus ${number(decline.previous_revenue).toFixed(2)} no período anterior.`, severity: 'attention', evidence_type: 'period_customer_comparison', entity_type: 'customer', entity_id: decline.customer_id, action: 'Revisar o relacionamento e o próximo contato.' }));
  const inactive = actionable.inactiveCustomers?.rows?.[0];
  if (inactive) signals.push(signal({ signal_type: 'inactive_customer', title: `Cliente sem compra há ${number(inactive.inactive_days)} dias`, description: safeName(inactive.name, 'Cliente'), severity: 'attention', evidence_type: 'customer_inactivity_snapshot', entity_type: 'customer', entity_id: inactive.customer_id, action: 'Avaliar uma ação de recompra.' }));
  const topProduct = actionable.topProducts?.rows?.[0];
  if (topProduct) signals.push(signal({ signal_type: 'top_product', title: `Produto líder: ${safeName(topProduct.name, 'Produto')}`, description: `${number(topProduct.quantity)} unidade(s) e ${number(topProduct.revenue).toFixed(2)} no período.`, severity: 'positive', evidence_type: 'period_product_sales', entity_type: 'product', entity_id: topProduct.product_id, action: 'Acompanhar disponibilidade e margem do item.' }));
  const noTurnover = actionable.noTurnoverProducts?.rows?.[0];
  if (noTurnover) signals.push(signal({ signal_type: 'product_no_turnover', title: `Produto sem giro: ${safeName(noTurnover.name, 'Produto')}`, description: `Estoque atual ${number(noTurnover.stock)} e nenhuma venda na janela analisada.`, severity: 'attention', evidence_type: 'period_product_no_turnover', entity_type: 'product', entity_id: noTurnover.product_id, action: 'Revisar exposição, preço ou compra do item.' }));
  const criticalStock = actionable.criticalStock?.rows?.[0];
  if (criticalStock) signals.push(signal({ signal_type: 'critical_stock', title: `Estoque crítico: ${safeName(criticalStock.name, 'Produto')}`, description: `Atual ${number(criticalStock.stock)} e mínimo ${number(criticalStock.minimum_stock)}.`, severity: criticalStock.stock <= 0 ? 'critical' : 'attention', evidence_type: 'stock_snapshot', entity_type: 'product', entity_id: criticalStock.product_id, action: 'Verificar reposição antes de assumir compromisso.' }));
  const demandLow = actionable.demandLowStock?.rows?.[0];
  if (demandLow) signals.push(signal({ signal_type: 'demand_low_stock', title: `Demanda com estoque baixo: ${safeName(demandLow.name, 'Produto')}`, description: `${number(demandLow.recent_quantity)} unidade(s) vendida(s) com estoque ${number(demandLow.stock)}.`, severity: 'critical', evidence_type: 'period_sales_stock_snapshot', entity_type: 'product', entity_id: demandLow.product_id, action: 'Avaliar reposição baseada na demanda observada.' }));
  const priority = actionable.priorityOpportunities?.rows?.[0];
  if (priority) signals.push(signal({ signal_type: 'high_priority_opportunity', title: safeName(priority.title, 'Oportunidade prioritária'), description: safeName(priority.summary, 'Evidência disponível no Opportunity Radar.'), severity: priority.priority === 'Alta' ? 'critical' : 'attention', evidence_type: 'opportunity_radar_snapshot', entity_type: priority.entity_type, entity_id: priority.id, action: 'Abrir a oportunidade no Opportunity Radar.' }));
  if (finance.available && finance.projected_net < 0) signals.push(signal({ signal_type: 'commitments_negative', title: 'Compromissos líquidos negativos', description: `A receber ${finance.receivable.toFixed(2)} e a pagar ${finance.payable.toFixed(2)} no período.`, severity: 'attention', evidence_type: 'financial_entries_period_total', entity_type: null, action: 'Revisar recebimentos e pagamentos previstos.' }));

  return {
    company_id: companyId,
    period: { period_key: periodContext?.period_key || 'month', start_date: periodContext?.start_date || null, end_date: periodContext?.end_date || null, timezone: periodContext?.timezone || 'UTC' },
    sales, customers, products, stock: { critical: products.critical }, finance, opportunities,
    signals: signals.slice(0, MAX_SIGNALS),
    evidence_quality: signals.length ? 'high' : (sales.count || customers.total || products.critical || finance.available || opportunities.open ? 'medium' : 'low'),
  };
}

export function hasExecutiveEvidence(context) {
  return Boolean(context?.signals?.length || context?.sales?.count || context?.customers?.total || context?.products?.total || context?.products?.critical || context?.finance?.available || context?.opportunities?.open);
}

function items(context, types, max = MAX_ITEMS) { return (context?.signals || []).filter((item) => types.includes(item.signal_type)).slice(0, max); }

export function buildDeterministicExecutiveSummary(context) {
  if (!hasExecutiveEvidence(context)) return { headline: 'Ainda não há dados suficientes para um resumo executivo.', summary: 'O período selecionado não possui métricas ou sinais autorizados suficientes. Continue registrando a operação para que a F7 possa analisar este contexto.', positives: [], alerts: [], opportunities: [], recommended_actions: [], confidence: 'low', source: 'deterministic', fallback_used: true };
  const positives = items(context, ['top_customer', 'top_product']).map((item) => ({ ...item }));
  const alerts = items(context, ['critical_stock', 'demand_low_stock', 'customer_decline', 'inactive_customer', 'product_no_turnover', 'commitments_negative', 'high_priority_opportunity']).map((item) => ({ ...item }));
  const opportunities = items(context, ['high_priority_opportunity', 'top_customer', 'top_product']).map((item) => ({ ...item }));
  const recommended_actions = [...alerts, ...opportunities].slice(0, MAX_ITEMS).map((item) => ({ title: item.action, description: item.description, severity: item.severity, evidence_type: item.evidence_type, entity_type: item.entity_type, entity_id: item.entity_id, action: item.action }));
  const periodLabel = context.period?.period_key === 'all' ? 'no histórico' : `no período ${context.period?.period_key || 'selecionado'}`;
  return { headline: alerts.length ? `A operação tem ${alerts.length} ponto(s) que merece(m) atenção ${periodLabel}.` : `A operação apresenta sinais positivos ${periodLabel}.`, summary: `Foram encontrados ${number(context.sales?.count)} venda(s), ${number(context.customers?.active)} cliente(s) ativo(s) e ${number(context.opportunities?.open)} oportunidade(s) aberta(s). O resumo usa somente evidências métricas do tenant e não infere causas não observadas.`, positives: positives.slice(0, MAX_ITEMS), alerts: alerts.slice(0, MAX_ITEMS), opportunities: opportunities.slice(0, MAX_ITEMS), recommended_actions, confidence: context.evidence_quality === 'high' ? 'high' : 'medium', source: 'deterministic', fallback_used: true };
}

export function normalizeExecutiveSummary(value, context) {
  if (!value || typeof value !== 'object') return null;
  const normalizeItems = (list) => (Array.isArray(list) ? list : []).map((item) => ({ title: text(item?.title, 140), description: text(item?.description, 280), severity: SEVERITIES.has(item?.severity) ? item.severity : 'info', evidence_type: text(item?.evidence_type, 80), entity_type: item?.entity_type ? text(item.entity_type, 40) : null, entity_id: item?.entity_id || null, action: text(item?.action, 180) })).filter((item) => item.title && item.description && item.evidence_type).slice(0, MAX_ITEMS);
  const result = { headline: text(value.headline, 220), summary: text(value.summary, 600), positives: normalizeItems(value.positives), alerts: normalizeItems(value.alerts), opportunities: normalizeItems(value.opportunities), recommended_actions: normalizeItems(value.recommended_actions), confidence: ['high', 'medium', 'low'].includes(value.confidence) ? value.confidence : 'low', source: 'ai', fallback_used: false };
  return result.headline && result.summary ? result : null;
}

export async function generateExecutiveSummary(companyId, context) {
  const fallback = buildDeterministicExecutiveSummary(context);
  if (!hasExecutiveEvidence(context)) return { ...fallback, reason: 'NO_DATA' };
  try {
    const response = await invokeEdgeFunction('intelligence-query', { company_id: companyId, operation: 'executive_summary', executive_context: context, request_id: crypto.randomUUID() });
    const normalized = normalizeExecutiveSummary(response?.summary, context);
    return normalized ? { ...normalized, confidence: response.confidence || normalized.confidence, source: response.source || normalized.source, fallback_used: Boolean(response.fallback_used) } : fallback;
  } catch (error) {
    return { ...fallback, reason: error?.code || 'PROVIDER_UNAVAILABLE' };
  }
}

