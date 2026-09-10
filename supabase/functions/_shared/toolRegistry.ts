export type F7ToolFailureMode = 'fallback' | 'handoff' | 'stop';
export type F7ToolDefinition = {
  name: string;
  scope: 'read' | 'draft' | 'transaction';
  required_permissions: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  timeout_ms: number;
  failure_mode: F7ToolFailureMode;
  audit_event: string;
  enabled: boolean;
};

const readTool = (name: string, permission: string, audit: string): F7ToolDefinition => Object.freeze({ name, scope: 'read', required_permissions: [permission], input_schema: { type: 'object', additionalProperties: false }, output_schema: { type: 'object' }, timeout_ms: 8_000, failure_mode: 'fallback', audit_event: audit, enabled: true });
const blockedTool = (name: string, permission: string, scope: 'draft' | 'transaction'): F7ToolDefinition => Object.freeze({ name, scope, required_permissions: [permission], input_schema: { type: 'object', additionalProperties: false }, output_schema: { type: 'object' }, timeout_ms: 8_000, failure_mode: 'handoff', audit_event: `${name.toUpperCase()}_REQUESTED`, enabled: false });

const tools: F7ToolDefinition[] = [
  readTool('InternalCatalogTool', 'products.view', 'INTERNAL_CATALOG_READ'),
  readTool('ProductTool', 'products.view', 'PRODUCT_READ'),
  readTool('StockTool', 'inventory.view', 'STOCK_READ'),
  readTool('CustomerTool', 'customers.view', 'CUSTOMER_READ'),
  readTool('CRMTool', 'conversation.view', 'CRM_READ'),
  blockedTool('QuoteTool', 'quotes.manage', 'draft'),
  blockedTool('SalesTool', 'sales.manage', 'transaction'),
  readTool('FinanceTool', 'finance.view', 'FINANCE_READ'),
  readTool('SupplierTool', 'purchases.view', 'SUPPLIER_READ'),
  readTool('PricingTool', 'pricing.view', 'PRICING_READ'),
  readTool('OpportunityTool', 'opportunity.view', 'OPPORTUNITY_READ'),
  readTool('MarketResearchTool', 'market_intelligence.view', 'MARKET_RESEARCH_READ'),
  readTool('SupplierResearchTool', 'supplier_intelligence.view', 'SUPPLIER_RESEARCH_READ'),
  readTool('WebSearchTool', 'assistant.suggest', 'WEB_SEARCH_EXECUTED'),
  readTool('OfficialSourceTool', 'assistant.suggest', 'OFFICIAL_SOURCE_READ'),
  readTool('PartResearchTool', 'assistant.suggest', 'PART_RESEARCH_EXECUTED'),
  readTool('ConversationTool', 'conversation.view', 'CONVERSATION_READ'),
  readTool('CompanyKnowledgeTool', 'assistant_settings.view', 'COMPANY_KNOWLEDGE_READ'),
  blockedTool('HumanHandoffTool', 'conversation.manage', 'draft'),
];

export const F7ToolRegistry = Object.freeze({
  all: () => tools.slice(),
  get: (name: string) => tools.find((tool) => tool.name === name) || null,
  select(input: { intent: string; domain: string; allow_web_research?: boolean }) {
    const names = new Set(['ConversationTool', 'CompanyKnowledgeTool']);
    if (input.intent === 'part_research' || input.intent === 'catalog_lookup') ['InternalCatalogTool', 'ProductTool', 'PartResearchTool'].forEach((name) => names.add(name));
    if (input.intent === 'part_research' && input.allow_web_research !== false) ['WebSearchTool', 'OfficialSourceTool'].forEach((name) => names.add(name));
    if (input.intent === 'supplier_research') ['SupplierTool', 'SupplierResearchTool', 'MarketResearchTool'].forEach((name) => names.add(name));
    if (input.intent === 'market_research') ['MarketResearchTool', 'OpportunityTool'].forEach((name) => names.add(name));
    if (input.intent === 'opportunity_analysis') ['OpportunityTool', 'MarketResearchTool', 'SupplierResearchTool'].forEach((name) => names.add(name));
    return tools.filter((tool) => names.has(tool.name) && tool.enabled);
  },
});
