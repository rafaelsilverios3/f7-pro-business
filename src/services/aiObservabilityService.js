import { invokeEdgeFunction } from '@/services/integrationsService';
export const aiObservabilityService = {
  runs: (companyId) => invokeEdgeFunction('ai-run-inspector', { company_id: companyId }),
  health: (companyId) => invokeEdgeFunction('platform-health', { company_id: companyId }),
};
