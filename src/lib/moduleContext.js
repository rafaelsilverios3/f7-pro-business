/** Small, serializable context envelope shared by cross-module navigation. */
export function buildModuleContext({ item = {}, sourceModule = '', intent = '' } = {}) {
  const metadata = item.metadata || item.radar || {};
  const entityType = metadata.entity_type || null;
  return {
    source_module: sourceModule || null,
    opportunity_id: item.id || null,
    product_id: entityType === 'product' ? (metadata.entity_id || null) : null,
    customer_id: entityType === 'customer' ? (metadata.entity_id || null) : null,
    supplier_id: metadata.supplier_id || null,
    entity_type: entityType,
    entity_id: metadata.entity_id || null,
    intent: intent || null,
    evidence: metadata.evidence || {},
    return_path: '/opportunity-radar',
  };
}

export function contextSummary(context = {}) {
  return Object.fromEntries(Object.entries(context).filter(([key, value]) => value != null && (key !== 'evidence' || (value && typeof value === 'object'))));
}
