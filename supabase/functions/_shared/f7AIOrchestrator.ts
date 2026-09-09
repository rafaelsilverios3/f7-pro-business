import { createAssistantDecision, type AssistantDecision } from './assistantDecision.ts';

export type F7AIOrchestratorInput = {
  trace_id: string;
  message: string;
  company: { segment?: string; business_description?: string; specific_rules?: string; mode?: string };
  product_intelligence: any;
  automatic_policy?: { enabled?: boolean; min_confidence?: string };
};

function selectDomain(input: F7AIOrchestratorInput) {
  const context = `${input.company.segment || ''} ${input.company.business_description || ''} ${input.message}`.toLocaleLowerCase('pt-BR');
  if (/trator|colheit|pulverizador|plantadeira|agr[ií]col|john\s*deere/.test(context)) return 'agricultural_parts';
  if (/autope[cç]a|ve[ií]culo|carro|motor/.test(context)) return 'auto_parts';
  if (/roup|camiseta|tamanho|vestu[aá]rio/.test(context)) return 'clothing';
  if (/eletr[oô]nic|voltagem|notebook|celular/.test(context)) return 'electronics';
  if (/constru[cç][aã]o|cimento|argamassa|tijolo/.test(context)) return 'construction_materials';
  if (/servi[cç]o|agenda|consulta/.test(context)) return 'services';
  return 'general_business';
}

export const F7AIOrchestrator = Object.freeze({
  orchestrate(input: F7AIOrchestratorInput): AssistantDecision {
    const intelligence = input.product_intelligence && typeof input.product_intelligence === 'object' ? input.product_intelligence : {};
    const research = intelligence.research_state && typeof intelligence.research_state === 'object' ? intelligence.research_state : {};
    const web = intelligence.web_research && typeof intelligence.web_research === 'object' ? intelligence.web_research : {};
    const candidates = Array.isArray(intelligence.candidates) ? intelligence.candidates : [];
    const conflicts = Array.isArray(web.evidence?.conflicts) ? web.evidence.conflicts : [];
    return createAssistantDecision({
      traceId: input.trace_id,
      text: input.message,
      domain: selectDomain(input),
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
    });
  },
});
