import { createPeriodContext, matchesPeriod } from './metrics.js';

/** @typedef {import('../types/f7Domain').Product} Product */
/** @typedef {import('../types/f7Domain').Sale} Sale */
/** @typedef {import('../types/f7Domain').Purchase} Purchase */
/** @typedef {import('../types/f7Domain').PurchaseItem} PurchaseItem */
/** @typedef {import('../types/f7Domain').Supplier} Supplier */

const OPEN_PURCHASE_STATUSES = new Set(['pending', 'approved', 'sent', 'ordered', 'confirmed', 'in_transit']);
const PARTIAL_PURCHASE_STATUSES = new Set(['partial']);
const CANCELLED_SALE_STATUSES = new Set(['cancelled', 'canceled']);
const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const dateValue = (row) => row?.sale_date || row?.created_at || row?.created_date || null;
const purchaseDate = (row) => row?.created_at || row?.created_date || row?.expected_date || null;
const itemQuantity = (item) => finite(item?.quantity ?? item?.qty, 0);
const itemCost = (item) => {
  const value = Number(item?.cost ?? item?.cost_price);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const normalizeText = (value) => String(value || '').trim().toLocaleLowerCase('pt-BR');

function scoped(rows, companyId) {
  return (rows || []).filter((row) => row?.company_id === companyId);
}

function indexProducts(products) {
  const byId = new Map();
  const byName = new Map();
  products.forEach((product) => {
    if (!product?.id) return;
    byId.set(product.id, product);
    const name = normalizeText(product.name);
    if (name && !byName.has(name)) byName.set(name, product);
  });
  return { byId, byName };
}

function resolveItemProduct(item, indexes) {
  return (item?.product_id && indexes.byId.get(item.product_id)) || indexes.byName.get(normalizeText(item?.name));
}

function purchaseItemsFor(purchase, normalizedRows, indexes) {
  if (normalizedRows.length) return normalizedRows;
  return (Array.isArray(purchase.items) ? purchase.items : []).map((item) => ({ ...item, purchase_id: purchase.id, product_id: item.product_id || resolveItemProduct(item, indexes)?.id }));
}

function demandFor(products, sales, period) {
  const groups = new Map();
  sales.filter((sale) => !CANCELLED_SALE_STATUSES.has(normalizeText(sale.status)) && matchesPeriod(dateValue(sale), period)).forEach((sale) => {
    (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
      const product = item.product_id ? products.byId.get(item.product_id) : products.byName.get(normalizeText(item.name));
      if (!product?.id) return;
      const current = groups.get(product.id) || { quantity: 0, sales_count: 0, buyers: new Set(), last_sale: null };
      current.quantity += itemQuantity(item);
      current.sales_count += 1;
      if (sale.customer_id) current.buyers.add(sale.customer_id);
      const date = dateValue(sale);
      if (date && (!current.last_sale || String(date) > String(current.last_sale))) current.last_sale = date;
      groups.set(product.id, current);
    });
  });
  return groups;
}

function priorityFor({ stock, minimum, minimumConfigured, demandQuantity }) {
  const zeroWithDemand = stock <= 0 && demandQuantity > 0;
  const belowWithDemand = minimumConfigured && stock < minimum && demandQuantity > 0;
  if (zeroWithDemand || belowWithDemand && demandQuantity >= 2) return { key: 'high', label: 'Alta', rank: 3 };
  if (minimumConfigured && stock < minimum && demandQuantity > 0) return { key: 'medium', label: 'Média', rank: 2 };
  if (stock <= 0 || minimumConfigured && stock < minimum) return { key: 'low', label: 'Baixa', rank: 1 };
  return { key: 'normal', label: 'Normal', rank: 0 };
}

function reasonFor({ stock, minimum, minimumConfigured, demandQuantity, demandDays, openQuantity, partialUnknown }) {
  if (stock <= 0 && demandQuantity > 0) return `Estoque atual: ${stock}. Foram vendidas ${demandQuantity} unidades nos últimos ${demandDays} dias.`;
  if (minimumConfigured && stock < minimum && demandQuantity > 0) return `Estoque atual: ${stock}. Estoque mínimo: ${minimum}. Foram vendidas ${demandQuantity} unidades no período.`;
  if (minimumConfigured && stock < minimum && demandQuantity === 0) return partialUnknown
    ? 'Estoque abaixo do mínimo, sem vendas recentes e há recebimento parcial sem saldo persistido.'
    : 'Estoque abaixo do mínimo, porém sem vendas recentes no período.';
  if (stock <= 0 && demandQuantity === 0) return 'Estoque zerado, porém sem demanda recente; não recomprar cegamente.';
  if (partialUnknown) return `Há compra parcialmente recebida, mas o saldo pendente não está persistido; estoque em análise (${openQuantity ?? 'indisponível'}).`;
  return 'Estoque dentro do mínimo configurado.';
}

/**
 * Deterministic, factual replenishment analysis. It only reads tenant-scoped
 * rows and never creates orders, changes stock or chooses a supplier.
 */
/** @param {{companyId?: string, products?: Product[], sales?: Sale[], purchases?: Purchase[], purchaseItems?: PurchaseItem[], suppliers?: Supplier[], demandDays?: number, now?: Date}} [options] */
export function analyzePurchaseNeeds({ companyId, products = [], sales = [], purchases = [], purchaseItems = [], suppliers = [], demandDays = 30, now = new Date() } = {}) {
  if (!companyId) throw new Error('company_id é obrigatório para analisar reposição.');
  const productRows = scoped(products, companyId).filter((product) => product.item_type !== 'service');
  const saleRows = scoped(sales, companyId);
  const purchaseRows = scoped(purchases, companyId);
  const supplierRows = scoped(suppliers, companyId);
  const indexes = indexProducts(productRows);
  const end = new Date(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, Number(demandDays) || 30) + 1);
  const period = createPeriodContext({ companyId, periodKey: 'custom', startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), now: end, timezone: 'UTC' });
  const demand = demandFor(indexes, saleRows, period);
  const supplierById = new Map(supplierRows.map((supplier) => [supplier.id, supplier]));
  const itemRowsByPurchase = new Map();
  scoped(purchaseItems, companyId).forEach((item) => {
    const list = itemRowsByPurchase.get(item.purchase_id) || [];
    list.push(item);
    itemRowsByPurchase.set(item.purchase_id, list);
  });
  const openByProduct = new Map();
  const purchaseHistory = new Map();
  let openPurchaseCount = 0;
  purchaseRows.forEach((purchase) => {
    const status = normalizeText(purchase.status);
    const isOpen = OPEN_PURCHASE_STATUSES.has(status) || PARTIAL_PURCHASE_STATUSES.has(status);
    if (isOpen) openPurchaseCount += 1;
    const items = purchaseItemsFor(purchase, itemRowsByPurchase.get(purchase.id) || [], indexes);
    items.forEach((item) => {
      const product = resolveItemProduct(item, indexes);
      if (!product?.id) return;
      const cost = itemCost(item);
      if (status === 'received') {
        const history = purchaseHistory.get(product.id) || [];
        history.push({ purchase_id: purchase.id, supplier_id: purchase.supplier_id || null, supplier: supplierById.get(purchase.supplier_id)?.name || null, quantity: itemQuantity(item), cost, date: purchaseDate(purchase), status });
        purchaseHistory.set(product.id, history);
      }
      if (!isOpen) return;
      const current = openByProduct.get(product.id) || { quantity: 0, count: 0, partial_unknown: false, purchases: [] };
      current.count += 1;
      current.purchases.push(purchase.id);
      if (PARTIAL_PURCHASE_STATUSES.has(status)) current.partial_unknown = true;
      else current.quantity += itemQuantity(item);
      openByProduct.set(product.id, current);
    });
  });
  const rows = productRows.map((product) => {
    const stock = finite(product.stock);
    const minimumRaw = product.min_stock ?? product.minimum_stock;
    const minimum = finite(minimumRaw);
    const minimumConfigured = Number.isFinite(Number(minimumRaw)) && minimum > 0;
    const productDemand = demand.get(product.id) || { quantity: 0, sales_count: 0, buyers: new Set(), last_sale: null };
    const open = openByProduct.get(product.id) || { quantity: 0, count: 0, partial_unknown: false, purchases: [] };
    const history = (purchaseHistory.get(product.id) || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const lastPurchase = history[0] || null;
    const projected = open.partial_unknown ? null : stock + open.quantity;
    const gap = minimumConfigured && projected !== null ? Math.max(0, minimum - projected) : null;
    const priority = priorityFor({ stock, minimum, minimumConfigured, demandQuantity: productDemand.quantity });
    const needsAttention = stock <= 0 || minimumConfigured && stock < minimum;
    return {
      product_id: product.id,
      name: product.name || 'Produto',
      sku: product.sku || null,
      stock,
      minimum_stock: minimumConfigured ? minimum : null,
      minimum_configured: minimumConfigured,
      demand_quantity: productDemand.quantity,
      demand_sales_count: productDemand.sales_count,
      demand_buyers: productDemand.buyers.size,
      demand_days: Math.max(1, Number(demandDays) || 30),
      last_sale: productDemand.last_sale,
      open_purchase_count: open.count,
      open_purchase_quantity: open.partial_unknown ? null : open.quantity,
      partial_receipt_unknown: open.partial_unknown,
      projected_stock: projected,
      suggested_quantity: productDemand.quantity > 0 && !open.partial_unknown ? gap : null,
      priority: priority.label,
      priority_key: priority.key,
      priority_rank: priority.rank,
      needs_attention: needsAttention,
      reason: reasonFor({ stock, minimum, minimumConfigured, demandQuantity: productDemand.quantity, demandDays, openQuantity: projected, partialUnknown: open.partial_unknown }),
      last_purchase: lastPurchase,
      suppliers: [...new Map(history.filter((entry) => entry.supplier_id).map((entry) => [entry.supplier_id, { id: entry.supplier_id, name: entry.supplier || 'Fornecedor' }])).values()],
    };
  }).filter((row) => row.needs_attention || row.partial_receipt_unknown)
    .sort((a, b) => b.priority_rank - a.priority_rank || b.demand_quantity - a.demand_quantity || a.name.localeCompare(b.name, 'pt-BR'));
  return { rows, open_purchase_count: openPurchaseCount, demand_period: period, partial_receipt_supported: false, source: 'products+sales+purchases+purchase_items+suppliers' };
}

export const PURCHASE_OPEN_STATUSES = Object.freeze([...OPEN_PURCHASE_STATUSES]);
