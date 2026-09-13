import { salesRepository } from '@/data/repositories/salesRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { customersRepository } from '@/data/repositories/customersRepository';
import { financeRepository } from '@/data/repositories/financeRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { purchasesRepository } from '@/data/repositories/purchasesRepository';
import { suppliersRepository } from '@/data/repositories/suppliersRepository';
import { opportunitiesService } from '@/services/opportunitiesService';
import { buildAbcRows, createPeriodContext, matchesPeriod, previousPeriodContext } from '@/lib/metrics';
import { getDashboardMetrics } from '@/services/metricsService';

export const REPORT_TABS = Object.freeze([
  { id: 'overview', label: 'Visão geral' }, { id: 'sales', label: 'Vendas' }, { id: 'profit', label: 'Lucro e margem' }, { id: 'customers', label: 'Clientes' }, { id: 'abc', label: 'Curva ABC' },
  { id: 'products', label: 'Produtos' }, { id: 'stock', label: 'Estoque' }, { id: 'movements', label: 'Movimentações' }, { id: 'purchases', label: 'Compras' }, { id: 'financial', label: 'Financeiro operacional' }, { id: 'sellers', label: 'Vendedores' },
]);

const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const rowDate = (row) => row?.sale_date || row?.created_at || row?.created_date || null;
const validSales = (rows = []) => rows.filter((row) => row?.status !== 'cancelled');
const includesText = (value, query) => !query || String(value || '').toLocaleLowerCase('pt-BR').includes(String(query).toLocaleLowerCase('pt-BR'));
const itemText = (sale) => (Array.isArray(sale?.items) ? sale.items : []).map((item) => `${item?.name || ''} ${item?.product_name || ''} ${item?.sku || ''}`).join(' ');
const within = (row, periodContext, field = rowDate) => matchesPeriod(field(row), periodContext);
const scoped = (rows = [], companyId) => rows.filter((row) => row?.company_id === companyId);
const normalizeFilters = (filters = {}) => ({ search: String(filters.search || '').trim(), customerId: filters.customerId || '', seller: filters.seller || '', product: filters.product || '', status: filters.status || '', category: filters.category || '', stock: filters.stock || '', type: filters.type || '' });
const customerNameMap = (customers) => new Map(customers.map((row) => [row.id, row.name || 'Cliente']));
const productNameMap = (products) => new Map(products.map((row) => [row.id, row.name || 'Produto']));

function matchesSale(sale, filters) {
  return (!filters.customerId || sale.customer_id === filters.customerId) && (!filters.seller || (sale.seller || 'Sem vendedor') === filters.seller) && (!filters.status || sale.status === filters.status) && (!filters.product || includesText(itemText(sale), filters.product)) && (!filters.search || includesText(`${sale.id} ${sale.customer_name} ${sale.seller} ${sale.payment_method} ${itemText(sale)}`, filters.search));
}

function matchesCustomer(customer, filters, sales, periodContext) {
  if (!includesText(`${customer.name} ${customer.document}`, filters.search) || (filters.customerId && customer.id !== filters.customerId)) return false;
  if (!filters.status) return true;
  const customerSales = validSales(sales).filter((sale) => sale.customer_id === customer.id); const current = customerSales.filter((sale) => within(sale, periodContext)).length;
  if (filters.status === 'active') return current > 0;
  const first = customerSales.map(rowDate).filter(Boolean).sort()[0];
  if (filters.status === 'new') return Boolean(first && matchesPeriod(first, periodContext));
  if (filters.status === 'recurring') return current > 0 && Boolean(first && !matchesPeriod(first, periodContext));
  if (filters.status === 'inactive') { const last = customerSales.map(rowDate).filter(Boolean).sort().at(-1); const end = periodContext?.end_date || new Date().toISOString().slice(0, 10); return !last || Math.floor((new Date(`${end}T12:00:00Z`) - new Date(`${last.slice(0, 10)}T12:00:00Z`)) / 86_400_000) >= 90; }
  return customer.status === filters.status;
}

export function stockStatus(product) { const stock = safeNumber(product.stock); const minimum = safeNumber(product.min_stock ?? product.minimum_stock); return stock <= 0 ? 'zerado' : stock <= minimum ? 'baixo' : 'normal'; }

function salesRows(companyId, data, periodContext, filters) {
  const customers = customerNameMap(scoped(data.customers, companyId));
  return scoped(data.sales, companyId).filter((row) => within(row, periodContext)).filter((row) => matchesSale(row, filters)).map((sale) => ({ date: sale.sale_date || sale.created_at, id: sale.id, customer: sale.customer_name || customers.get(sale.customer_id) || 'Sem cliente', seller: sale.seller || 'Sem vendedor', status: sale.status || 'unknown', payment: sale.payment_method || 'Não informado', value: safeNumber(sale.total), profit: safeNumber(sale.profit) }));
}

function buildRows(companyId, data, periodContext, report, filters) {
  const sales = salesRows(companyId, data, periodContext, filters);
  if (report === 'sales') return { headers: ['Data', 'Venda', 'Cliente', 'Vendedor', 'Status', 'Pagamento', 'Valor', 'Lucro'], rows: sales.map((row) => [row.date, row.id, row.customer, row.seller, row.status, row.payment, row.value, row.profit]) };
  if (report === 'profit') return { headers: ['Data', 'Venda', 'Cliente', 'Faturamento', 'Custo', 'Lucro', 'Margem'], rows: sales.filter((row) => !row.cancelled).map((row) => [row.date, row.id, row.customer, row.value, row.value - row.profit, row.profit, row.value > 0 ? row.profit / row.value * 100 : 0]) };
  if (report === 'abc') { const rows = buildAbcRows(scoped(data.sales, companyId).filter((sale) => within(sale, periodContext)), periodContext); return { headers: ['Produto', 'Faturamento', 'Participação', '% acumulado', 'Classe'], rows: rows.map((row) => [row.name, row.value, row.share, row.cumulative_share, row.classification]) }; }
  if (report === 'customers') {
    const allSales = scoped(data.sales, companyId); const names = customerNameMap(scoped(data.customers, companyId));
    const rows = scoped(data.customers, companyId).filter((customer) => matchesCustomer(customer, filters, allSales, periodContext)).map((customer) => { const customerSales = validSales(allSales).filter((sale) => sale.customer_id === customer.id && within(sale, periodContext)); const revenue = customerSales.reduce((sum, sale) => sum + safeNumber(sale.total), 0); return [customer.name || names.get(customer.id) || 'Cliente', customerSales.length, revenue, customerSales.length ? revenue / customerSales.length : 0, customer.status || 'active']; });
    return { headers: ['Cliente', 'Compras', 'Faturamento', 'Ticket médio', 'Status'], rows: rows.sort((a, b) => b[2] - a[2]) };
  }
  if (report === 'products') {
    const products = scoped(data.products, companyId); const productMap = productNameMap(products); const groups = new Map();
    validSales(scoped(data.sales, companyId)).filter((sale) => within(sale, periodContext) && matchesSale(sale, filters)).forEach((sale) => (Array.isArray(sale.items) ? sale.items : []).forEach((item) => { const id = item.product_id || item.id || item.name; const current = groups.get(id) || { name: item.name || productMap.get(id) || 'Produto', quantity: 0, revenue: 0 }; current.quantity += safeNumber(item.qty ?? item.quantity); current.revenue += safeNumber(item.total) || safeNumber(item.price) * safeNumber(item.qty ?? item.quantity); groups.set(id, current); }));
    products.filter((product) => (!filters.category || product.category === filters.category) && (!filters.status || (product.active ? 'active' : 'inactive') === filters.status) && includesText(product.name, filters.search)).forEach((product) => { if (!groups.has(product.id)) groups.set(product.id, { name: product.name, quantity: 0, revenue: 0 }); });
    const total = [...groups.values()].reduce((sum, row) => sum + row.revenue, 0);
    return { headers: ['Produto', 'Quantidade', 'Faturamento', 'Participação', 'Estoque', 'Situação'], rows: [...groups.entries()].map(([id, row]) => { const product = products.find((item) => item.id === id); return [row.name, row.quantity, row.revenue, total ? row.revenue / total * 100 : 0, safeNumber(product?.stock), product ? stockStatus(product) : '—']; }).sort((a, b) => b[2] - a[2]) };
  }
  if (report === 'stock') {
    const products = scoped(data.products, companyId).filter((product) => includesText(product.name, filters.search) && (!filters.category || product.category === filters.category) && (!filters.stock || stockStatus(product) === filters.stock));
    const rows = products.map((product) => [product.name, safeNumber(product.stock), safeNumber(product.min_stock ?? product.minimum_stock), stockStatus(product), validSales(scoped(data.sales, companyId)).filter((sale) => within(sale, periodContext)).reduce((sum, sale) => sum + (sale.items || []).filter((item) => item.product_id === product.id).reduce((qty, item) => qty + safeNumber(item.qty ?? item.quantity), 0), 0)]);
    return { headers: ['Produto', 'Estoque atual', 'Mínimo', 'Situação', 'Vendas no período'], rows: rows.sort((a, b) => a[1] - b[1]) };
  }
  if (report === 'movements') {
    const products = productNameMap(scoped(data.products, companyId));
    const rows = scoped(data.movements, companyId)
      .filter((movement) => within(movement, periodContext, (row) => row.created_date || row.created_at))
      .filter((movement) => includesText(`${movement.product_name || products.get(movement.product_id) || ''} ${movement.type || ''} ${movement.reason || ''}`, filters.search))
      .map((movement) => [movement.created_date || movement.created_at, movement.product_name || products.get(movement.product_id) || 'Produto', movement.type || 'adjust', safeNumber(movement.quantity), movement.reason || '']);
    return { headers: ['Data', 'Produto', 'Tipo', 'Quantidade', 'Motivo'], rows };
  }
  if (report === 'purchases') {
    const rows = scoped(data.purchases, companyId).filter((purchase) => within(purchase, periodContext, (row) => row.created_date || row.created_at)).filter((purchase) => (!filters.status || purchase.status === filters.status) && includesText(`${purchase.supplier_name} ${purchase.id}`, filters.search)).map((purchase) => [purchase.created_date || purchase.created_at, purchase.id, purchase.supplier_name || 'Sem fornecedor', purchase.status || 'unknown', safeNumber(purchase.total), purchase.expected_date || '']);
    return { headers: ['Data', 'Compra', 'Fornecedor', 'Status', 'Valor', 'Previsão'], rows };
  }
  if (report === 'financial') {
    const rows = scoped(data.fin, companyId).filter((entry) => within(entry, periodContext, (row) => row.paid_date || row.due_date || row.created_at || row.created_date)).filter((entry) => (!filters.type || entry.type === filters.type) && (!filters.status || entry.status === filters.status) && includesText(`${entry.description} ${entry.category}`, filters.search)).map((entry) => [entry.type === 'receivable' ? 'A receber' : 'A pagar', entry.description || 'Lançamento financeiro', entry.status || 'unknown', entry.due_date || '', safeNumber(entry.amount ?? entry.total_amount), entry.category || '']);
    return { headers: ['Tipo', 'Descrição', 'Status', 'Vencimento', 'Valor', 'Categoria'], rows };
  }
  if (report === 'sellers') { const groups = new Map(); sales.filter((row) => !row.cancelled).forEach((row) => { const current = groups.get(row.seller) || { count: 0, revenue: 0, profit: 0 }; current.count += 1; current.revenue += row.value; current.profit += row.profit; groups.set(row.seller, current); }); return { headers: ['Vendedor', 'Vendas', 'Faturamento', 'Lucro'], rows: [...groups.entries()].map(([seller, values]) => [seller, values.count, values.revenue, values.profit]).sort((a, b) => b[2] - a[2]) }; }
  return { headers: [], rows: [] };
}

export function buildReportView(companyId, data, periodContext, report = 'overview', filters = {}) {
  const normalized = normalizeFilters(filters); const scopedData = { ...data, sales: scoped(data.sales, companyId), customers: scoped(data.customers, companyId), products: scoped(data.products, companyId), fin: scoped(data.fin, companyId), movements: scoped(data.movements, companyId), purchases: scoped(data.purchases, companyId), opportunities: scoped(data.opportunities || [], companyId) };
  const metrics = getDashboardMetrics(companyId, scopedData, periodContext); const rows = report === 'overview' ? { headers: [], rows: [] } : buildRows(companyId, scopedData, periodContext, report, normalized);
  return { report, filters: normalized, period: periodContext, metrics, rows, count: rows.rows.length, previous: previousPeriodContext(periodContext) ? metrics.comparisons : null, updated_at: new Date().toISOString() };
}

export function buildReportIntelligenceContext(view) {
  const metrics = view?.metrics || {}; const rows = view?.rows?.rows || [];
  return { source_module: 'reports', report: view?.report, period: view?.period, filters: Object.fromEntries(Object.entries(view?.filters || {}).filter(([key, value]) => key !== 'search' && value)), kpis: { revenue: metrics.sales?.revenue || 0, sales: metrics.sales?.count || 0, average_ticket: metrics.sales?.average_ticket || 0, margin: metrics.sales?.margin || 0, active_customers: metrics.customers?.active || 0, critical_stock: metrics.products?.critical || 0, open_opportunities: metrics.opportunities?.open || 0, projected_net: metrics.finance?.projected_net || 0 }, comparisons: metrics.comparisons || {}, rows_preview: rows.slice(0, 10).map((row) => row.slice(0, 6)), evidence_quality: 'high', research_mode: 'internal' };
}

export const reportsService = {
  async load(companyId, periodContext) {
    if (!companyId) throw new Error('company_id é obrigatório para relatórios.');
    const [sales, products, customers, financials, movements, purchases, suppliers, opportunities] = await Promise.all([
      salesRepository.list(companyId), productsRepository.list(companyId), customersRepository.list(companyId), financeRepository.list(companyId), inventoryRepository.list(companyId), purchasesRepository.list(companyId), suppliersRepository.list(companyId), opportunitiesService.list(companyId),
    ]);
    return { company_id: companyId, period: periodContext || createPeriodContext({ companyId, periodKey: 'month' }), sales, products, customers, fin: financials, movements, purchases, suppliers, opportunities };
  },
};
