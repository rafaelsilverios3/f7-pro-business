import { createRepository } from '@/data/repositoryFactory';
const conversations = createRepository('Conversation');
const messages = createRepository('Message');
export const conversationsService = { list: (companyId) => conversations.list(companyId, '-last_message_at'), create: (companyId, data) => conversations.create(data, companyId), update: (companyId, id, data) => conversations.update(id, data, companyId), messages: (companyId, conversationId) => messages.list(companyId).then((items) => items.filter((item) => item.conversation_id === conversationId)), addMessage: (companyId, data) => messages.create(data, companyId), remove: (companyId, id) => conversations.remove(id, companyId) };
