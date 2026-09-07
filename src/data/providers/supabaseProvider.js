import { createClient } from '@supabase/supabase-js';

let client;
const tableNames = { Customer: 'customers', Product: 'products', Sale: 'sales', StockMovement: 'stock_movements', FinancialEntry: 'financial_entries', Supplier: 'suppliers', PurchaseOrder: 'purchases', PurchaseItem: 'purchase_items', Quote: 'quotes', Commission: 'commissions', Company: 'companies', AuditLog: 'audit_logs', Goal: 'goals', Notification: 'notifications', Profile: 'profiles', Conversation: 'conversations', Message: 'messages', Opportunity: 'opportunities', ProductOpportunity: 'product_opportunities', OpportunityProductDraft: 'opportunity_product_drafts', Automation: 'automations', AutomationRun: 'automation_runs', IntelligenceInsight: 'intelligence_insights', CompanySubscription: 'company_subscriptions', CompanyInvite: 'company_invites' };
const sortColumns = { created_date: 'created_at', updated_date: 'updated_at' };
const normalize = (name, row) => {
  if (!row) return row;
  if (name === 'Product') return { ...row, sale_price: row.price, cost_price: row.cost, min_stock: row.minimum_stock, created_date: row.created_at, updated_date: row.updated_at, unit: row.unit || 'un' };
  if (name === 'Goal') return { ...row, scope: row.type === 'seller' ? 'seller' : 'company', target_amount: row.target_value, target_key: row.user_id || 'all', period_value: row.start_date, created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'Conversation') return { ...row, customer_name: row.lead_name, customer_phone: row.lead_phone, customer_email: row.lead_email, assignee: row.assigned_user_id, ai_enabled: row.status === 'ai_assisting', messages: row.messages || [], created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'Message') return { ...row, sender: row.sender_type === 'user' ? 'agent' : row.sender_type, text: row.content, timestamp: row.created_at, created_date: row.created_at };
  if (name === 'Automation') return { ...row, trigger: row.trigger_type, created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'AutomationRun') return { ...row, trigger: row.trigger_data?.trigger, created_date: row.created_at };
  return { ...row, created_date: row.created_at, updated_date: row.updated_at };
};
const columns = {
  Customer: ['company_id', 'name', 'document', 'email', 'phone', 'total_purchased', 'sale_count', 'avg_ticket'],
  Product: ['company_id', 'name', 'sku', 'barcode', 'category', 'subcategory', 'brand', 'description', 'short_description', 'full_description', 'material', 'color', 'size', 'model', 'weight', 'dimensions', 'tags', 'keywords', 'featured', 'unit', 'commission_rate', 'cost', 'price', 'stock', 'minimum_stock', 'active'],
  Supplier: ['company_id', 'name', 'document', 'email', 'phone'],
  PurchaseOrder: ['company_id', 'supplier_id', 'status', 'total', 'expected_date'],
  PurchaseItem: ['company_id', 'purchase_id', 'product_id', 'quantity', 'cost'],
  Commission: ['company_id', 'sale_id', 'seller', 'rate', 'amount', 'status'],
  Goal: ['company_id', 'name', 'type', 'target_value', 'period', 'start_date', 'end_date', 'user_id', 'status'],
  Conversation: ['company_id', 'customer_id', 'lead_name', 'lead_phone', 'lead_email', 'channel', 'status', 'assigned_user_id', 'subject', 'last_message_at'],
  Message: ['company_id', 'conversation_id', 'sender_type', 'sender_user_id', 'content', 'message_type', 'created_at'],
  Opportunity: ['company_id', 'customer_id', 'conversation_id', 'title', 'description', 'value', 'stage', 'assigned_user_id', 'source', 'expected_close_date'],
  Automation: ['company_id', 'name', 'active', 'trigger_type', 'conditions', 'actions', 'created_by'],
  AutomationRun: ['company_id', 'automation_id', 'status', 'trigger_data', 'result', 'error_message', 'idempotency_key'],
  IntelligenceInsight: ['company_id', 'type', 'severity', 'title', 'description', 'entity', 'entity_id', 'data', 'status', 'resolved_at'],
  CompanySubscription: ['company_id', 'plan', 'status', 'trial_ends_at', 'current_period_start', 'current_period_end'],
  CompanyInvite: ['company_id', 'email', 'role', 'token_hash', 'status', 'expires_at', 'invited_by'],
  ProductOpportunity: ['company_id', 'title', 'description', 'status', 'source', 'source_url', 'collected_at', 'source_type', 'confidence_level', 'scores', 'opportunity_score', 'supplier_score', 'trust_score', 'channel_score', 'metadata'],
  OpportunityProductDraft: ['company_id', 'opportunity_id', 'name', 'description', 'category', 'price', 'cost', 'stock', 'active', 'status'],
};
const payloadFor = (name, payload = {}) => {
  let mapped = payload;
  if (name === 'Product') mapped = { ...payload, price: payload.price ?? payload.sale_price, cost: payload.cost ?? payload.cost_price, minimum_stock: payload.minimum_stock ?? payload.min_stock };
  if (name === 'Conversation') mapped = { ...payload, lead_name: payload.lead_name ?? payload.customer_name, lead_phone: payload.lead_phone ?? payload.customer_phone, lead_email: payload.lead_email ?? payload.customer_email, assigned_user_id: payload.assigned_user_id ?? payload.assignee };
  if (name === 'Message') mapped = { ...payload, sender_type: payload.sender_type ?? (payload.sender === 'agent' ? 'user' : payload.sender), content: payload.content ?? payload.text };
  if (name === 'Automation') mapped = { ...payload, trigger_type: payload.trigger_type ?? payload.trigger };
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
export const supabaseProvider = { entity, async rpc(name, params) { const { data, error } = await getSupabaseClient().rpc(name, params); if (error) throw error; return data; }, async listMembers(companyId) { const { data, error } = await getSupabaseClient().from('company_users').select('*').eq('company_id', companyId).order('created_at', { ascending: true }); if (error) throw error; const ids = (data || []).map((member) => member.user_id); if (!ids.length) return []; const profiles = await getSupabaseClient().from('profiles').select('id,name,email,avatar_url').in('id', ids); if (profiles.error) throw profiles.error; const byId = Object.fromEntries((profiles.data || []).map((profile) => [profile.id, profile])); return (data || []).map((member) => ({ ...member, ...(byId[member.user_id] || {}) })); } };
