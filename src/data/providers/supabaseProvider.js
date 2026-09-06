import { createClient } from '@supabase/supabase-js';

let client;
const tableNames = { Customer: 'customers', Product: 'products', Sale: 'sales', StockMovement: 'stock_movements', FinancialEntry: 'financial_entries', Supplier: 'suppliers', PurchaseOrder: 'purchases', PurchaseItem: 'purchase_items', Quote: 'quotes', Commission: 'commissions', Company: 'companies', AuditLog: 'audit_logs' };
const sortColumns = { created_date: 'created_at', updated_date: 'updated_at' };
const normalize = (name, row) => {
  if (!row) return row;
  if (name === 'Product') return { ...row, sale_price: row.price, cost_price: row.cost, min_stock: row.minimum_stock, created_date: row.created_at, updated_date: row.updated_at, unit: row.unit || 'un' };
  return { ...row, created_date: row.created_at, updated_date: row.updated_at };
};
const columns = {
  Customer: ['company_id', 'name', 'document', 'email', 'phone', 'total_purchased', 'sale_count', 'avg_ticket'],
  Product: ['company_id', 'name', 'sku', 'cost', 'price', 'stock', 'minimum_stock', 'active'],
  Supplier: ['company_id', 'name', 'document', 'email', 'phone'],
  PurchaseOrder: ['company_id', 'supplier_id', 'status', 'total', 'expected_date'],
  PurchaseItem: ['company_id', 'purchase_id', 'product_id', 'quantity', 'cost'],
  Commission: ['company_id', 'sale_id', 'seller', 'rate', 'amount', 'status'],
};
const payloadFor = (name, payload = {}) => {
  const mapped = name === 'Product' ? { ...payload, price: payload.price ?? payload.sale_price, cost: payload.cost ?? payload.cost_price, minimum_stock: payload.minimum_stock ?? payload.min_stock } : payload;
  const allowed = columns[name];
  return allowed ? Object.fromEntries(Object.entries(mapped).filter(([key]) => allowed.includes(key))) : mapped;
};
export function getSupabaseClient() {
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
    async list(sort = 'created_at', limit = 500) { const column = sortColumns[sort.replace(/^-/, '')] || sort.replace(/^-/, ''); const { data, error } = await getSupabaseClient().from(table).select('*').order(column, { ascending: !sort.startsWith('-') }).limit(limit); if (error) throw error; return (data || []).map((row) => normalize(name, row)); },
    async filter(filters = {}, sort = '-created_at', limit = 500) { let query = getSupabaseClient().from(table).select('*'); for (const [key, value] of Object.entries(filters)) query = query.eq(key, value); const column = sortColumns[sort.replace(/^-/, '')] || sort.replace(/^-/, ''); const { data, error } = await query.order(column, { ascending: !sort.startsWith('-') }).limit(limit); if (error) throw error; return (data || []).map((row) => normalize(name, row)); },
    async get(id) { const { data, error } = await getSupabaseClient().from(table).select('*').eq('id', id).single(); if (error && error.code !== 'PGRST116') throw error; return normalize(name, data); },
    async create(payload) { const { data, error } = await getSupabaseClient().from(table).insert(payloadFor(name, payload)).select().single(); if (error) throw error; return normalize(name, data); },
    async update(id, payload) { const { data, error } = await getSupabaseClient().from(table).update(payloadFor(name, payload)).eq('id', id).select().single(); if (error) throw error; return normalize(name, data); },
    async delete(id) { const { error } = await getSupabaseClient().from(table).delete().eq('id', id); if (error) throw error; },
  };
}
export const supabaseProvider = { entity, async rpc(name, params) { const { data, error } = await getSupabaseClient().rpc(name, params); if (error) throw error; return data; } };
