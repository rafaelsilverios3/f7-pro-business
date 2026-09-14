import { createRepository } from '@/data/repositoryFactory';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const repository = createRepository('Notification');
const CATEGORY_TYPES = {
  CRM: ['automation'],
  Oportunidades: ['opportunity', 'radar'],
  Automações: ['automation'],
  Estoque: ['stock'],
  Financeiro: ['financial'],
  Vendas: ['sale', 'quote', 'order'],
  Compras: ['purchase'],
  Sistema: ['attendance', 'goal', 'system'],
};

const normalize = (row = {}) => ({ ...row, created_date: row.created_date || row.created_at, updated_date: row.updated_date || row.updated_at });
const dispatchChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('f7:notifications-updated')); };
const currentUserId = async (client) => { const { data } = await client.auth.getUser(); return data?.user?.id || null; };
const addVisibleUserScope = (query, userId) => (userId ? query.or(`user_id.is.null,user_id.eq.${userId}`) : query);

function applyOptions(query, options = {}) {
  const filter = options.filter || 'all';
  if (filter === 'unread') query = query.eq('read', false);
  if (filter === 'read') query = query.eq('read', true);
  if (options.periodDays && Number.isFinite(Number(options.periodDays))) query = query.gte('created_at', new Date(Date.now() - Number(options.periodDays) * 86_400_000).toISOString());
  const types = CATEGORY_TYPES[options.category];
  if (options.category === 'CRM') query = query.eq('entity', 'crm_activity');
  else if (options.category === 'Oportunidades') query = query.in('entity', ['opportunity', 'radar']);
  else if (options.category === 'Automações') query = query.eq('type', 'automation');
  else if (types?.length === 1) query = query.eq('type', types[0]);
  else if (types?.length > 1) query = query.in('type', types);
  const search = String(options.search || '').trim().replace(/[%,]/g, ' ').slice(0, 80);
  if (search) query = query.or(`title.ilike.%${search}%,message.ilike.%${search}%`);
  return query;
}

async function supabaseList(companyId, options = {}) {
  const client = getSupabaseClient();
  const userId = await currentUserId(client);
  const page = Math.max(1, Number(options.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 30));
  let query = client.from('notifications').select('id,company_id,user_id,type,title,message,read,entity,entity_id,created_at', { count: 'exact' }).eq('company_id', companyId);
  query = addVisibleUserScope(applyOptions(query, options), userId);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  return { rows: (data || []).map(normalize), count: count || 0, page, pageSize, hasMore: (count || 0) > page * pageSize };
}

export const notificationsService = {
  async list(companyId, options = {}) {
    if (typeof options === 'string') options = { sort: options };
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return (await repository.list(companyId, options.sort || '-created_date', options.limit || 500)).map(normalize);
    return (await supabaseList(companyId, options)).rows;
  },
  async listPage(companyId, options = {}) {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
      const rows = await this.list(companyId, options); const page = Math.max(1, Number(options.page) || 1); const pageSize = Math.max(1, Number(options.pageSize) || 30);
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), count: rows.length, page, pageSize, hasMore: rows.length > page * pageSize };
    }
    return supabaseList(companyId, options);
  },
  async countUnread(companyId) {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return (await repository.list(companyId, '-created_date', 500)).filter((item) => !item.read).length;
    const client = getSupabaseClient(); const userId = await currentUserId(client);
    let query = client.from('notifications').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('read', false);
    query = addVisibleUserScope(query, userId);
    const { count, error } = await query; if (error) throw error; return count || 0;
  },
  async markRead(companyId, id) {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { const result = await repository.update(id, { read: true }, companyId); dispatchChanged(); return result; }
    const { data, error } = await getSupabaseClient().from('notifications').update({ read: true }).eq('id', id).eq('company_id', companyId).select('id').maybeSingle();
    if (error) throw error; dispatchChanged(); return data;
  },
  async markAllRead(companyId) {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
      const unread = (await repository.list(companyId, '-created_date', 500)).filter((item) => !item.read);
      await Promise.all(unread.map((item) => repository.update(item.id, { read: true }, companyId))); dispatchChanged(); return unread.length;
    }
    const client = getSupabaseClient(); const userId = await currentUserId(client);
    let query = client.from('notifications').update({ read: true }).eq('company_id', companyId).eq('read', false);
    query = addVisibleUserScope(query, userId);
    const { data, error } = await query.select('id'); if (error) throw error; dispatchChanged(); return data?.length || 0;
  },
  // Kept for compatibility with older callers; the central UI does not expose deletion.
  remove: (companyId, id) => repository.remove(id, companyId),
};

export { CATEGORY_TYPES };
