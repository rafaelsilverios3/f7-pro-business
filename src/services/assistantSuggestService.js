import { invokeEdgeFunction } from '@/services/integrationsService';

export async function suggestConversationReply(conversationId, options = {}) {
  if (!conversationId) throw new Error('CONVERSATION_REQUIRED');
  return invokeEdgeFunction('assistant-suggest', { conversation_id: conversationId, request_id: options.requestId || crypto.randomUUID(), ...(options.quoteId ? { ai_credit_quote_id: options.quoteId, confirm_ai_credits: options.confirmed === true } : {}) });
}
