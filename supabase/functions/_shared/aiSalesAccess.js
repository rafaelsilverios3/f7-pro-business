const ROLE_PERMISSIONS = Object.freeze({
  admin: ['*'],
  gestor: ['ai_sales.use', 'catalog.view', 'customers.view', 'sales.view', 'opportunity.view', 'supplier_intelligence.view', 'sales_channels.view', 'pricing.view', 'purchases.view', 'orders.create_from_conversation'],
  comercial: ['ai_sales.use', 'catalog.view', 'customers.view', 'sales.view', 'opportunity.view', 'supplier_intelligence.view', 'sales_channels.view', 'pricing.view', 'orders.create_from_conversation'],
  vendedor: ['ai_sales.use', 'catalog.view', 'customers.view', 'sales.view', 'opportunity.view', 'sales_channels.view', 'pricing.view', 'orders.create_from_conversation'],
  atendimento: ['ai_sales.use', 'customers.view', 'orders.create_from_conversation'],
  financeiro: [],
  estoque: [],
});

const TOOL_PERMISSIONS = Object.freeze({
  product: ['catalog.view'],
  stock: ['catalog.view'],
  price: ['catalog.view'],
  variations: ['catalog.view'],
  customer: ['customers.view'],
  customer_order: ['customers.view', 'sales.view'],
  draft: ['catalog.view', 'orders.create_from_conversation'],
  opportunities: ['opportunity.view'],
  supplier: ['supplier_intelligence.view'],
  supplier_external: ['supplier_intelligence.view'],
  channels: ['sales_channels.view'],
  supplier_offer_pricing: ['catalog.view', 'purchases.view', 'pricing.view'],
});

const safeString = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

export function permissionsForTool(intent) {
  return [...(TOOL_PERMISSIONS[intent] || [])];
}

export function roleHasAiSalesPermissions(role, permissions = ['ai_sales.use']) {
  const granted = ROLE_PERMISSIONS[role] || [];
  return granted.includes('*') || permissions.every((permission) => granted.includes(permission));
}

export function providerConfiguration({ enabled, apiKey, apiUrl }) {
  if (String(enabled ?? '').trim().toLowerCase() !== 'true') return { configured: false, reason: 'disabled' };
  if (!String(apiKey || '').trim()) return { configured: false, reason: 'missing_key' };
  const endpoint = String(apiUrl || 'https://api.openai.com/v1/chat/completions').trim();
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return { configured: false, reason: 'invalid_endpoint' };
  } catch {
    return { configured: false, reason: 'invalid_endpoint' };
  }
  return { configured: true, reason: 'configured_unverified' };
}

// Only the minimum facts needed to rephrase a result are sent to an LLM.
// Names, emails, phone numbers, document numbers, row IDs and source URLs are
// intentionally excluded from this provider-facing projection.
export function sanitizeAiSalesProviderData(tool, result) {
  if (tool === 'buscar_produto') return { products: list(result).slice(0, 20).map((row) => ({ name: safeString(row?.name), sku: safeString(row?.sku, 60) || null })) };
  if (tool === 'consultar_estoque') return { product: safeString(result?.name), own_stock_units: Number(result?.stock || 0), available: result?.available === true };
  if (tool === 'consultar_preco') return { product: safeString(result?.name), sale_price: Number(result?.price || 0), currency: 'BRL' };
  if (tool === 'listar_variacoes') return { variations: list(result).slice(0, 30).map((row) => ({ name: safeString(row?.name), own_stock_units: Number(row?.stock || 0), price: Number(row?.price || 0) })) };
  if (tool === 'buscar_cliente') {
    const rows = list(result);
    return { matching_customer_count: rows.length, aggregate_purchase_value: rows.reduce((total, row) => total + Number(row?.total_purchased || 0), 0), aggregate_sale_count: rows.reduce((total, row) => total + Number(row?.sale_count || 0), 0) };
  }
  if (tool === 'consultar_pedido') return result ? { status: safeString(result.status, 40), total: Number(result.total || 0), currency: 'BRL', sale_date: safeString(result.sale_date, 30) || null } : null;
  if (tool === 'buscar_oportunidades') {
    const rows = list(result);
    return { opportunity_count: rows.length, by_stage: rows.reduce((summary, row) => { const key = safeString(row?.stage || row?.status || 'sem etapa', 40); summary[key] = (summary[key] || 0) + 1; return summary; }, {}) };
  }
  if (tool === 'consultar_fornecedor') {
    const rows = list(result);
    return {
      supplier_profile_count: rows.length,
      trust_labels: rows.reduce((summary, row) => { const key = safeString(row?.trust_label || 'dados insuficientes', 50); summary[key] = (summary[key] || 0) + 1; return summary; }, {}),
      average_supplier_score: rows.length ? rows.reduce((sum, row) => sum + Number(row?.supplier_score || 0), 0) / rows.length : null,
      average_data_confidence: rows.length ? rows.reduce((sum, row) => sum + Number(row?.data_confidence || 0), 0) / rows.length : null,
    };
  }
  if (tool === 'consultar_canais') return { channels: list(result).slice(0, 20).map((row) => ({ type: safeString(row?.channel_type, 60), status: safeString(row?.status, 40), connected: row?.connected === true })) };
  if (tool === 'analisar_ofertas_fornecedor') {
    return {
      product: safeString(result?.product_name), currency: result?.currency || 'BRL',
      quantity_basis: result?.quantity_basis,
      eligible_offers: list(result?.offers).slice(0, 20).map((offer) => ({
        unit_cost: Number(offer?.unit_cost), minimum_order_quantity: Number(offer?.minimum_order_quantity),
        valid_until: offer?.valid_until || null, eligibility: safeString(offer?.eligibility, 100),
        quantity_simulated: Number(offer?.quantity), minimum_order_investment: offer?.minimum_order_investment ?? null,
        availability_status: safeString(offer?.availability_status, 40), declared_supplier_quantity: offer?.supplier_quantity ?? null,
        availability_observed_at: offer?.availability_observed_at || null, request_covered_by_declaration: offer?.request_covered_by_declaration === true,
        supplier_quantity_note: safeString(offer?.supplier_quantity_note, 180),
        order_investment: offer?.order_investment ?? null, lead_time_days: offer?.lead_time_days ?? null,
        channels: list(offer?.channels).slice(0, 10).map((channel) => ({ channel: safeString(channel?.name), configuration_status: safeString(channel?.status, 30), configured_fee_percent: channel?.fee_rate ?? null, fee_source: channel?.fee_source || null, fee_source_note: safeString(channel?.fee_source_note, 160), margin_estimate_percent: channel?.margin_estimate_percent ?? null, target_price_estimate: channel?.target_price_estimate ?? null, missing: list(channel?.missing) })),
        margin_estimate_percent: offer?.margin_estimate_percent ?? null,
        target_price_estimate: offer?.target_price_estimate ?? null,
        missing: list(offer?.missing), estimated: list(offer?.estimated), scenario_reasons: list(offer?.scenario_reasons),
      })),
      contextual_offers: list(result?.contextual_offers).slice(0, 20).map((offer) => ({
        currency: offer?.currency || null, status: safeString(offer?.status, 30),
        quantity_status: safeString(offer?.quantity_status, 40), requested_quantity: offer?.requested_quantity ?? null,
        declared_supplier_quantity: offer?.supplier_quantity ?? null, observed_at: offer?.observed_at || null,
        availability_age_days: offer?.availability_age_days ?? null, shortfall: offer?.shortfall ?? null,
        minimum_order_quantity: offer?.minimum_order_quantity ?? null,
        reasons: list(offer?.reasons).map((reason) => safeString(reason, 160)),
      })),
      limitation: 'Cálculo consultivo e parcial; não seleciona fornecedor, não confirma disponibilidade e não altera o catálogo.',
    };
  }
  if (tool === 'draft') return result ? { product: safeString(result.product?.name), quantity: Number(result.quantity || 0), total: Number(result.total || 0), currency: 'BRL', human_confirmation_required: true } : null;
  return null;
}
