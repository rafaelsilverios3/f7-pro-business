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
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: customers, error: customerError } = await sb.from('customers').select('id,name,sale_count').eq('company_id', companyId).gte('sale_count', 2);
    if (customerError) throw customerError;
    const { data: sales, error: salesError } = await sb.from('sales').select('customer_id,sale_date').eq('company_id', companyId).lt('sale_date', cutoff).order('sale_date', { ascending: false });
    if (salesError) throw salesError;
    const lastSale = new Map<string, string>(); for (const sale of sales || []) if (sale.customer_id && !lastSale.has(sale.customer_id)) lastSale.set(sale.customer_id, sale.sale_date);
    for (const customer of customers || []) if (lastSale.has(customer.id)) signals.push({ radar_key: `customer:client_inactive:${customer.id}`, title: `Cliente inativo: ${customer.name}`, description: `Nenhuma compra registrada nos últimos 90 dias.`, entity_type: 'customer', entity_id: customer.id, signal_type: 'CLIENT_INACTIVE', evidence: { last_sale_date: lastSale.get(customer.id), inactivity_days: 90 } });
  }
  let created = 0; let updated = 0;
  const { data: existing } = await sb.from('product_opportunities').select('id,metadata,status').eq('company_id', companyId);
  const byKey = new Map((existing || []).map((row: any) => [row.metadata?.radar_key, row]));
  for (const signal of signals) {
    const current = byKey.get(signal.radar_key); const metadata = { ...(current?.metadata || {}), radar_key: signal.radar_key, entity_type: signal.entity_type, entity_id: signal.entity_id, signal_type: signal.signal_type, evidence: signal.evidence, radar_state: current?.metadata?.radar_state || 'NOVA', last_seen_at: now.toISOString() };
    const payload = { title: signal.title, description: signal.description, status: current?.status || 'descoberta', source: 'internal_business_data', source_type: 'INTERNA', confidence_level: 'ALTA', opportunity_score: 70, supplier_score: 0, trust_score: 80, channel_score: 0, metadata, collected_at: now.toISOString() };
    if (current) { const { error } = await sb.from('product_opportunities').update(payload).eq('id', current.id).eq('company_id', companyId); if (!error) updated += 1; }
    else { const { error } = await sb.from('product_opportunities').insert({ ...payload, company_id: companyId }); if (!error) created += 1; }
  }
  return { signals_count: signals.length, opportunities_created: created, opportunities_updated: updated };
}
