/** Deterministic, server-side subset of the Opportunity Radar detectors.
 * It deliberately reads only the current tenant and never invokes an LLM.
 */
export async function runRadarDetector(sb: any, companyId: string, triggerType: string, now = new Date()) {
  const signals: any[] = [];
  if (triggerType === 'stock_below_min') {
    const { data, error } = await sb.from('products').select('id,name,stock,minimum_stock,active').eq('company_id', companyId).eq('active', true);
    if (error) throw error;
    for (const product of data || []) {
      const stock = Number(product.stock); const minimum = Number(product.minimum_stock);
      if (Number.isFinite(stock) && Number.isFinite(minimum) && minimum > 0 && stock <= minimum) signals.push({ radar_key: `product:stock_below_min:${product.id}`, title: `Estoque baixo: ${product.name}`, description: `O produto está com ${stock} unidade(s), abaixo do mínimo de ${minimum}.`, entity_type: 'product', entity_id: product.id, signal_type: 'STOCK_BELOW_MIN', evidence: { stock, minimum_stock: minimum } });
    }
  } else if (triggerType === 'client_inactive') {
    const { data: customers, error: customerError } = await sb.from('customers').select('id,name,sale_count').eq('company_id', companyId).gte('sale_count', 2);
    if (customerError) throw customerError;
    const { data: sales, error: salesError } = await sb.from('sales').select('customer_id,sale_date,created_at,status').eq('company_id', companyId).neq('status', 'cancelled').order('sale_date', { ascending: true });
    if (salesError) throw salesError;
    const byCustomer = new Map<string, any[]>(); for (const sale of sales || []) { const date = sale.sale_date || sale.created_at; if (!sale.customer_id || !date) continue; byCustomer.set(sale.customer_id, [...(byCustomer.get(sale.customer_id) || []), { ...sale, date }]); }
    const dayMs = 86_400_000;
    for (const customer of customers || []) {
      const history = (byCustomer.get(customer.id) || []).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)); if (history.length < 2) continue;
      const intervals = history.slice(1).map((sale, index) => Math.floor((Date.parse(sale.date) - Date.parse(history[index].date)) / dayMs)).filter((item) => item > 0); if (!intervals.length) continue;
      const average = intervals.reduce((sum, item) => sum + item, 0) / intervals.length; const lastSale = history[history.length - 1].date; const daysSince = Math.max(0, Math.floor((now.getTime() - Date.parse(lastSale)) / dayMs)); const expected = Math.max(45, Math.ceil(Math.max(average * 1.75, average + 14))); if (daysSince < expected) continue;
      signals.push({ radar_key: `customer:possible_repurchase:${customer.id}`, title: `Possível recompra: ${customer.name}`, description: `${customer.name} está há ${daysSince} dias sem comprar, acima do intervalo esperado.`, entity_type: 'customer', entity_id: customer.id, signal_type: 'POSSIBLE_REPURCHASE', evidence: { purchase_count: history.length, average_interval_days: Math.round(average), days_since_purchase: daysSince, expected_window_days: expected, last_purchase_at: lastSale } });
    }
  }
  let created = 0; let updated = 0;
  const { data: existing } = await sb.from('product_opportunities').select('id,metadata,status').eq('company_id', companyId);
  const byKey = new Map<string, any>((existing || []).map((row: any) => [String(row.metadata?.radar_key || ''), row]));
  for (const signal of signals) {
    const current = byKey.get(signal.radar_key); const metadata = { ...(current?.metadata || {}), radar_key: signal.radar_key, entity_type: signal.entity_type, entity_id: signal.entity_id, signal_type: signal.signal_type, evidence: signal.evidence, radar_state: current?.metadata?.radar_state || 'NOVA', last_seen_at: now.toISOString() };
    const payload = { title: signal.title, description: signal.description, status: current?.status || 'descoberta', source: 'internal_business_data', source_type: 'INTERNA', confidence_level: 'ALTA', opportunity_score: 70, supplier_score: 0, trust_score: 80, channel_score: 0, metadata, collected_at: now.toISOString() };
    if (current) { const { error } = await sb.from('product_opportunities').update(payload).eq('id', current.id).eq('company_id', companyId); if (!error) updated += 1; }
    else { const { error } = await sb.from('product_opportunities').insert({ ...payload, company_id: companyId }); if (!error) created += 1; }
  }
  const detectedKeys = new Set(signals.map((signal) => signal.radar_key));
  for (const row of existing || []) {
    const key = row.metadata?.radar_key; if (!key || detectedKeys.has(key) || !['product:stock_below_min:', 'customer:possible_repurchase:', 'product:stagnant:'].some((prefix) => key.startsWith(prefix)) || ['RESOLVIDA', 'DESCARTADA'].includes(row.metadata?.radar_state)) continue;
    const metadata = { ...(row.metadata || {}), radar_state: 'RESOLVIDA', resolved_at: now.toISOString() };
    const { error } = await sb.from('product_opportunities').update({ status: 'convertida_em_produto', metadata }).eq('id', row.id).eq('company_id', companyId); if (!error) updated += 1;
  }
  return { signals_count: signals.length, opportunities_created: created, opportunities_updated: updated };
}
