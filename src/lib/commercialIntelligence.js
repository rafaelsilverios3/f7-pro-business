const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
};

const normalizedSource = (source) => ({
  id: source?.id || null,
  type: String(source?.source_type || source?.type || 'company_internal').slice(0, 80),
  name: String(source?.source || source?.name || 'Dado interno da empresa').slice(0, 160),
  collected_at: source?.collected_at || source?.created_at || null,
  confidence: numberOrNull(source?.confidence),
});

/** @param {any} input */
export function buildCommercialIntelligenceReport(input = {}) {
  const { opportunity = {}, market = null, marketSignals = [], supplier = null, supplierSignals = [], channel = null } = input;
  const evidence = [
    ...marketSignals.map(normalizedSource),
    ...supplierSignals.map(normalizedSource),
  ];
  const confidenceValues = [
    numberOrNull(market?.trust_score),
    numberOrNull(supplier?.data_confidence),
    ...evidence.map((item) => item.confidence),
  ].filter((value) => value !== null);
  const dataConfidence = confidenceValues.length
    ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
    : 0;
  const riskSignals = supplierSignals.filter((signal) => signal?.needs_validation !== false).map((signal) => ({
    type: String(signal?.signal_type || 'supplier_signal').slice(0, 80),
    severity: String(signal?.severity || 'medium').slice(0, 20),
    needs_validation: true,
  }));
  const status = dataConfidence < 30 || evidence.length === 0 ? 'INSUFFICIENT_DATA'
    : riskSignals.some((signal) => signal.severity === 'high') ? 'HIGH_RISK'
      : dataConfidence >= 70 ? 'READY_FOR_HUMAN_REVIEW' : 'NEEDS_VALIDATION';

  return {
    company_id: opportunity?.company_id || market?.company_id || supplier?.company_id || null,
    subject: String(opportunity?.title || market?.product_name || '').slice(0, 200),
    scores: {
      opportunity: numberOrNull(opportunity?.opportunity_score ?? market?.opportunity_score),
      supplier: numberOrNull(supplier?.supplier_score ?? opportunity?.supplier_score),
      trust: numberOrNull(supplier?.trust_score ?? market?.trust_score ?? opportunity?.trust_score),
      channel: numberOrNull(channel?.score ?? opportunity?.channel_score),
      product_confidence: numberOrNull(opportunity?.product_confidence_score),
    },
    supplier: supplier ? { id: supplier.supplier_id || supplier.id || null, trust_label: supplier.trust_label || 'dados insuficientes', risk_signals: riskSignals } : null,
    market: market ? { trend: market.trend || null, demand: market.demand ?? null, competition: market.competition ?? null, data_status: market.data_status || 'indisponível' } : null,
    channel: channel ? { id: channel.id || null, name: channel.name || null, connected: channel.connected === true } : null,
    evidence,
    evidence_count: evidence.length,
    data_confidence: dataConfidence,
    status,
    recommended_actions: status === 'READY_FOR_HUMAN_REVIEW'
      ? ['ANALYZE', 'VALIDATE', 'TEST']
      : status === 'HIGH_RISK' ? ['VALIDATE_SUPPLIER', 'HANDOFF_HUMAN'] : ['COLLECT_EVIDENCE', 'HANDOFF_HUMAN'],
    policy: {
      advisory_only: true,
      automatic_purchase_allowed: false,
      automatic_publish_allowed: false,
      automatic_stock_change_allowed: false,
      requires_human_approval: true,
    },
  };
}
