import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

const PLANS = ['free', 'pro', 'business', 'premium'];
const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled'];
const COMPANY_ROLES = ['admin', 'gestor', 'financeiro', 'comercial', 'vendedor', 'estoque', 'atendimento'];
const PLATFORM_ROLES = ['owner', 'admin', 'support', 'readonly'];
const WRITE_ROLES = ['owner', 'admin'];

function clean(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function isWrite(action: string) { return ['update_company_plan', 'update_company_status', 'create_warning', 'resolve_warning', 'update_company_user', 'update_feature', 'update_ai', 'create_platform_admin', 'update_platform_admin'].includes(action); }
function assertCapability(role: string, action: string) {
  if (isWrite(action) && !WRITE_ROLES.includes(role)) throw Object.assign(new Error('PLATFORM_ADMIN_FORBIDDEN'), { status: 403 });
  if (['create_platform_admin', 'update_platform_admin'].includes(action) && role !== 'owner') throw Object.assign(new Error('PLATFORM_OWNER_REQUIRED'), { status: 403 });
}
async function one(client: any, table: string, columns: string, id: string) {
  const result = await client.from(table).select(columns).eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
async function audit(client: any, input: { admin_user_id: string; company_id?: string | null; action: string; entity: string; entity_id?: string | null; before_data?: unknown; after_data?: unknown; reason?: string }, req: Request) {
  const { error } = await client.from('platform_admin_audit_logs').insert({ ...input, reason: clean(input.reason, 1000) || null, ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null, user_agent: clean(req.headers.get('user-agent'), 300) || null });
  if (error) throw error;
}
async function companySummary(client: any, company: any) {
  const id = company.id;
  const [subscription, members, products, customers, sales, warnings, integrations, ai] = await Promise.all([
    client.from('company_subscriptions').select('plan,status,trial_ends_at,current_period_start,current_period_end').eq('company_id', id).maybeSingle(),
    client.from('company_users').select('id,active', { count: 'exact', head: false }).eq('company_id', id),
    client.from('products').select('id', { count: 'exact', head: true }).eq('company_id', id),
    client.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', id),
    client.from('sales').select('id', { count: 'exact', head: true }).eq('company_id', id),
    client.from('platform_company_warnings').select('id', { count: 'exact', head: true }).eq('company_id', id).eq('status', 'open'),
    client.from('company_integrations').select('provider,status,external_phone_id,external_account_id,updated_at').eq('company_id', id),
    client.from('company_assistant_settings').select('mode,automatic_reply_enabled,allow_web_research,allow_product_lookup,allow_price_lookup,allow_stock_lookup,max_daily_ai_calls,max_daily_web_queries,max_tokens_per_request').eq('company_id', id).maybeSingle(),
  ]);
  const firstError = [subscription, members, products, customers, sales, warnings, integrations, ai].find((item) => item.error);
  if (firstError) throw firstError.error;
  return { ...company, subscription: subscription.data, user_count: members.data?.filter((row: any) => row.active).length || 0, product_count: products.count || 0, customer_count: customers.count || 0, sales_count: sales.count || 0, open_warning_count: warnings.count || 0, integrations: integrations.data || [], ai: ai.data || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req);
    const service = admin();
    const identity = await service.auth.getUser(jwt);
    if (identity.error || !identity.data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
    const actor = identity.data.user;
    const adminRow = await service.from('platform_admins').select('id,role,status').eq('user_id', actor.id).eq('status', 'active').maybeSingle();
    if (adminRow.error) throw adminRow.error;
    if (!adminRow.data) return json({ error: 'PLATFORM_ADMIN_REQUIRED' }, 403);
    await service.from('platform_admins').update({ last_access_at: new Date().toISOString() }).eq('id', adminRow.data.id);
    const input = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = clean(input.action || 'access', 80);
    assertCapability(adminRow.data.role, action);

    if (action === 'access') return json({ is_platform_admin: true, role: adminRow.data.role });
    if (action === 'overview') {
      const [companies, members, subscriptions, integrations, ai, warnings, logs] = await Promise.all([
        service.from('companies').select('id,name,created_at,updated_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(100),
        service.from('company_users').select('id,company_id,user_id,active,role', { count: 'exact' }).limit(1000),
        service.from('company_subscriptions').select('company_id,plan,status'),
        service.from('company_integrations').select('company_id,provider,status'),
        service.from('company_assistant_settings').select('company_id,mode,automatic_reply_enabled'),
        service.from('platform_company_warnings').select('id,company_id,status,severity', { count: 'exact' }).eq('status', 'open'),
        service.from('integration_logs').select('status,created_at').order('created_at', { ascending: false }).limit(100),
      ]);
      const firstError = [companies, members, subscriptions, integrations, ai, warnings, logs].find((item) => item.error);
      if (firstError) throw firstError.error;
      const plans = new Map(subscriptions.data.map((row: any) => [row.company_id, row]));
      const rows = (companies.data || []).map((company: any) => ({ ...company, subscription: plans.get(company.id) || null, user_count: (members.data || []).filter((row: any) => row.company_id === company.id && row.active).length, whatsapp: (integrations.data || []).some((row: any) => row.company_id === company.id && row.provider === 'whatsapp' && ['connected', 'active', 'enabled'].includes(row.status)), ai_enabled: (ai.data || []).some((row: any) => row.company_id === company.id), open_warning_count: (warnings.data || []).filter((row: any) => row.company_id === company.id).length }));
      return json({ role: adminRow.data.role, metrics: { companies: companies.count || 0, users: (members.data || []).filter((row: any) => row.active).length, active_companies: rows.filter((row: any) => ['active', 'trial'].includes(row.subscription?.status)).length, trials: rows.filter((row: any) => row.subscription?.status === 'trial').length, suspended: rows.filter((row: any) => row.subscription?.status === 'suspended').length, cancelled: rows.filter((row: any) => row.subscription?.status === 'cancelled').length, whatsapp: (integrations.data || []).filter((row: any) => row.provider === 'whatsapp' && ['connected', 'active', 'enabled'].includes(row.status)).length, ai: (ai.data || []).filter((row: any) => row.automatic_reply_enabled || row.mode).length, warnings: warnings.count || 0, errors: (logs.data || []).filter((row: any) => ['error', 'failed'].includes(String(row.status).toLowerCase())).length }, companies: rows });
    }
    if (action === 'companies') {
      const page = Math.max(1, Number(input.page) || 1); const pageSize = Math.min(100, Math.max(10, Number(input.page_size) || 25));
      let query = service.from('companies').select('id,name,created_at,updated_at', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      if (clean(input.search, 120)) query = query.or(`name.ilike.%${clean(input.search, 80)}%,id.eq.${clean(input.search, 80)}`);
      const result = await query; if (result.error) throw result.error;
      return json({ rows: result.data || [], page, page_size: pageSize, total: result.count || 0 });
    }
    if (action === 'company') {
      const company = await one(service, 'companies', 'id,name,created_at,updated_at', clean(input.company_id, 80));
      if (!company) return json({ error: 'COMPANY_NOT_FOUND' }, 404);
      return json({ company: await companySummary(service, company) });
    }
    if (action === 'company_users') {
      const result = await service.from('company_users').select('id,company_id,user_id,role,active,created_at').eq('company_id', clean(input.company_id, 80)).order('created_at', { ascending: true });
      if (result.error) throw result.error;
      return json({ rows: result.data || [] });
    }
    if (action === 'warnings') {
      let query = service.from('platform_company_warnings').select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(100);
      if (input.company_id) query = query.eq('company_id', clean(input.company_id, 80));
      if (input.status) query = query.eq('status', clean(input.status, 30));
      const result = await query; if (result.error) throw result.error; return json({ rows: result.data || [], total: result.count || 0 });
    }
    if (action === 'audit') {
      const result = await service.from('platform_admin_audit_logs').select('id,admin_user_id,company_id,action,entity,entity_id,before_data,after_data,reason,created_at').order('created_at', { ascending: false }).limit(100);
      if (result.error) throw result.error; return json({ rows: result.data || [] });
    }
    if (action === 'update_company_plan' || action === 'update_company_status') {
      const companyId = clean(input.company_id, 80); const field = action.endsWith('plan') ? 'plan' : 'status'; const value = clean(input.value, 30); const allowed = field === 'plan' ? PLANS : STATUSES;
      if (!allowed.includes(value)) return json({ error: 'INVALID_VALUE' }, 422);
      const before = await service.from('company_subscriptions').select('company_id,plan,status').eq('company_id', companyId).maybeSingle(); if (before.error) throw before.error;
      const update = await service.from('company_subscriptions').upsert({ company_id: companyId, [field]: value, updated_at: new Date().toISOString() }, { onConflict: 'company_id' }).select('company_id,plan,status').single(); if (update.error) throw update.error;
      await audit(service, { admin_user_id: actor.id, company_id: companyId, action: `company.${field}.changed`, entity: 'company_subscriptions', entity_id: companyId, before_data: before.data, after_data: update.data, reason: input.reason }, req); return json({ subscription: update.data });
    }
    if (action === 'create_warning') {
      const payload = { company_id: clean(input.company_id, 80), severity: clean(input.severity || 'warning', 20), category: clean(input.category || 'Outros', 60), title: clean(input.title, 180), description: clean(input.description, 2000) || null, created_by: actor.id };
      if (!payload.company_id || !payload.title || !['info','warning','critical'].includes(payload.severity)) return json({ error: 'INVALID_WARNING' }, 422);
      const created = await service.from('platform_company_warnings').insert(payload).select('*').single(); if (created.error) throw created.error; await audit(service, { admin_user_id: actor.id, company_id: payload.company_id, action: 'company.warning.created', entity: 'platform_company_warnings', entity_id: created.data.id, after_data: created.data, reason: input.reason }, req); return json({ warning: created.data });
    }
    if (action === 'resolve_warning') {
      const warningId = clean(input.warning_id, 80); const before = await service.from('platform_company_warnings').select('*').eq('id', warningId).maybeSingle(); if (before.error) throw before.error; if (!before.data) return json({ error: 'WARNING_NOT_FOUND' }, 404);
      const updated = await service.from('platform_company_warnings').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: actor.id, resolution_notes: clean(input.resolution_notes, 2000) || null }).eq('id', warningId).select('*').single(); if (updated.error) throw updated.error; await audit(service, { admin_user_id: actor.id, company_id: before.data.company_id, action: 'company.warning.resolved', entity: 'platform_company_warnings', entity_id: warningId, before_data: before.data, after_data: updated.data, reason: input.reason }, req); return json({ warning: updated.data });
    }
    if (action === 'update_company_user') {
      const companyId = clean(input.company_id, 80); const membershipId = clean(input.membership_id, 80); const before = await service.from('company_users').select('id,company_id,user_id,role,active').eq('id', membershipId).eq('company_id', companyId).maybeSingle(); if (before.error) throw before.error; if (!before.data) return json({ error: 'MEMBERSHIP_NOT_FOUND' }, 404);
      const next: any = {}; if (input.role !== undefined) { if (!COMPANY_ROLES.includes(clean(input.role, 30))) return json({ error: 'INVALID_ROLE' }, 422); next.role = clean(input.role, 30); } if (input.active !== undefined) next.active = Boolean(input.active); const updated = await service.from('company_users').update(next).eq('id', membershipId).eq('company_id', companyId).select('id,company_id,user_id,role,active').single(); if (updated.error) throw updated.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: input.role !== undefined ? 'company_user.role_changed' : 'company_user.status_changed', entity: 'company_users', entity_id: membershipId, before_data: before.data, after_data: updated.data, reason: input.reason }, req); return json({ membership: updated.data });
    }
    if (action === 'features') { const result = await service.from('company_feature_overrides').select('company_id,feature,enabled,reason,updated_at').eq('company_id', clean(input.company_id, 80)); if (result.error) throw result.error; return json({ rows: result.data || [] }); }
    if (action === 'update_feature') { const companyId = clean(input.company_id, 80); const feature = clean(input.feature, 80).toLowerCase(); if (!feature) return json({ error: 'INVALID_FEATURE' }, 422); if (input.enabled === null) { const removed = await service.from('company_feature_overrides').delete().eq('company_id', companyId).eq('feature', feature); if (removed.error) throw removed.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: 'company.feature.removed', entity: 'company_feature_overrides', entity_id: feature, reason: input.reason }, req); return json({ removed: true }); } const result = await service.from('company_feature_overrides').upsert({ company_id: companyId, feature, enabled: Boolean(input.enabled), reason: clean(input.reason, 500) || null, updated_at: new Date().toISOString() }, { onConflict: 'company_id,feature' }).select('*').single(); if (result.error) throw result.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: input.enabled ? 'company.feature.enabled' : 'company.feature.disabled', entity: 'company_feature_overrides', entity_id: feature, after_data: result.data, reason: input.reason }, req); return json({ override: result.data }); }
    if (action === 'ai') { const result = await service.from('company_assistant_settings').select('company_id,mode,automatic_reply_enabled,allow_web_research,allow_product_lookup,allow_price_lookup,allow_stock_lookup,allow_customer_lookup,allow_quote_draft,max_daily_ai_calls,max_daily_web_queries,max_tokens_per_request').eq('company_id', clean(input.company_id, 80)).maybeSingle(); if (result.error) throw result.error; return json({ settings: result.data }); }
    if (action === 'update_ai') { const companyId = clean(input.company_id, 80); const allowed = ['mode','automatic_reply_enabled','allow_web_research','allow_product_lookup','allow_price_lookup','allow_stock_lookup','allow_customer_lookup','allow_quote_draft','max_daily_ai_calls','max_daily_web_queries','max_tokens_per_request']; const payload: any = {}; for (const field of allowed) if (input[field] !== undefined) payload[field] = ['max_daily_ai_calls','max_daily_web_queries','max_tokens_per_request'].includes(field) ? Math.max(0, Number(input[field]) || 0) : input[field]; const before = await service.from('company_assistant_settings').select(allowed.join(',')).eq('company_id', companyId).maybeSingle(); if (before.error) throw before.error; const result = await service.from('company_assistant_settings').update(payload).eq('company_id', companyId).select(allowed.join(',')).single(); if (result.error) throw result.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: 'company.ai_limit.changed', entity: 'company_assistant_settings', entity_id: companyId, before_data: before.data, after_data: result.data, reason: input.reason }, req); return json({ settings: result.data }); }
    if (action === 'platform_admins') { if (!['owner','admin'].includes(adminRow.data.role)) throw Object.assign(new Error('PLATFORM_ADMIN_FORBIDDEN'), { status: 403 }); const result = await service.from('platform_admins').select('id,user_id,role,status,created_at,created_by,last_access_at').order('created_at', { ascending: true }); if (result.error) throw result.error; return json({ rows: result.data || [] }); }
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    const status = Number((error as any)?.status) || (String((error as any)?.message) === 'AUTH_REQUIRED' ? 401 : 500);
    return json({ error: status === 500 ? 'PLATFORM_ADMIN_PROVIDER_ERROR' : clean((error as any)?.message, 80) }, status);
  }
});
