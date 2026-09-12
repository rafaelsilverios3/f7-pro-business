const DAY_MS = 86_400_000;

const dateMs = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const daysBetween = (from, to) => {
  const a = dateMs(from); const b = dateMs(to);
  return a === null || b === null ? null : Math.max(0, Math.floor((b - a) / DAY_MS));
};

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validSales = (companyId, sales) => (sales || []).filter((sale) => sale?.company_id === companyId && sale.status !== 'cancelled');
const saleDate = (sale) => sale?.sale_date || sale?.created_at || sale?.created_date;

/**
 * Detects actionable signals from real tenant data. This module is deliberately
 * deterministic: no LLM call is needed to decide whether a threshold was met.
 */
export function detectRadarSignals({ companyId, customers = [], products = [], sales = [], now = new Date() } = {}) {
  if (!companyId) throw new Error('company_id é obrigatório.');
  const currentMs = dateMs(now) || Date.now();
  const rows = validSales(companyId, sales);
  const salesByCustomer = new Map(); const salesByProduct = new Map();
  rows.forEach((sale) => {
    if (sale.customer_id) salesByCustomer.set(sale.customer_id, [...(salesByCustomer.get(sale.customer_id) || []), sale]);
    (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
      const productId = item.product_id || item.productId;
      if (!productId) return;
      const list = salesByProduct.get(productId) || [];
      list.push({ ...item, date: saleDate(sale) }); salesByProduct.set(productId, list);
    });
  });
  const signals = [];
  const add = (signal) => signals.push({ source_type: 'INTERNA', source: 'internal_business_data', ...signal });

  (customers || []).filter((customer) => customer?.company_id === companyId).forEach((customer) => {
    const history = (salesByCustomer.get(customer.id) || []).filter((sale) => dateMs(saleDate(sale)) !== null).sort((a, b) => dateMs(saleDate(a)) - dateMs(saleDate(b)));
    if (history.length < 2) return;
    const intervals = history.slice(1).map((sale, index) => daysBetween(saleDate(history[index]), saleDate(sale))).filter((item) => item !== null && item > 0);
    if (!intervals.length) return;
    const averageInterval = intervals.reduce((sum, item) => sum + item, 0) / intervals.length;
    const lastPurchase = saleDate(history[history.length - 1]);
    const daysSincePurchase = daysBetween(lastPurchase, new Date(currentMs).toISOString());
    const expectedWindow = Math.max(45, Math.ceil(Math.max(averageInterval * 1.75, averageInterval + 14)));
    if (daysSincePurchase !== null && daysSincePurchase >= expectedWindow) {
      const confidence = Math.min(100, 55 + history.length * 8 + (intervals.length >= 3 ? 15 : 0));
      add({
        radar_key: `customer:possible_repurchase:${customer.id}`,
        entity_type: 'customer', entity_id: customer.id, signal_type: 'possible_repurchase',
        title: `Possível recompra: ${customer.name || 'Cliente'}`,
        description: `${customer.name || 'Cliente'} realizou ${history.length} compras em intervalos médios de ${Math.round(averageInterval)} dias e está há ${daysSincePurchase} dias sem comprar.`,
        evidence: { purchase_count: history.length, average_interval_days: Math.round(averageInterval), days_since_purchase: daysSincePurchase, last_purchase_at: lastPurchase },
        suggested_action: 'Revisar histórico e preparar contato comercial.',
        confidence, impact: Math.min(100, 50 + history.length * 8), urgency: Math.min(100, 45 + Math.round(daysSincePurchase / expectedWindow) * 20), recurrence: Math.min(100, history.length * 20), freshness: Math.max(0, 100 - Math.round(daysSincePurchase / 3)),
      });
    }
  });

  (products || []).filter((product) => product?.company_id === companyId && product.active !== false).forEach((product) => {
    const productSales = salesByProduct.get(product.id) || [];
    const minimum = number(product.min_stock ?? product.minimum_stock, 0); const stock = number(product.stock, 0);
    if (minimum > 0 && stock <= minimum) {
      add({
        radar_key: `product:stock_below_min:${product.id}`,
        entity_type: 'product', entity_id: product.id, signal_type: stock <= 0 ? 'critical_stock' : 'stock_below_min',
        title: `${stock <= 0 ? 'Ruptura' : 'Estoque crítico'}: ${product.name || 'Produto'}`,
        description: `${product.name || 'Produto'} tem ${stock} ${product.unit || 'un'} em estoque (mínimo: ${minimum}).`,
        evidence: { stock, minimum_stock: minimum }, suggested_action: 'Ver produto, consultar fornecedores ou pesquisar novos fornecedores.',
        confidence: 95, impact: stock <= 0 ? 100 : 80, urgency: stock <= 0 ? 100 : 85, recurrence: 70, freshness: 100,
      });
    }
    const dated = productSales.filter((item) => dateMs(item.date) !== null);
    if (!dated.length) return;
    const cutoff = currentMs - 30 * DAY_MS; const previousCutoff = currentMs - 60 * DAY_MS;
    const currentQty = dated.filter((item) => dateMs(item.date) >= cutoff).reduce((sum, item) => sum + number(item.qty ?? item.quantity, 0), 0);
    const previousQty = dated.filter((item) => dateMs(item.date) >= previousCutoff && dateMs(item.date) < cutoff).reduce((sum, item) => sum + number(item.qty ?? item.quantity, 0), 0);
    if (previousQty >= 2 && currentQty === 0) {
      add({ radar_key: `product:stagnant:${product.id}`, entity_type: 'product', entity_id: product.id, signal_type: 'stagnant_product', title: `Produto sem giro: ${product.name || 'Produto'}`, description: `${product.name || 'Produto'} vendeu ${previousQty} unidades no período anterior e nenhuma nos últimos 30 dias.`, evidence: { previous_30d_qty: previousQty, current_30d_qty: currentQty }, suggested_action: 'Analisar preço, clientes da categoria e alternativas de campanha.', confidence: 88, impact: 65, urgency: 55, recurrence: 60, freshness: 100 });
    } else if (previousQty > 0 && currentQty >= previousQty * 1.3) {
      add({ radar_key: `product:growth:${product.id}`, entity_type: 'product', entity_id: product.id, signal_type: 'sales_growth', title: `Produto em alta: ${product.name || 'Produto'}`, description: `As vendas de ${product.name || 'Produto'} cresceram ${Math.round((currentQty / previousQty - 1) * 100)}% nos últimos 30 dias.`, evidence: { previous_30d_qty: previousQty, current_30d_qty: currentQty }, suggested_action: 'Garantir estoque e avaliar destaque no catálogo.', confidence: 85, impact: 60, urgency: 45, recurrence: 50, freshness: 100 });
    }
  });
  return signals;
}

export function scoreRadarSignal(signal = {}) {
  const parts = [number(signal.impact), number(signal.urgency), number(signal.confidence), number(signal.recurrence), number(signal.freshness)];
  const score = Math.round(parts.reduce((sum, item) => sum + Math.max(0, Math.min(100, item)), 0) / parts.length);
  const priority = score >= 85 ? 'CRÍTICA' : score >= 70 ? 'ALTA' : score >= 45 ? 'MÉDIA' : 'BAIXA';
  return { score, priority };
}

export function toRadarOpportunity(signal = {}, now = new Date()) {
  const scored = scoreRadarSignal(signal);
  return { title: signal.title, description: signal.description, status: 'descoberta', source: signal.source || 'internal_business_data', source_type: signal.source_type || 'INTERNA', confidence_level: scored.priority, collected_at: new Date(now).toISOString(), opportunity_score: scored.score, supplier_score: 0, trust_score: number(signal.confidence), channel_score: 0, metadata: { radar_key: signal.radar_key, entity_type: signal.entity_type, entity_id: signal.entity_id, signal_type: signal.signal_type, evidence: signal.evidence || {}, suggested_action: signal.suggested_action || '', priority: scored.priority, score_factors: { impact: number(signal.impact), urgency: number(signal.urgency), confidence: number(signal.confidence), recurrence: number(signal.recurrence), freshness: number(signal.freshness) }, source_type: signal.source_type || 'INTERNA', radar_state: 'NOVA', last_seen_at: new Date(now).toISOString() } };
}

export const RADAR_DETECTOR_POLICY = Object.freeze({ deterministic_first: true, advisory_only: true, automatic_sensitive_actions: false, requires_human_approval: true, scheduler: 'not_implemented' });
export const RADAR_EVENT_TYPES = Object.freeze(['RADAR_SCAN_STARTED', 'RADAR_SIGNAL_DETECTED', 'RADAR_OPPORTUNITY_CREATED', 'RADAR_OPPORTUNITY_UPDATED', 'RADAR_SCAN_COMPLETED']);
