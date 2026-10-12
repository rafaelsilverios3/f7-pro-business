import { invokeEdgeFunction } from '@/services/integrationsService';

export const aiSalesService = {
  status: (companyId) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, action: 'status' }),
  chat: (companyId, message, history = [], context = {}) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, message, history, context }),
  createDraft: (companyId, draft) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, action: 'create_draft', confirmed: true, draft }),
};
