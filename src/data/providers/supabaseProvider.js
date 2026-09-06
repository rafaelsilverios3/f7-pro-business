import { createClient } from '@supabase/supabase-js';

let client;
const tableNames = { Customer: 'customers', Product: 'products', Sale: 'sales', StockMovement: 'stock_movements', FinancialEntry: 'financial_entries', Supplier: 'suppliers', PurchaseOrder: 'purchases', Quote: 'quotes', Commission: 'commissions', Company: 'companies', AuditLog: 'audit_logs' };
function getClient() {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
    client = createClient(url, key);
  }
  return client;
}
function entity(name) {
  const table = tableNames[name] || name;
  return {
    async list(sort = 'created_at', limit = 500) { const { data, error } = await getClient().from(table).select('*').order(sort.replace(/^-/, ''), { ascending: !sort.startsWith('-') }).limit(limit); if (error) throw error; return data || []; },
    async filter(filters = {}, sort = '-created_at', limit = 500) { let query = getClient().from(table).select('*'); for (const [key, value] of Object.entries(filters)) query = query.eq(key, value); const { data, error } = await query.order(sort.replace(/^-/, ''), { ascending: !sort.startsWith('-') }).limit(limit); if (error) throw error; return data || []; },
    async get(id) { const { data, error } = await getClient().from(table).select('*').eq('id', id).single(); if (error && error.code !== 'PGRST116') throw error; return data; },
    async create(payload) { const { data, error } = await getClient().from(table).insert(payload).select().single(); if (error) throw error; return data; },
    async update(id, payload) { const { data, error } = await getClient().from(table).update(payload).eq('id', id).select().single(); if (error) throw error; return data; },
    async delete(id) { const { error } = await getClient().from(table).delete().eq('id', id); if (error) throw error; },
  };
}
export const supabaseProvider = { entity };
