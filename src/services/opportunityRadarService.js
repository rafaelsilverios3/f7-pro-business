import { createRepository } from '@/data/repositoryFactory';
import { classifyRadarRisk } from '@/lib/opportunityRadar';
import { buildCommercialIntelligenceReport } from '@/lib/commercialIntelligence';
import { detectRadarSignals, toRadarOpportunity, RADAR_EVENT_TYPES } from '@/lib/opportunityRadarDetectors';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

async function ensureRadarAllowed(companyId) {
  if (!companyId || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return;
  const { data, error } = await getSupabaseClient().rpc('company_has_feature', { target_company: companyId, feature: 'opportunity_radar' });
  if (error) throw error;
  if (!data) {
    const blocked = Object.assign(new Error('FEATURE_NOT_AVAILABLE'), { code: 'FEATURE_NOT_AVAILABLE' });
    throw blocked;
  }
}

const opportunities = createRepository('ProductOpportunity');
const market = createRepository('MarketOpportunity');
const signals = createRepository('MarketSignal');
const suppliers = createRepository('SupplierIntelligence');
const supplierRiskSignals = createRepository('SupplierRiskSignal');
const channels = createRepository('SalesChannel');
const products = createRepository('Product');
const customers = createRepository('Customer');
const sales = createRepository('Sale');
const notifications = createRepository('Notification');

const stateToStatus = { NOVA: 'descoberta', EM_ANALISE: 'em_analise', ACEITA: 'validada', ADIADA: 'descoberta', DESCARTADA: 'descartada', RESOLVIDA: 'convertida_em_produto' };

const enrich = (item, marketRows, signalRows, supplierRows, supplierRiskRows, channelRows) => {
  const marketRow = marketRows.find((row) => row.product_name?.toLocaleLowerCase() === item.title?.toLocaleLowerCase());
  const productSignals = signalRows.filter((row) => row.product_name?.toLocaleLowerCase() === item.title?.toLocaleLowerCase());
  const supplier = supplierRows.find((row) => row.supplier_id === item.supplier_id) || supplierRows[0];
  const relatedSupplierSignals = supplierRiskRows.filter((row) => row.supplier_id === supplier?.supplier_id);
  const channel = channelRows.find((row) => row.connected) || channelRows[0];
  const intelligence = buildCommercialIntelligenceReport({ opportunity: item, market: marketRow, marketSignals: productSignals, supplier, supplierSignals: relatedSupplierSignals, channel });
  const metadata = item.metadata || {};
  const snoozed = metadata.snooze_until && new Date(metadata.snooze_until).getTime() > Date.now();
  return { ...item, market: marketRow, supplier, channel, signals: productSignals, intelligence, risk: classifyRadarRisk({ trustScore: intelligence.scores.trust, confidence: intelligence.data_confidence, signalCount: intelligence.evidence_count }), analyzed_at: marketRow?.updated_at || item.updated_at || item.created_at, radar: { key: metadata.radar_key, entity_type: metadata.entity_type, entity_id: metadata.entity_id, signal_type: metadata.signal_type, evidence: metadata.evidence || {}, suggested_action: metadata.suggested_action, priority: metadata.priority || item.confidence_level || 'MÉDIA', state: metadata.radar_state || 'NOVA', snooze_until: metadata.snooze_until || null, snoozed } };
};

export const opportunityRadarService = {
  async list(companyId) {
    await ensureRadarAllowed(companyId);
    const [items, marketRows, signalRows, supplierRows, supplierRiskRows, channelRows] = await Promise.all([opportunities.list(companyId, '-created_date'), market.list(companyId, '-created_date'), signals.list(companyId, '-created_date'), suppliers.list(companyId, '-created_date'), supplierRiskSignals.list(companyId, '-created_date'), channels.list(companyId, 'name')]);
    return items.map((item) => enrich(item, marketRows, signalRows, supplierRows, supplierRiskRows, channelRows));
  },
  async scan(companyId, now = new Date()) {
    await ensureRadarAllowed(companyId);
    const [customerRows, productRows, saleRows, existing] = await Promise.all([customers.list(companyId, '-created_date'), products.list(companyId, '-created_date'), sales.list(companyId, '-sale_date'), opportunities.list(companyId, '-created_date')]);
    /** @type {Array<{type: string, at?: string, signal_type?: string, radar_key?: string, counts?: {signals: number, created: number, updated: number}}>} */
    const events = [{ type: RADAR_EVENT_TYPES[0], at: new Date(now).toISOString() }];
    const detected = detectRadarSignals({ companyId, customers: customerRows, products: productRows, sales: saleRows, now });
    const byKey = new Map(existing.map((item) => [item.metadata?.radar_key, item]));
    const result = { signals: detected, created: [], updated: [], skipped: [] };
    const detectedKeys = new Set(detected.map((signal) => signal.radar_key));
    for (const signal of detected) {
      events.push({ type: RADAR_EVENT_TYPES[1], signal_type: signal.signal_type, radar_key: signal.radar_key });
      const payload = toRadarOpportunity(signal, now); const current = byKey.get(signal.radar_key);
      if (current) {
        const metadata = { ...(current.metadata || {}), ...(payload.metadata || {}), radar_state: current.metadata?.radar_state || 'NOVA', last_seen_at: payload.metadata.last_seen_at };
        result.updated.push(await opportunities.update(current.id, { ...payload, status: current.status, metadata }, companyId)); events.push({ type: RADAR_EVENT_TYPES[3], radar_key: signal.radar_key });
      } else {
        result.created.push(await opportunities.create(payload, companyId)); events.push({ type: RADAR_EVENT_TYPES[2], radar_key: signal.radar_key });
      }
    }
    // A previously active detector signal is resolved when its condition is no longer true.
    for (const current of existing) {
      const key = current.metadata?.radar_key;
      if (!key || detectedKeys.has(key) || !['product:stock_below_min:', 'customer:possible_repurchase:', 'product:stagnant:'].some((prefix) => key.startsWith(prefix))) continue;
      if (['RESOLVIDA', 'DESCARTADA'].includes(current.metadata?.radar_state)) continue;
      const metadata = { ...(current.metadata || {}), radar_state: 'RESOLVIDA', resolved_at: new Date(now).toISOString() };
      result.updated.push(await opportunities.update(current.id, { status: 'convertida_em_produto', metadata }, companyId));
    }
    if (result.created.length > 0) await notifications.create({ type: 'radar', title: 'F7 encontrou algo que merece sua atenção', message: `${result.created.length} nova(s) oportunidade(s) foram registradas no Opportunity Radar.`, read: false }, companyId).catch(() => null);
    events.push({ type: RADAR_EVENT_TYPES[4], at: new Date().toISOString(), counts: { signals: detected.length, created: result.created.length, updated: result.updated.length } });
    return { ...result, total: detected.length, events };
  },
  async update(companyId, id, data = {}) {
    await ensureRadarAllowed(companyId);
    const current = await opportunities.get(id, companyId); const metadata = { ...(current.metadata || {}) };
    if (data.radar_state) metadata.radar_state = data.radar_state;
    if (data.snooze_until !== undefined) metadata.snooze_until = data.snooze_until;
    const status = data.status && stateToStatus[data.status] ? stateToStatus[data.status] : data.status;
    return opportunities.update(id, { ...data, ...(status ? { status } : {}), metadata }, companyId);
  },
  async snooze(companyId, id, until) { return this.update(companyId, id, { radar_state: 'ADIADA', snooze_until: until }); },
  async resolve(companyId, id) { return this.update(companyId, id, { radar_state: 'RESOLVIDA', status: 'RESOLVIDA' }); },
};

export { stateToStatus };
