import { invokeEdgeFunction } from '@/services/integrationsService';

export async function suggestConversationReply(conversationId) {
  if (!conversationId) throw new Error('CONVERSATION_REQUIRED');
  return invokeEdgeFunction('assistant-suggest', { conversation_id: conversationId, request_id: crypto.randomUUID() });
}
