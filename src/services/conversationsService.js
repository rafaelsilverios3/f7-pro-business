import { createRepository } from '@/data/repositoryFactory';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { invokeEdgeFunction } from '@/services/integrationsService';

const conversations = createRepository('Conversation');
const messages = createRepository('Message');

const normalizeMessage = (row) => ({
  ...row,
  sender: row.sender_type === 'user' ? 'agent' : row.sender_type,
  text: row.content,
  timestamp: row.created_at,
  status: row.external_status || null,
  external_message_id: row.external_message_id || null,
});

const normalizeConversation = (row, history = []) => ({
  ...row,
  customer_name: row.lead_name || 'Contato sem nome',
  customer_phone: row.lead_phone,
  customer_email: row.lead_email,
  assignee: row.assigned_user_id,
  ai_enabled: row.status === 'ai',
  messages: history,
  created_date: row.created_at,
  updated_date: row.updated_at,
});

async function listSupabase(companyId) {
  const client = getSupabaseClient();
  const { data: rows, error } = await client.from('conversations').select('*').eq('company_id', companyId).order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
  if (error) throw error;
  const ids = (rows || []).map((row) => row.id);
  if (!ids.length) return [];
  const { data: history, error: historyError } = await client.from('messages').select('*').eq('company_id', companyId).in('conversation_id', ids).order('created_at', { ascending: true });
  if (historyError) throw historyError;
  const byConversation = (history || []).reduce((map, row) => { (map[row.conversation_id] ||= []).push(normalizeMessage(row)); return map; }, {});
  return (rows || []).map((row) => normalizeConversation(row, byConversation[row.id] || []));
}

export const conversationsService = {
  list: (companyId) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? listSupabase(companyId) : conversations.list(companyId, '-last_message_at'),
  create: (companyId, data) => conversations.create(data, companyId),
  update: (companyId, id, data) => conversations.update(id, data, companyId),
  messages: async (companyId, conversationId) => {
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') {
      const { data, error } = await getSupabaseClient().from('messages').select('*').eq('company_id', companyId).eq('conversation_id', conversationId).order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map(normalizeMessage);
    }
    return messages.list(companyId).then((items) => items.filter((item) => item.conversation_id === conversationId));
  },
  addMessage: (companyId, data) => messages.create(data, companyId),
  sendWhatsApp: (companyId, conversationId, message, clientRequestId) => invokeEdgeFunction('whatsapp-send', { company_id: companyId, conversation_id: conversationId, message, client_request_id: clientRequestId }),
  remove: (companyId, id) => conversations.remove(id, companyId),
};