import { invokeEdgeFunction } from '@/services/integrationsService';

export const aiSalesService = {
  status: (companyId) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, action: 'status' }),
  chat: (companyId, message, history = [], context = {}, options = {}) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, message, history, context, request_id: options.requestId || crypto.randomUUID(), ...(options.quoteId ? { ai_credit_quote_id: options.quoteId, confirm_ai_credits: options.confirmed === true } : {}) }),
  createDraft: (companyId, draft) => invokeEdgeFunction('ai-sales-assistant', { company_id: companyId, action: 'create_draft', confirmed: true, draft }),
};
