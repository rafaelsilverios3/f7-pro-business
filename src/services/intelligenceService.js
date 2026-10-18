import { productsRepository } from '@/data/repositories/productsRepository';
import { customersRepository } from '@/data/repositories/customersRepository';
import { financeRepository } from '@/data/repositories/financeRepository';
import { createRepository } from '@/data/repositoryFactory';
import { buildCrmIntelligence } from '@/lib/crmIntelligence';
import { invokeEdgeFunction } from '@/services/integrationsService';
import { createPeriodContext, matchesPeriod, metricMeta } from '@/lib/metrics';
const insightRepository = createRepository('IntelligenceInsight');
const salesRepository = createRepository('Sale');
export const intelligenceService = {
  async generate(companyId, period = 'month') {
    const periodContext = typeof period === 'string' ? createPeriodContext({ companyId, periodKey: period }) : period;
    if (!periodContext || periodContext.company_id !== companyId) throw new Error('Contexto de período inválido.');
    const [products, customers, financials, sales] = await Promise.all([productsRepository.list(companyId), customersRepository.list(companyId), financeRepository.list(companyId), salesRepository.list(companyId, '-sale_date')]);
    const periodSales = sales.filter((sale) => matchesPeriod(sale.sale_date || sale.created_at, periodContext));
    const insights = [];
    for (const product of products) if ((product.stock || 0) <= (product.min_stock ?? product.minimum_stock ?? 0)) insights.push({ company_id: companyId, type: 'stock_low', severity: 'critical', title: `Estoque baixo: ${product.name}`, description: 'Produto abaixo do estoque mínimo.', entity: 'Product', entity_id: product.id, period: periodContext, semantic_type: 'snapshot' });
    for (const signal of buildCrmIntelligence({ companyId, customers, sales: periodSales })) {
      const customer = customers.find((item) => item.id === signal.customer_id);
      insights.push({ company_id: companyId, type: signal.type, severity: signal.priority === 'high' ? 'warning' : 'info', title: signal.type === 'lead' ? `Lead para acompanhamento: ${customer?.name || 'Cliente'}` : signal.type === 'inactive_customer' ? `Cliente inativo: ${customer?.name || 'Cliente'}` : signal.type === 'recurrence' ? `Recorrência identificada: ${customer?.name || 'Cliente'}` : `Contexto de venda complementar: ${customer?.name || 'Cliente'}`, description: signal.reason, entity: 'Customer', entity_id: signal.customer_id, data: { ...signal, policy: 'human_review_required' }, period: periodContext, semantic_type: 'period_total' });
    }
    for (const entry of financials) if (entry.status !== 'paid' && entry.status !== 'cancelled' && entry.due_date < new Date().toISOString().slice(0, 10) && matchesPeriod(entry.due_date, periodContext)) insights.push({ company_id: companyId, type: 'financial_overdue', severity: 'critical', title: 'Conta vencida', description: entry.description || 'Há uma conta vencida.', entity: 'FinancialEntry', entity_id: entry.id, period: periodContext, semantic_type: 'period_total' });
    return Object.assign(insights, { meta: metricMeta('supabase.intelligence', periodContext, 'period_total') });
  },
  list: (companyId) => insightRepository.list(companyId, '-created_at'),
  create: (companyId, data) => insightRepository.create(data, companyId),
  query: (companyId, query, history = [], context = {}) => invokeEdgeFunction('intelligence-query', { company_id: companyId, query, history, context, request_id: crypto.randomUUID() }),
};
