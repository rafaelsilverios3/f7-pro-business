// Single browser projection of the canonical commercial feature routes.
// The feature keys intentionally match company_has_feature/plan_features.
export const FEATURE_REQUIREMENTS = Object.freeze({
  '/ai-sales': ['PRO', 'AI Sales Assistant', 'ai_sales'],
  '/f7-bi': ['BUSINESS', 'F7 Business Intelligence', 'business_intelligence'],
  // Intelligence is enabled for every paid/free active plan by the canonical
  // plan_features/company_has_feature matrix.
  '/intelligence': ['FREE', 'F7 Intelligence', 'intelligence'],
  '/opportunity-radar': ['BUSINESS', 'Opportunity Radar', 'opportunity_radar'],
  '/automacoes': ['BUSINESS', 'Automações', 'automations'],
  '/supplier-intelligence': ['PREMIUM', 'Supplier Intelligence', 'supplier_intelligence'],
  '/atendimento': ['BUSINESS', 'Smart Atendimento', 'atendimento'],
  '/market-intelligence': ['BUSINESS', 'Market Intelligence', 'advanced_reports'],
  '/sales-hub': ['BUSINESS', 'F7 Sales Hub', 'advanced_reports'],
  '/relatorios': ['BUSINESS', 'Relatórios avançados', 'advanced_reports'],
  '/marketing': ['BUSINESS', 'Marketing', 'advanced_reports'],
});
