import { createClient } from '@supabase/supabase-js';

let client;
const tableNames = { Customer: 'customers', Product: 'products', Sale: 'sales', StockMovement: 'stock_movements', FinancialEntry: 'financial_entries', FinancialMovement: 'financial_movements', FinancialInstallment: 'financial_installments', Supplier: 'suppliers', PurchaseOrder: 'purchases', PurchaseItem: 'purchase_items', Quote: 'quotes', Commission: 'commissions', Company: 'companies', AuditLog: 'audit_logs', Goal: 'goals', Notification: 'notifications', Profile: 'profiles', Conversation: 'conversations', Message: 'messages', Opportunity: 'opportunities', ProductOpportunity: 'product_opportunities', OpportunityProductDraft: 'opportunity_product_drafts', CrmActivity: 'crm_activities', SupplierIntelligence: 'supplier_intelligence_profiles', SupplierReview: 'supplier_reviews', SupplierRiskSignal: 'supplier_risk_signals', MarketSource: 'market_sources', MarketSignal: 'market_signals', MarketOpportunity: 'market_opportunities', SalesChannel: 'sales_channels', ProductChannel: 'product_channel_links', ChannelMetric: 'channel_metrics', Automation: 'automations', AutomationRun: 'automation_runs', IntelligenceInsight: 'intelligence_insights', CompanySubscription: 'company_subscriptions', CompanyInvite: 'company_invites', CommercialCampaign: 'commercial_campaigns', CommercialCampaignImport: 'commercial_campaign_imports', CommercialCampaignFact: 'commercial_campaign_facts', CommercialCampaignTarget: 'commercial_campaign_targets', CommercialCampaignOutcome: 'commercial_campaign_outcomes' };
const sortColumns = { created_date: 'created_at', updated_date: 'updated_at' };
const normalizeSort = (sort, fallback = 'created_at') => {
  const value = typeof sort === 'string' && sort.trim() ? sort.trim() : fallback;
  const descending = value.startsWith('-');
  const key = value.replace(/^-/, '');
  return { column: sortColumns[key] || key || fallback, descending };
};
const normalize = (name, row) => {
  if (!row) return row;
  if (name === 'Product') return { ...row, sale_price: row.price, cost_price: row.cost, min_stock: row.minimum_stock, created_date: row.created_at, updated_date: row.updated_at, unit: row.unit || 'un' };
  if (name === 'Goal') return { ...row, scope: row.type === 'seller' ? 'seller' : 'company', target_amount: row.target_value, target_key: row.user_id || 'all', period_value: row.start_date, created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'Conversation') return { ...row, customer_name: row.lead_name, customer_phone: row.lead_phone, customer_email: row.lead_email, assignee: row.assigned_user_id, ai_enabled: row.status === 'ai_assisting', messages: row.messages || [], created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'Message') return { ...row, sender: row.sender_type === 'user' ? 'agent' : row.sender_type, text: row.content, timestamp: row.created_at, created_date: row.created_at };
  if (name === 'Automation') return { ...row, trigger: row.trigger_type, created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'AutomationRun') return { ...row, trigger: row.trigger_data?.trigger, created_date: row.created_at };
  if (name === 'Quote') return { ...row, customer_name: row.customer?.name || row.customer_name || null, seller: row.seller_name || row.seller_user_id || null, created_date: row.created_at, updated_date: row.updated_at };
  if (name === 'FinancialEntry') return { ...row, amount: row.total_amount ?? row.amount, created_date: row.created_at, updated_date: row.updated_at };
  return { ...row, created_date: row.created_at, updated_date: row.updated_at };
};
const columns = {
  Customer: ['company_id', 'name', 'document', 'email', 'phone', 'total_purchased', 'sale_count', 'avg_ticket'],
  Product: ['company_id', 'name', 'item_type', 'duration_minutes', 'sku', 'barcode', 'subcategory', 'brand', 'description', 'short_description', 'full_description', 'material', 'color', 'size', 'model', 'weight', 'dimensions', 'tags', 'keywords', 'featured', 'unit', 'commission_rate', 'cost', 'price', 'stock', 'minimum_stock', 'active'],
  Supplier: ['company_id', 'name', 'document', 'email', 'phone'],
  PurchaseOrder: ['company_id', 'supplier_id', 'status', 'total', 'expected_date'],
  PurchaseItem: ['company_id', 'purchase_id', 'product_id', 'quantity', 'cost'],
  Commission: ['company_id', 'sale_id', 'seller', 'rate', 'amount', 'status'],
  FinancialEntry: ['company_id', 'sale_id', 'purchase_id', 'type', 'nature', 'entry_class', 'capital_type', 'is_operating', 'status', 'description', 'category', 'amount', 'total_amount', 'received_amount', 'paid_amount', 'due_date', 'paid_date', 'paid_at', 'paid_by', 'source_type', 'source_detail', 'notes', 'account', 'payment_method', 'cancelled_at'],
  FinancialMovement: ['company_id', 'financial_entry_id', 'installment_id', 'direction', 'amount', 'payment_method', 'account', 'occurred_at', 'idempotency_key'],
  FinancialInstallment: ['company_id', 'financial_entry_id', 'installment_number', 'amount', 'received_amount', 'paid_amount', 'due_date', 'status'],
  Goal: ['company_id', 'name', 'type', 'target_value', 'period', 'start_date', 'end_date', 'user_id', 'status'],
  Conversation: ['company_id', 'customer_id', 'lead_name', 'lead_phone', 'lead_email', 'channel', 'status', 'assigned_user_id', 'subject', 'last_message_at'],
  Message: ['company_id', 'conversation_id', 'sender_type', 'sender_user_id', 'content', 'message_type', 'created_at'],
  Opportunity: ['company_id', 'customer_id', 'conversation_id', 'title', 'description', 'value', 'stage', 'assigned_user_id', 'source', 'expected_close_date'],
  Automation: ['company_id', 'name', 'active', 'trigger_type', 'conditions', 'actions', 'created_by', 'schedule_frequency', 'schedule_weekday', 'schedule_time', 'timezone', 'next_run_at', 'last_run_at', 'last_result', 'failure_count', 'retry_count', 'claim_token', 'claim_until', 'deleted_at'],
  AutomationRun: ['company_id', 'automation_id', 'status', 'trigger_data', 'result', 'error_message', 'idempotency_key'],
  IntelligenceInsight: ['company_id', 'type', 'severity', 'title', 'description', 'entity', 'entity_id', 'data', 'status', 'resolved_at'],
    CompanySubscription: ['company_id', 'plan', 'status', 'trial_started_at', 'trial_ends_at', 'trial_used', 'current_period_start', 'current_period_end'],
  CompanyInvite: ['company_id', 'email', 'role', 'token_hash', 'status', 'expires_at', 'invited_by'],
  Quote: ['company_id', 'customer_id', 'status', 'items', 'total', 'subtotal', 'discount', 'addition', 'valid_until', 'notes', 'seller_user_id', 'opportunity_id', 'approved_at', 'rejected_at', 'cancelled_at', 'converted_at'],
  ProductOpportunity: ['company_id', 'title', 'description', 'status', 'source', 'source_url', 'collected_at', 'source_type', 'confidence_level', 'scores', 'opportunity_score', 'supplier_score', 'trust_score', 'channel_score', 'metadata'],
  OpportunityProductDraft: ['company_id', 'opportunity_id', 'name', 'description', 'category', 'price', 'cost', 'stock', 'active', 'status'],
  SupplierIntelligence: ['company_id', 'supplier_id', 'reputation_score', 'history_score', 'price_score', 'delivery_score', 'returns_score', 'complaints_score', 'consistency_score', 'supplier_score', 'trust_score', 'trust_label', 'data_confidence', 'source_summary', 'metadata'],
  SupplierReview: ['company_id', 'supplier_id', 'rating', 'review_count', 'comment', 'reviewed_at', 'source', 'source_type', 'sentiment', 'recurring_issues'],
  SupplierRiskSignal: ['company_id', 'supplier_id', 'signal_type', 'severity', 'description', 'source', 'needs_validation', 'detected_at'],
  MarketSource: ['company_id', 'name', 'source_type', 'url', 'active', 'confidence', 'metadata'],
  MarketSignal: ['company_id', 'source_id', 'product_name', 'signal_type', 'value', 'unit', 'source', 'source_type', 'url', 'collected_at', 'confidence', 'metadata'],
  MarketOpportunity: ['company_id', 'product_name', 'trend', 'demand', 'competition', 'potential_margin', 'risk', 'estimated_capital', 'opportunity_score', 'trust_score', 'data_status', 'source_ids', 'metadata'],
  SalesChannel: ['company_id', 'name', 'channel_type', 'status', 'connected', 'external_account_id', 'metadata'],
  ProductChannel: ['company_id', 'product_id', 'channel_id', 'status', 'price', 'fee_rate', 'external_product_id', 'external_url'],
  ChannelMetric: ['company_id', 'channel_id', 'product_id', 'period_start', 'period_end', 'visits', 'orders', 'revenue', 'fees', 'margin', 'cancellations', 'returns', 'source'],
  CrmActivity: ['company_id', 'customer_id', 'opportunity_id', 'created_by', 'assigned_to', 'activity_type', 'status', 'title', 'description', 'due_at', 'completed_at', 'cancelled_at'],
  CommercialCampaign: ['company_id', 'name', 'description', 'campaign_type', 'base_period', 'compare_period', 'status', 'source_file_name', 'source_file_hash', 'created_by'],
  CommercialCampaignImport: ['company_id', 'campaign_id', 'file_name', 'file_hash', 'status', 'source_metadata', 'rows_total', 'rows_valid', 'rows_review', 'rows_rejected', 'created_by'],
  CommercialCampaignFact: ['company_id', 'campaign_id', 'import_id', 'customer_id', 'product_id', 'period_base', 'period_compare', 'source_sheet', 'source_row', 'source_customer_name', 'source_product_code', 'source_product_name', 'source_values', 'source_base_value', 'source_compare_value', 'source_difference', 'source_variation_pct', 'canonical_base_value', 'canonical_compare_value', 'canonical_difference', 'canonical_variation_pct', 'divergence', 'divergence_details', 'match_status', 'review_reason', 'idempotency_key'],
  CommercialCampaignTarget: ['company_id', 'campaign_id', 'import_id', 'fact_id', 'customer_id', 'product_id', 'source_sheet', 'source_row', 'imported_priority', 'f7_priority', 'status', 'reason', 'action', 'next_action', 'return_at', 'informed_recovery_amount', 'canonical_potential', 'match_status', 'review_reason', 'idempotency_key'],
  CommercialCampaignOutcome: ['company_id', 'campaign_id', 'target_id', 'crm_activity_id', 'quote_id', 'sale_id', 'informed_amount', 'confirmed_amount', 'confirmed_at', 'notes', 'created_by', 'idempotency_key'],
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
    async list(sort = 'created_at', limit = 500) { const ordering = normalizeSort(sort); const { data, error } = await getSupabaseClient().from(table).select('*').order(ordering.column, { ascending: !ordering.descending }).limit(limit); if (error) throw error; return (data || []).map((row) => normalize(name, row)); },
    async filter(filters = {}, sort = '-created_at', limit = 500) { let query = getSupabaseClient().from(table).select('*'); for (const [key, value] of Object.entries(filters)) query = value && typeof value === 'object' && value.lt ? query.lt(key, value.lt) : query.eq(key, value); const ordering = normalizeSort(sort, '-created_at'); const { data, error } = await query.order(ordering.column, { ascending: !ordering.descending }).limit(limit); if (error) throw error; return (data || []).map((row) => normalize(name, row)); },
    async listPage(filters = {}, sort = '-created_at', page = 1, pageSize = 50) { let query = getSupabaseClient().from(table).select('*', { count: 'exact' }); for (const [key, value] of Object.entries(filters)) query = value && typeof value === 'object' && value.lt ? query.lt(key, value.lt) : query.eq(key, value); const ordering = normalizeSort(sort, '-created_at'); const safePage = Math.max(1, Number(page) || 1); const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 50)); const { data, error, count } = await query.order(ordering.column, { ascending: !ordering.descending }).range((safePage - 1) * safeSize, safePage * safeSize - 1); if (error) throw error; return { rows: (data || []).map((row) => normalize(name, row)), count: count || 0, page: safePage, pageSize: safeSize }; },
    async get(id) { const { data, error } = await getSupabaseClient().from(table).select('*').eq('id', id).single(); if (error && error.code !== 'PGRST116') throw error; return normalize(name, data); },
    async create(payload) { const { data, error } = await getSupabaseClient().from(table).insert(payloadFor(name, payload)).select().single(); if (error) throw error; return normalize(name, data); },
    async update(id, payload) { const scopedPayload = payloadFor(name, payload); let query = getSupabaseClient().from(table).update(scopedPayload).eq('id', id); if (payload?.company_id) query = query.eq('company_id', payload.company_id); const { data, error } = await query.select().single(); if (error) throw error; return normalize(name, data); },
    async delete(id) { const { error } = await getSupabaseClient().from(table).delete().eq('id', id); if (error) throw error; },
  };
}
export const supabaseProvider = { entity, async rpc(name, params) { const { data, error } = await getSupabaseClient().rpc(name, params); if (error) throw error; return data; }, async listMembers(companyId) { const { data, error } = await getSupabaseClient().from('company_users').select('*').eq('company_id', companyId).order('created_at', { ascending: true }); if (error) throw error; const ids = (data || []).map((member) => member.user_id); if (!ids.length) return []; const profiles = await getSupabaseClient().from('profiles').select('id,name,email,avatar_url').in('id', ids); if (profiles.error) throw profiles.error; const byId = Object.fromEntries((profiles.data || []).map((profile) => [profile.id, profile])); return (data || []).map((member) => ({ ...member, ...(byId[member.user_id] || {}) })); } };
