import { createAssistantDecision, type AssistantDecision } from './assistantDecision.ts';
import { F7ToolRegistry } from './toolRegistry.ts';
import { DomainSpecialistRegistry } from './specialistRegistry.ts';
import { ManufacturerAdapterRegistry } from './manufacturerAdapterRegistry.ts';
import { AgriculturalPartsSpecialist } from './specialists/agriculturalParts.ts';

export type F7AIOrchestratorInput = {
  trace_id: string;
  message: string;
  company: { segment?: string; business_description?: string; specific_rules?: string; mode?: string; allow_web_research?: boolean };
  product_intelligence: any;
  automatic_policy?: { enabled?: boolean; min_confidence?: string };
};

function selectDomain(input: F7AIOrchestratorInput) {
  const intelligence = input.product_intelligence && typeof input.product_intelligence === 'object' ? input.product_intelligence : {};
  const discoveredMachine = intelligence.discovered_machine && typeof intelligence.discovered_machine === 'object' ? intelligence.discovered_machine : {};
  const candidateContext = Array.isArray(intelligence.candidates) ? intelligence.candidates.slice(0, 10).map((candidate: any) => `${candidate?.manufacturer || ''} ${candidate?.application || ''}`).join(' ') : '';
  const context = `${input.company.segment || ''} ${input.company.business_description || ''} ${input.message} ${discoveredMachine.manufacturer || ''} ${discoveredMachine.equipment_type || ''} ${candidateContext}`.toLocaleLowerCase('pt-BR');
  const manufacturerAdapter = ManufacturerAdapterRegistry.select({ manufacturer: discoveredMachine.manufacturer, text: input.message, product_text: candidateContext });
  if (manufacturerAdapter?.specialist_domain === 'agricultural_parts' || AgriculturalPartsSpecialist.matches({ segment: input.company.segment, business_description: input.company.business_description, text: context })) return 'agricultural_parts';
  if (/autope[cç]a|ve[ií]culo|carro|motor/.test(context)) return 'auto_parts';
  if (/roup|camiseta|tamanho|vestu[aá]rio/.test(context)) return 'clothing';
  if (/eletr[oô]nic|voltagem|notebook|celular/.test(context)) return 'electronics';
  if (/constru[cç][aã]o|cimento|argamassa|tijolo/.test(context)) return 'construction_materials';
  if (/servi[cç]o|agenda|consulta/.test(context)) return 'services';
  return 'general_business';
}

function selectIntent(message: string) {
  if (/\b(fornecedor|prazo de entrega|reputa[cç][aã]o|risco do fornecedor)\b/i.test(message)) return 'supplier_research';
  if (/\b(mercado|demanda|tend[eê]ncia|concorr[eê]ncia|pre[cç]o m[eé]dio)\b/i.test(message)) return 'market_research';
  if (/\b(oportunidade|potencial de venda|novo produto|viabilidade)\b/i.test(message)) return 'opportunity_analysis';
  if (/\b(pn|p\/?n|c[oó]digo|filtro|correia|rolamento|pe[cç]a|compatibilidade)\b/i.test(message)) return 'part_research';
  return 'general_support';
}

export const F7AIOrchestrator = Object.freeze({
  orchestrate(input: F7AIOrchestratorInput): AssistantDecision {
    const intelligence = input.product_intelligence && typeof input.product_intelligence === 'object' ? input.product_intelligence : {};
    const research = intelligence.research_state && typeof intelligence.research_state === 'object' ? intelligence.research_state : {};
    const web = intelligence.web_research && typeof intelligence.web_research === 'object' ? intelligence.web_research : {};
    const candidates = Array.isArray(intelligence.candidates) ? intelligence.candidates : [];
    const conflicts = Array.isArray(web.evidence?.conflicts) ? web.evidence.conflicts : [];
    const domain = selectDomain(input);
    const specialist = DomainSpecialistRegistry.select({ ...input.company, message: input.message, domain });
    const intent = selectIntent(input.message);
    const tools = F7ToolRegistry.select({ intent, domain, allow_web_research: input.company.allow_web_research !== false });
    return createAssistantDecision({
      traceId: input.trace_id,
      text: input.message,
      domain,
      objective: input.message,
      candidates,
      knownFacts: research.known_facts,
      discoveredFacts: research.discovered_facts,
      evidence: candidates.flatMap((candidate: any) => Array.isArray(candidate?.evidence) ? candidate.evidence.slice(0, 3) : []).slice(0, 30),
      unresolvedQuestions: intelligence.missing_for_confirmation || intelligence.missing_information,
      researchPending: web.searched !== true && intelligence.need_external_research === true,
      graveConflict: conflicts.length > 1,
      automaticReplyEnabled: input.company.mode === 'automatic' && input.automatic_policy?.enabled === true,
      minConfidence: input.automatic_policy?.min_confidence,
      specialist: specialist?.name || null,
      tools: tools.map((tool) => tool.name),
    });
  },
});
