export type F7ToolFailureMode = 'fallback' | 'handoff' | 'stop';
export type F7ToolDefinition = {
  name: string;
  description: string;
  scope: 'read' | 'draft' | 'transaction';
  risk_level: 'READ_ONLY' | 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK' | 'CRITICAL';
  required_permissions: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  timeout_ms: number;
  failure_mode: F7ToolFailureMode;
  audit_event: string;
  side_effects: boolean;
  enabled: boolean;
};

const readTool = (name: string, permission: string, audit: string): F7ToolDefinition => Object.freeze({ name, description: `Read-only ${name}`, scope: 'read', risk_level: 'READ_ONLY', required_permissions: [permission], input_schema: { type: 'object', additionalProperties: false }, output_schema: { type: 'object' }, timeout_ms: 8_000, failure_mode: 'fallback', audit_event: audit, side_effects: false, enabled: true });
const blockedTool = (name: string, permission: string, scope: 'draft' | 'transaction'): F7ToolDefinition => Object.freeze({ name, description: `Human-controlled ${name}`, scope, risk_level: scope === 'draft' ? 'MEDIUM_RISK' : 'HIGH_RISK', required_permissions: [permission], input_schema: { type: 'object', additionalProperties: false }, output_schema: { type: 'object' }, timeout_ms: 8_000, failure_mode: 'handoff', audit_event: `${name.toUpperCase()}_REQUESTED`, side_effects: true, enabled: false });

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
  authorize(name: string, permissions: string[]) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return { allowed: false, reason: 'TOOL_NOT_REGISTERED' };
    if (!tool.enabled) return { allowed: false, reason: 'TOOL_DISABLED' };
    if (!tool.required_permissions.every((permission) => permissions.includes(permission))) return { allowed: false, reason: 'TOOL_PERMISSION_DENIED' };
    if (tool.risk_level === 'CRITICAL') return { allowed: false, reason: 'CRITICAL_ACTION_BLOCKED' };
    return { allowed: true, reason: 'TOOL_AUTHORIZED' };
  },
  select(input: { intent: string; domain: string; allow_web_research?: boolean }) {
    const names = new Set(['ConversationTool', 'CompanyKnowledgeTool']);
    if (['parts', 'compatibility', 'product'].includes(input.intent) || input.intent === 'part_research' || input.intent === 'catalog_lookup') ['InternalCatalogTool', 'ProductTool', 'PartResearchTool'].forEach((name) => names.add(name));
    if (['parts', 'compatibility'].includes(input.intent) && input.allow_web_research !== false) ['WebSearchTool', 'OfficialSourceTool'].forEach((name) => names.add(name));
    if (['supplier', 'supplier_research'].includes(input.intent)) ['SupplierTool', 'SupplierResearchTool', 'MarketResearchTool'].forEach((name) => names.add(name));
    if (['market_research'].includes(input.intent)) ['MarketResearchTool', 'OpportunityTool'].forEach((name) => names.add(name));
    if (['opportunity', 'opportunity_analysis'].includes(input.intent)) ['OpportunityTool', 'MarketResearchTool', 'SupplierResearchTool'].forEach((name) => names.add(name));
    if (['price'].includes(input.intent) || input.intent === 'pricing_analysis') ['ProductTool', 'PricingTool'].forEach((name) => names.add(name));
    if (input.intent === 'stock') ['ProductTool', 'StockTool'].forEach((name) => names.add(name));
    if (input.intent === 'quote') ['ProductTool', 'PricingTool', 'QuoteTool'].forEach((name) => names.add(name));
    if (['customer', 'crm'].includes(input.intent) || input.intent === 'crm_analysis') ['CustomerTool', 'CRMTool'].forEach((name) => names.add(name));
    return tools.filter((tool) => names.has(tool.name) && tool.enabled);
  },
});
