import { matchesPeriod, previousPeriodContext } from '@/lib/metrics';
import { activitySummary, deriveNextAction, isDueToday, isOverdue, isPending } from '@/lib/crmActivities';

const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateOf = (row) => row?.sale_date || row?.created_at || row?.created_date || null;
const dateTime = (value) => value ? new Date(value).getTime() : NaN;
const valid = (row) => row?.status !== 'cancelled';
const scoped = (rows = [], companyId) => rows.filter((row) => !companyId || row?.company_id === companyId);
const labelPriority = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (['urgent', 'alta', 'high', 'critical'].includes(normalized)) return 3;
  if (['medium', 'média', 'media'].includes(normalized)) return 2;
  if (['low', 'baixa'].includes(normalized)) return 1;
  return 0;
};

function customerSummary(customer, sales, opportunities, activities, periodContext, now = new Date()) {
  const customerSales = sales.filter((sale) => valid(sale) && sale.customer_id === customer.id);
  const periodSales = customerSales.filter((sale) => matchesPeriod(dateOf(sale), periodContext));
  const revenue = customerSales.reduce((sum, sale) => sum + safeNumber(sale.total), 0);
  const lastPurchase = customerSales.map(dateOf).filter(Boolean).sort().at(-1) || null;
  const inactiveDays = lastPurchase ? Math.max(0, Math.floor((new Date(now).getTime() - new Date(`${lastPurchase.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000)) : null;
  const products = new Map();
  customerSales.forEach((sale) => (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
    const key = item.product_id || item.id || item.name;
    if (!key) return;
    const current = products.get(key) || { id: item.product_id || item.id || null, name: item.name || item.product_name || 'Produto', quantity: 0 };
    current.quantity += safeNumber(item.qty ?? item.quantity);
    products.set(key, current);
  }));
  const related = opportunities.filter((item) => item.customer_id === customer.id || (item.metadata?.entity_type === 'customer' && item.metadata?.entity_id === customer.id));
  const customerActivities = activities.filter((activity) => activity.customer_id === customer.id);
  return {
    ...customer,
    purchases: customerSales.length,
    period_purchases: periodSales.length,
    revenue,
    average_ticket: customerSales.length ? revenue / customerSales.length : 0,
    last_purchase: lastPurchase,
    inactive_days: inactiveDays,
    products: [...products.values()].sort((a, b) => b.quantity - a.quantity),
    opportunities: related,
    activities: customerActivities,
    next_activity: deriveNextAction(customerActivities, now),
    status: customer.status || (periodSales.length ? 'active' : 'inactive'),
  };
}

function normalizeOpportunity(item, kind) {
  const metadata = item.metadata || {};
  const score = Number.isFinite(Number(item.opportunity_score)) ? Number(item.opportunity_score) : (Number.isFinite(Number(metadata.priority_score)) ? Number(metadata.priority_score) : null);
  const priority = item.priority || metadata.priority || item.confidence_level || metadata.confidence || null;
  return {
    ...item,
    kind,
    score,
    priority,
    priority_rank: labelPriority(priority),
    state: metadata.radar_state || item.stage || item.status || 'aberta',
    source_label: item.source || item.source_type || metadata.signal_type || (kind === 'radar' ? 'Opportunity Radar' : 'CRM'),
    next_action: metadata.suggested_action || item.next_action || null,
    evidence: metadata.evidence || item.evidence || null,
  };
}

function buildAttention({ customers, opportunities, sales, activities = [], notifications = [], periodContext, now }) {
  const items = [];
  const today = new Date(now).getTime();
  activities.filter(isPending).forEach((activity) => {
    if (isOverdue(activity, now)) items.push({ id: `overdue-activity-${activity.id}`, type: 'overdue_activity', priority: 3, title: activity.title, reason: `Atividade vencida em ${String(activity.due_at).slice(0, 16).replace('T', ' ')}.`, activity, next_action: 'Concluir, cancelar ou reagendar esta atividade.' });
    else if (isDueToday(activity, now)) items.push({ id: `due-activity-${activity.id}`, type: 'due_activity', priority: 2, title: activity.title, reason: 'Atividade prevista para hoje.', activity, next_action: 'Executar e registrar o resultado.' });
  });
  opportunities.filter((item) => !['descartada', 'DESCARTADA', 'RESOLVIDA', 'convertida_em_produto', 'converted'].includes(item.state)).forEach((item) => {
    const expected = item.expected_close_date || item.due_at || item.due_date;
    if (expected && dateTime(`${String(expected).slice(0, 10)}T23:59:59Z`) < today) items.push({ id: `overdue-${item.id}`, type: 'overdue_opportunity', priority: 3, title: item.title || 'Oportunidade vencida', reason: `Data prevista ${String(expected).slice(0, 10)} já passou.`, opportunity: item, next_action: item.next_action || 'Revisar a oportunidade e definir a próxima ação.' });
    if (item.priority_rank >= 3 || (item.score !== null && item.score >= 70)) items.push({ id: `priority-${item.id}`, type: 'priority_opportunity', priority: 3, title: item.title || 'Oportunidade prioritária', reason: item.priority ? `Prioridade registrada: ${item.priority}.` : `Score registrado: ${item.score}.`, opportunity: item, next_action: item.next_action || 'Analisar a oportunidade antes do próximo contato.' });
    const nextActivity = deriveNextAction(activities.filter((activity) => activity.opportunity_id === item.id), now);
    if (!item.next_action && !nextActivity && item.kind === 'crm') items.push({ id: `no-action-${item.id}`, type: 'no_next_action', priority: 2, title: item.title || 'Oportunidade sem próxima ação', reason: 'Nenhuma próxima ação persistida para esta oportunidade.', opportunity: item, next_action: 'Definir próxima ação manualmente.' });
  });
  const attentionIds = new Set(items.map((item) => item.id));
  notifications.filter((notification) => notification?.type === 'automation' && notification.read !== true).forEach((notification) => {
    if (notification.entity === 'crm_activity') {
      const activity = activities.find((item) => item.id === notification.entity_id && isPending(item));
      if (!activity || attentionIds.has(`overdue-activity-${activity.id}`) || attentionIds.has(`due-activity-${activity.id}`)) return;
      items.push({ id: `activity-${activity.id}`, type: 'automation_activity', priority: 2, title: notification.title || 'Lembrete de follow-up', reason: notification.message || 'Há um follow-up comercial que precisa de atenção.', activity, next_action: 'Abrir Minhas tarefas e revisar o follow-up.' });
      attentionIds.add(`activity-${activity.id}`);
    }
    if (notification.entity === 'opportunity') {
      const opportunity = opportunities.find((item) => item.id === notification.entity_id && item.kind === 'crm');
      const pending = opportunity && activities.some((activity) => activity.opportunity_id === opportunity.id && isPending(activity));
      if (!opportunity || pending || attentionIds.has(`no-action-${opportunity.id}`)) return;
      items.push({ id: `no-action-${opportunity.id}`, type: 'no_next_action', priority: 2, title: notification.title || opportunity.title || 'Oportunidade sem próxima ação', reason: notification.message || 'Nenhuma próxima ação persistida para esta oportunidade.', opportunity, next_action: 'Definir próxima ação manualmente.' });
      attentionIds.add(`no-action-${opportunity.id}`);
    }
  });
  customers.forEach((customer) => {
    if (customer.inactive_days === null || customer.inactive_days >= 90) items.push({ id: `inactive-${customer.id}`, type: 'inactive_customer', priority: 2, title: customer.name || 'Cliente sem nome', reason: customer.inactive_days === null ? 'Nenhuma compra registrada.' : `Cliente sem compra há ${customer.inactive_days} dias.`, customer, next_action: 'Revisar uma reativação antes de contatar.' });
    const current = sales.filter((sale) => valid(sale) && sale.customer_id === customer.id && matchesPeriod(dateOf(sale), periodContext)).reduce((sum, sale) => sum + safeNumber(sale.total), 0);
    const previous = previousPeriodContext(periodContext);
    const previousValue = previous ? sales.filter((sale) => valid(sale) && sale.customer_id === customer.id && matchesPeriod(dateOf(sale), previous)).reduce((sum, sale) => sum + safeNumber(sale.total), 0) : null;
    if (previousValue !== null && previousValue > 0 && current < previousValue * 0.9) items.push({ id: `falling-${customer.id}`, type: 'falling_customer', priority: 2, title: customer.name || 'Cliente em queda', reason: `Faturamento do período caiu ${Math.round((1 - current / previousValue) * 100)}% em relação ao período anterior.`, customer, next_action: 'Investigar o motivo da queda antes de criar comunicação.' });
  });
  const unique = new Map();
  items.sort((a, b) => b.priority - a.priority || String(a.title).localeCompare(String(b.title), 'pt-BR')).forEach((item) => unique.set(item.id, item));
  return [...unique.values()];
}

export function buildSalesHubModel({ companyId, customers = [], products = [], sales = [], opportunities = [], radarOpportunities = [], conversations = [], channels = [], metrics = [], activities = [], notifications = [], periodContext, now = new Date() } = {}) {
  const scopedCustomers = scoped(customers, companyId);
  const scopedSales = scoped(sales, companyId).filter(valid);
  const scopedActivities = scoped(activities, companyId);
  const combined = [...new Map([
    ...scoped(opportunities, companyId).map((item) => [item.id, normalizeOpportunity(item, 'crm')]),
    ...scoped(radarOpportunities, companyId).map((item) => [item.id, normalizeOpportunity(item, 'radar')]),
  ]).values()];
  const customerRows = scopedCustomers.map((customer) => customerSummary(customer, scopedSales, combined, scopedActivities, periodContext, now)).sort((a, b) => b.revenue - a.revenue);
  const periodSales = scopedSales.filter((sale) => matchesPeriod(dateOf(sale), periodContext));
  const openOpportunities = combined.filter((item) => !['descartada', 'DESCARTADA', 'RESOLVIDA', 'convertida_em_produto', 'converted'].includes(item.state));
  const pipeline = [...new Set(openOpportunities.filter((item) => item.kind === 'crm').map((item) => item.stage || 'new'))].map((stage) => {
    const rows = openOpportunities.filter((item) => item.kind === 'crm' && (item.stage || 'new') === stage);
    const valued = rows.filter((item) => Number.isFinite(Number(item.value)) && Number(item.value) > 0);
    return { stage, count: rows.length, value: valued.length ? valued.reduce((sum, item) => sum + Number(item.value), 0) : null };
  });
  const timeline = (customerId) => {
    const events = [];
    scopedSales.filter((sale) => sale.customer_id === customerId).forEach((sale) => events.push({ at: dateOf(sale), type: 'sale', label: 'Venda', description: `Venda ${sale.id} · ${safeNumber(sale.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, source: 'Vendas' }));
    combined.filter((item) => item.customer_id === customerId || (item.metadata?.entity_type === 'customer' && item.metadata?.entity_id === customerId)).forEach((item) => events.push({ at: dateOf(item), type: 'opportunity', label: 'Oportunidade', description: item.title || 'Oportunidade comercial', source: item.kind === 'radar' ? 'Opportunity Radar' : 'CRM', id: item.id }));
    conversations.filter((row) => row.customer_id === customerId).forEach((row) => events.push({ at: row.last_message_at || row.updated_at || row.created_at, type: 'conversation', label: 'Contato', description: row.subject || 'Conversa comercial', source: row.channel || 'Atendimento', id: row.id }));
    scopedActivities.filter((activity) => activity.customer_id === customerId).forEach((activity) => events.push({ at: activity.completed_at || activity.cancelled_at || activity.due_at || activity.created_at, type: 'activity', label: activity.status === 'CONCLUIDA' ? 'Atividade concluída' : activity.status === 'CANCELADA' ? 'Atividade cancelada' : 'Atividade', description: activity.title, source: 'CRM', id: activity.id, status: activity.status, assigned_to: activity.assigned_to }));
    return events.filter((event) => event.at).sort((a, b) => dateTime(b.at) - dateTime(a.at));
  };
  return {
    company_id: companyId,
    period: periodContext,
    overview: { open_opportunities: openOpportunities.length, priority_opportunities: combined.filter((item) => item.priority_rank >= 3 || (item.score !== null && item.score >= 70)).length, pending_attention: buildAttention({ customers: customerRows, opportunities: combined, sales: scopedSales, activities: scopedActivities, notifications, periodContext, now }).length, period_sales: periodSales.length, period_revenue: periodSales.reduce((sum, sale) => sum + safeNumber(sale.total), 0), customers: customerRows.length, activities: activitySummary(scopedActivities, now), automation_notifications: notifications.filter((item) => item?.type === 'automation' && item.read !== true).length },
    attention: buildAttention({ customers: customerRows, opportunities: combined, sales: scopedSales, activities: scopedActivities, notifications, periodContext, now }),
    pipeline,
    opportunities: openOpportunities.sort((a, b) => b.priority_rank - a.priority_rank || (b.score ?? -1) - (a.score ?? -1) || dateTime(dateOf(b)) - dateTime(dateOf(a))),
    customers: customerRows,
    products: scoped(products, companyId),
    sales: periodSales,
    channels: scoped(channels, companyId),
    metrics: scoped(metrics, companyId),
    conversations: scoped(conversations, companyId),
    activities: scopedActivities,
    notifications: notifications.filter((item) => item?.type === 'automation' && item.read !== true),
    timeline,
    limitations: { followups: 'Atividades e follow-ups são persistidos em crm_activities e continuam sob confirmação humana; nenhuma mensagem externa é enviada automaticamente.', probability: 'Probabilidade só é exibida quando há score/prioridade persistidos.', campaigns: 'Campanhas permanecem no Marketing e não possuem histórico persistente neste fluxo.' },
  };
}

export function buildSalesHubIntelligenceContext(model) {
  return {
    source_module: 'sales_hub', mode: 'internal', period: model?.period,
    customer_summary: (model?.customers || []).slice(0, 100).map((row) => ({ id: row.id, name: row.name, purchases: row.purchases, revenue: row.revenue, average_ticket: row.average_ticket, last_purchase: row.last_purchase, inactive_days: row.inactive_days })),
    opportunity_summary: (model?.opportunities || []).slice(0, 100).map((row) => ({ id: row.id, title: row.title, kind: row.kind, stage: row.stage, status: row.status, value: Number.isFinite(Number(row.value)) && Number(row.value) > 0 ? Number(row.value) : null, priority: row.priority, score: row.score, source: row.source_label, next_action: row.next_action })),
    sales_signals: model?.overview,
    radar_signals: (model?.opportunities || []).filter((row) => row.kind === 'radar').slice(0, 100).map((row) => ({ id: row.id, signal_type: row.metadata?.signal_type || row.source_type, summary: row.description, priority: row.priority, evidence: row.evidence })),
    next_actions: (model?.attention || []).slice(0, 50).map((row) => ({ type: row.type, title: row.title, reason: row.reason, next_action: row.next_action })),
    activities: { summary: model?.overview?.activities || activitySummary(model?.activities || []), pending: (model?.activities || []).filter(isPending).slice(0, 100).map((row) => ({ id: row.id, type: row.activity_type, status: row.status, due_at: row.due_at, customer_id: row.customer_id, opportunity_id: row.opportunity_id, assigned_to: row.assigned_to })) },
  };
}

export const salesHubHelpers = { safeNumber, dateOf, labelPriority };
