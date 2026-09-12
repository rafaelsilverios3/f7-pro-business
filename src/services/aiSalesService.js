import { invokeEdgeFunction } from '@/services/integrationsService';

export const aiSalesService = {
  chat: (companyId, message, history = []) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, message, history }),
  createDraft: (companyId, draft) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, action: 'create_draft', confirmed: true, draft }),
};
