import { matchesPeriod, previousPeriodContext } from './metrics.js';

/** @typedef {import('../types/f7Domain').Customer} Customer */
/** @typedef {import('../types/f7Domain').Sale} Sale */
/** @typedef {import('../types/f7Domain').Product} Product */
/** @typedef {import('../types/f7Domain').Opportunity} Opportunity */
/** @typedef {import('../types/f7Domain').PeriodContext} PeriodContext */
/** @typedef {Customer & { purchase_count: number, current_purchase_count: number, historical_revenue: number, current_revenue: number, previous_revenue: number, average_ticket: number, first_purchase: string | null, last_purchase: string | null, inactive_days: number | null, variation_percent: number | null, product_ids: string[], categories: string[], opportunity: boolean, is_active?: boolean, is_new?: boolean, is_recurring?: boolean, is_inactive?: boolean, is_falling?: boolean, is_high_value?: boolean }} MarketingProfile */

const DAY_MS = 86_400_000;
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateValue = (value) => { const parsed = value ? new Date(value).getTime() : NaN; return Number.isFinite(parsed) ? parsed : null; };
const dateOnly = (value) => { const parsed = dateValue(value); return parsed === null ? null : new Date(parsed).toISOString().slice(0, 10); };
const rowDate = (row) => row?.sale_date || row?.created_at || row?.created_date || null;
const text = (value, max = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const scoped = (rows = [], companyId) => rows.filter((row) => row?.company_id === companyId);
const validSales = (rows = []) => rows.filter((row) => row?.status !== 'cancelled');
const saleItems = (sale) => Array.isArray(sale?.items) ? sale.items : [];
const itemQuantity = (item) => safeNumber(item?.qty ?? item?.quantity);
const itemRevenue = (item) => Number.isFinite(Number(item?.total)) ? Number(item.total) : itemQuantity(item) * safeNumber(item?.price);

export const MARKETING_SEGMENTS = Object.freeze([
  { id: 'active', label: 'Clientes ativos', rule: 'Pelo menos uma compra válida no período selecionado.' },
  { id: 'new', label: 'Clientes novos', rule: 'Primeira compra dentro do período selecionado.' },
  { id: 'recurring', label: 'Clientes recorrentes', rule: 'Duas ou mais compras e histórico anterior ao período.' },
  { id: 'inactive', label: 'Clientes inativos', rule: 'Sem compra válida há pelo menos 90 dias, conforme a regra do CRM.' },
  { id: 'falling', label: 'Clientes em queda', rule: 'Receita caiu pelo menos 10% contra o período anterior, quando comparável.' },
  { id: 'high_value', label: 'Clientes de alto valor', rule: 'Clientes no quartil superior de faturamento histórico do próprio tenant.' },
  { id: 'opportunity', label: 'Com oportunidade aberta', rule: 'Cliente relacionado a oportunidade aberta existente no Radar.' },
  { id: 'bought_product', label: 'Compraram produto', rule: 'Parâmetro: produto comprado no histórico válido.' },
  { id: 'not_bought_product', label: 'Não compraram produto', rule: 'Parâmetro: clientes sem compra válida do produto.' },
]);

function openOpportunity(row) {
  const state = String(row?.metadata?.radar_state || row?.stage || row?.status || '').toLocaleLowerCase('pt-BR');
  return !['won', 'lost', 'descartada', 'descartado', 'converted', 'convertida_em_produto', 'resolvida', 'resolved', 'closed', 'encerrada', 'encerrado'].includes(state);
}

function productIdForItem(item, productsByName) {
  return item?.product_id || productsByName.get(text(item?.name, 180).toLocaleLowerCase('pt-BR'))?.id || null;
}

function asOf(periodContext, now, sales, customers) {
  if (periodContext?.end_date) {
    const today = new Date(now).toISOString().slice(0, 10);
    return periodContext.end_date < today ? `${periodContext.end_date}T23:59:59Z` : `${today}T23:59:59Z`;
  }
  const known = [...sales, ...customers].map(rowDate).map(dateValue).filter((value) => value !== null);
  return new Date(known.length ? Math.max(...known) : new Date(now).getTime()).toISOString();
}

/** @param {{companyId?: string, customers?: Customer[], sales?: Sale[], products?: Product[], opportunities?: Opportunity[], periodContext?: PeriodContext | null, now?: Date}} [options] */
export function buildMarketingModel({ companyId, customers = [], sales = [], products = [], opportunities = [], periodContext, now = new Date() } = {}) {
  if (!companyId) throw new Error('company_id é obrigatório para Marketing.');
  const customerRows = scoped(customers, companyId);
  const saleRows = validSales(scoped(sales, companyId));
  const productRows = scoped(products, companyId);
  const opportunityRows = scoped(opportunities, companyId).filter(openOpportunity);
  const previous = previousPeriodContext(periodContext);
  const asOfDate = asOf(periodContext, now, saleRows, customerRows);
  const productByName = new Map(productRows.map((product) => [text(product.name, 180).toLocaleLowerCase('pt-BR'), product]));
  const salesByCustomer = new Map();
  saleRows.forEach((sale) => { if (!sale.customer_id) return; salesByCustomer.set(sale.customer_id, [...(salesByCustomer.get(sale.customer_id) || []), sale]); });
  const productBuyers = new Map();
  saleRows.forEach((sale) => saleItems(sale).forEach((item) => { const productId = productIdForItem(item, productByName); if (productId && sale.customer_id) productBuyers.set(productId, new Set([...(productBuyers.get(productId) || []), sale.customer_id])); }));
  const opportunityCustomerIds = new Set(opportunityRows.map((item) => item.metadata?.entity_type === 'customer' ? item.metadata?.entity_id : item.customer_id).filter(Boolean));
  /** @type {MarketingProfile[]} */
  const profiles = customerRows.map((customer) => {
    const history = (salesByCustomer.get(customer.id) || []).slice().sort((a, b) => (dateValue(rowDate(a)) || 0) - (dateValue(rowDate(b)) || 0));
    const currentSales = periodContext ? history.filter((sale) => matchesPeriod(rowDate(sale), periodContext)) : history;
    const previousSales = previous ? history.filter((sale) => matchesPeriod(rowDate(sale), previous)) : [];
    const firstPurchase = dateOnly(rowDate(history[0])); const lastPurchase = dateOnly(rowDate(history.at(-1)) || customer.last_purchase_date || customer.updated_date || customer.created_date);
    const currentRevenue = currentSales.reduce((sum, sale) => sum + safeNumber(sale.total), 0); const previousRevenue = previousSales.reduce((sum, sale) => sum + safeNumber(sale.total), 0); const historicalRevenue = history.reduce((sum, sale) => sum + safeNumber(sale.total), 0);
    const inactiveDays = lastPurchase ? Math.max(0, Math.floor((dateValue(asOfDate) - dateValue(`${lastPurchase}T12:00:00Z`)) / DAY_MS)) : null;
    const productsBought = new Set(); const categoriesBought = new Set();
    history.forEach((sale) => saleItems(sale).forEach((item) => { const product = productByName.get(text(item.name, 180).toLocaleLowerCase('pt-BR')) || productRows.find((candidate) => candidate.id === item.product_id); if (product) { productsBought.add(product.id); if (product.category) categoriesBought.add(product.category); } }));
    return { id: customer.id, name: customer.name || 'Cliente', status: customer.status || 'active', purchase_count: history.length, current_purchase_count: currentSales.length, historical_revenue: historicalRevenue, current_revenue: currentRevenue, previous_revenue: previousRevenue, average_ticket: history.length ? historicalRevenue / history.length : 0, first_purchase: firstPurchase, last_purchase: lastPurchase, inactive_days: inactiveDays, variation_percent: previousRevenue > 0 ? (currentRevenue - previousRevenue) / previousRevenue * 100 : null, product_ids: [...productsBought], categories: [...categoriesBought], opportunity: opportunityCustomerIds.has(customer.id) };
  });
  const valueRows = profiles.map((row) => row.historical_revenue).filter((value) => value > 0).sort((a, b) => a - b);
  const quartileIndex = valueRows.length ? Math.min(valueRows.length - 1, Math.floor((valueRows.length - 1) * 0.75)) : 0;
  const highValueThreshold = valueRows.length ? valueRows[quartileIndex] : 0;
  profiles.forEach((profile) => { profile.is_active = profile.current_purchase_count > 0; profile.is_new = Boolean(profile.first_purchase && periodContext && matchesPeriod(profile.first_purchase, periodContext)); profile.is_recurring = profile.purchase_count >= 2 && !profile.is_new; profile.is_inactive = profile.inactive_days === null || profile.inactive_days >= 90; profile.is_falling = previous && profile.previous_revenue > 0 && profile.current_revenue < profile.previous_revenue && profile.variation_percent <= -10; profile.is_high_value = highValueThreshold > 0 && profile.historical_revenue >= highValueThreshold; });
  const segmentRows = (segmentId, productId = '') => profiles.filter((profile) => segmentId === 'active' ? profile.is_active : segmentId === 'new' ? profile.is_new : segmentId === 'recurring' ? profile.is_recurring : segmentId === 'inactive' ? profile.is_inactive : segmentId === 'falling' ? profile.is_falling : segmentId === 'high_value' ? profile.is_high_value : segmentId === 'opportunity' ? profile.opportunity : segmentId === 'bought_product' ? Boolean(productId && profile.product_ids.includes(productId)) : segmentId === 'not_bought_product' ? Boolean(productId && !profile.product_ids.includes(productId)) : false);
  const segments = MARKETING_SEGMENTS.map((definition) => ({ ...definition, count: segmentRows(definition.id).length, rows: segmentRows(definition.id) }));
  const overview = { total_customers: profiles.length, active: segmentRows('active').length, inactive: segmentRows('inactive').length, new_customers: segmentRows('new').length, recurring: segmentRows('recurring').length, falling: segmentRows('falling').length, high_value: segmentRows('high_value').length, open_opportunities: opportunityRows.length, stagnant_products: productRows.filter((product) => product.item_type !== 'service' && safeNumber(product.stock) > 0 && !saleRows.some((sale) => periodContext && matchesPeriod(rowDate(sale), periodContext) && saleItems(sale).some((item) => productIdForItem(item, productByName) === product.id))).length };
  return { company_id: companyId, period: periodContext, profiles, products: productRows, opportunities: opportunityRows, segments, overview, high_value_threshold: highValueThreshold, segmentRows };
}

export function getMarketingSegment(model, segmentId = 'active', productId = '') {
  const definition = MARKETING_SEGMENTS.find((item) => item.id === segmentId) || MARKETING_SEGMENTS[0];
  const rows = model?.segmentRows ? model.segmentRows(segmentId, productId) : [];
  const revenue = rows.reduce((sum, row) => sum + row.historical_revenue, 0);
  return { ...definition, product_id: productId || null, rows, count: rows.length, historical_revenue: revenue, average_ticket: rows.length ? revenue / rows.length : 0 };
}

export function buildMarketingIntelligenceContext(model, segment, draft = {}) {
  const selectedProduct = draft.productId ? (model?.products || []).find((item) => item.id === draft.productId) : null;
  const topProducts = [...(selectedProduct ? [selectedProduct] : []), ...(model?.products || []).filter((item) => item.item_type !== 'service' && item.id !== selectedProduct?.id)].slice(0, 12).map((item) => ({ id: item.id, name: text(item.name, 100), category: text(item.category, 80), price: safeNumber(item.sale_price ?? item.price), stock: safeNumber(item.stock) }));
  const opportunities = (model?.opportunities || []).slice(0, 12).map((item) => ({ id: item.id, title: text(item.title, 120), signal_type: text(item.metadata?.signal_type || item.source_type || item.source, 60), summary: text(item.description || item.metadata?.suggested_action, 220) }));
  return { source_module: 'marketing', mode: 'internal', objective: text(draft.objective, 80), segment_summary: { id: text(segment?.id, 60), label: text(segment?.label, 100), count: safeNumber(segment?.count), historical_revenue: safeNumber(segment?.historical_revenue), average_ticket: safeNumber(segment?.average_ticket), rule: text(segment?.rule, 220) }, products: topProducts, sales_signals: { period_sales: safeNumber(model?.overview?.active), recurring_customers: safeNumber(model?.overview?.recurring), falling_customers: safeNumber(model?.overview?.falling), stagnant_products: safeNumber(model?.overview?.stagnant_products) }, customer_signals: { active: safeNumber(model?.overview?.active), inactive: safeNumber(model?.overview?.inactive), new_customers: safeNumber(model?.overview?.new_customers), high_value: safeNumber(model?.overview?.high_value) }, opportunities, period: model?.period || null, channel: text(draft.channel, 40) || 'manual' };
}

export function toCampaignDraft(result, draft, context) {
  const answer = text(result?.answer, 2400) || 'Não foi possível gerar conteúdo agora. Revise os dados do segmento e tente novamente.';
  const recommendations = Array.isArray(result?.recommendations) ? result.recommendations.map((item) => text(item, 400)).filter(Boolean).slice(0, 5) : [];
  const risks = Array.isArray(result?.risks) ? result.risks.map((item) => text(item, 400)).filter(Boolean).slice(0, 5) : [];
  const productNames = (context?.products || []).slice(0, 3).map((item) => item.name).filter(Boolean);
  const suffix = productNames.length ? ` Produtos considerados: ${productNames.join(', ')}.` : '';
  const mainMessage = `${answer}${suffix}`;
  return { campaign_name: text(draft.name, 120) || `Campanha ${text(draft.objective, 60) || 'assistida'}`, objective: text(draft.objective, 80), audience_summary: `${safeNumber(context?.segment_summary?.count)} cliente(s) no segmento ${text(context?.segment_summary?.label, 100) || 'selecionado'}.`, main_message: mainMessage, channel_versions: { whatsapp: mainMessage, email_subject: text(draft.name, 120) || 'Uma oportunidade para você', email_body: mainMessage, social_caption: mainMessage }, recommended_products: productNames, cta: text(draft.cta, 180), risks, evidence: recommendations, status: 'RASCUNHO', prepared_only: true };
}
