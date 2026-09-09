export type DomainSpecialist = {
  name: string;
  domain: string;
  signals: RegExp[];
  preferred_tools: string[];
  confirmation_strategy: string;
};

const specialists: DomainSpecialist[] = [
  { name: 'AgriculturalPartsSpecialist', domain: 'agricultural_parts', signals: [/agr[ií]col/i, /trator|colheit|pulverizador|plantadeira/i, /john\s*deere/i], preferred_tools: ['InternalCatalogTool', 'PartResearchTool', 'WebSearchTool', 'OfficialSourceTool'], confirmation_strategy: 'start_with_model_and_part_then_request_pin_only_to_resolve_remaining_variants' },
  { name: 'AutoPartsSpecialist', domain: 'auto_parts', signals: [/autope[cç]a/i, /ve[ií]culo|carro|motor/i], preferred_tools: ['InternalCatalogTool', 'PartResearchTool', 'WebSearchTool'], confirmation_strategy: 'confirm_vehicle_version_engine_and_position_when_needed' },
  { name: 'RetailSpecialist', domain: 'retail', signals: [/varejo|loja|produto/i], preferred_tools: ['InternalCatalogTool', 'StockTool'], confirmation_strategy: 'confirm_product_variant_and_availability' },
  { name: 'ElectronicsSpecialist', domain: 'electronics', signals: [/eletr[oô]nic|notebook|celular|voltagem/i], preferred_tools: ['InternalCatalogTool', 'ProductTool'], confirmation_strategy: 'confirm_model_specification_compatibility_and_voltage' },
  { name: 'ConstructionMaterialsSpecialist', domain: 'construction_materials', signals: [/constru[cç][aã]o|cimento|argamassa|tijolo/i], preferred_tools: ['InternalCatalogTool', 'ProductTool'], confirmation_strategy: 'confirm_application_dimensions_quantity_and_environment' },
  { name: 'ClothingSpecialist', domain: 'clothing', signals: [/roup|camiseta|vestu[aá]rio|tamanho/i], preferred_tools: ['InternalCatalogTool', 'StockTool'], confirmation_strategy: 'confirm_product_size_color_and_measurements' },
  { name: 'ServiceBusinessSpecialist', domain: 'services', signals: [/servi[cç]o|agenda|consulta/i], preferred_tools: ['CompanyKnowledgeTool', 'CRMTool'], confirmation_strategy: 'confirm_service_location_schedule_and_scope' },
  { name: 'ProcurementSpecialist', domain: 'procurement', signals: [/compra|fornecedor|reposi[cç][aã]o/i], preferred_tools: ['SupplierTool', 'SupplierResearchTool'], confirmation_strategy: 'compare supplier_lead_time_cost_and_risk' },
  { name: 'SalesSpecialist', domain: 'sales', signals: [/venda|or[cç]amento|proposta/i], preferred_tools: ['ProductTool', 'PricingTool'], confirmation_strategy: 'prepare_information_for_human_commercial_action' },
  { name: 'FinancialSpecialist', domain: 'financial', signals: [/financeir|receber|pagar|fluxo/i], preferred_tools: ['FinanceTool'], confirmation_strategy: 'present_read_only_financial_context' },
];

export const DomainSpecialistRegistry = Object.freeze({
  all: () => specialists.slice(),
  select(input: { segment?: string; business_description?: string; message?: string; domain?: string }) {
    const context = `${input.segment || ''} ${input.business_description || ''} ${input.message || ''}`;
    return specialists.find((specialist) => specialist.domain === input.domain) || specialists.find((specialist) => specialist.signals.some((signal) => signal.test(context))) || null;
  },
});
