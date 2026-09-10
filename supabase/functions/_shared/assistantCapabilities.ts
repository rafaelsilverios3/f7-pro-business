export type AssistantCapabilitySettings = {
  allow_web_research?: boolean;
  allow_product_lookup?: boolean;
  allow_price_lookup?: boolean;
  allow_stock_lookup?: boolean;
  allow_customer_lookup?: boolean;
  allow_quote_draft?: boolean;
  allow_official_sources?: boolean;
  allow_external_source_disclosure?: boolean;
};

export type AssistantCapability = 'web_research' | 'product_lookup' | 'price_lookup' | 'stock_lookup' | 'customer_lookup' | 'quote_draft' | 'official_sources';

export function capabilityEnabled(settings: AssistantCapabilitySettings, capability: AssistantCapability) {
  const key = `allow_${capability}` as keyof AssistantCapabilitySettings;
  if (capability === 'web_research' || capability === 'product_lookup' || capability === 'official_sources') return settings[key] !== false;
  return settings[key] === true;
}

export function filterProductForAssistant(product: Record<string, unknown>, settings: AssistantCapabilitySettings) {
  if (!capabilityEnabled(settings, 'product_lookup')) return null;
  const filtered: Record<string, unknown> = {
    id: product.id,
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    short_description: product.short_description,
  };
  if (capabilityEnabled(settings, 'price_lookup')) filtered.price = product.price;
  if (capabilityEnabled(settings, 'stock_lookup')) filtered.stock = product.stock;
  return filtered;
}

export function filterProductsForAssistant(products: unknown, settings: AssistantCapabilitySettings) {
  if (!Array.isArray(products)) return [];
  return products.map((item) => item && typeof item === 'object' ? filterProductForAssistant(item as Record<string, unknown>, settings) : null).filter(Boolean);
}

export function filterSourcesForCustomer(sources: unknown, settings: AssistantCapabilitySettings) {
  if (!Array.isArray(sources)) return [];
  return sources.filter((source) => {
    if (!source || typeof source !== 'object') return false;
    const item = source as Record<string, unknown>;
    const type = String(item.type || item.source_type || '').toLowerCase();
    const domain = String(item.domain || item.source_domain || '').toLowerCase();
    const internal = type === 'internal_catalog' || type === 'company_internal' || type === 'verified_application' || domain === 'f7 interno';
    return internal || (settings.allow_external_source_disclosure === true && capabilityEnabled(settings, 'official_sources'));
  });
}

export function filterSourcesForAssistant(sources: unknown, settings: AssistantCapabilitySettings) {
  if (!Array.isArray(sources)) return [];
  if (capabilityEnabled(settings, 'official_sources')) return sources;
  return sources.filter((source) => {
    if (!source || typeof source !== 'object') return false;
    const item = source as Record<string, unknown>;
    const type = String(item.type || item.source_type || '').toLowerCase();
    const domain = String(item.domain || item.source_domain || '').toLowerCase();
    return type === 'internal_catalog' || type === 'company_internal' || type === 'verified_application' || domain === 'f7 interno';
  });
}

export function filterToolsByCapabilities<T extends { name: string }>(tools: T[], settings: AssistantCapabilitySettings) {
  const blocked = new Set<string>();
  if (!capabilityEnabled(settings, 'product_lookup')) ['InternalCatalogTool', 'ProductTool', 'PartResearchTool'].forEach((name) => blocked.add(name));
  if (!capabilityEnabled(settings, 'price_lookup')) blocked.add('PricingTool');
  if (!capabilityEnabled(settings, 'stock_lookup')) blocked.add('StockTool');
  if (!capabilityEnabled(settings, 'customer_lookup')) blocked.add('CustomerTool');
  if (!capabilityEnabled(settings, 'quote_draft')) blocked.add('QuoteTool');
  if (!capabilityEnabled(settings, 'web_research')) blocked.add('WebSearchTool');
  if (!capabilityEnabled(settings, 'official_sources')) blocked.add('OfficialSourceTool');
  return tools.filter((tool) => !blocked.has(tool.name));
}
