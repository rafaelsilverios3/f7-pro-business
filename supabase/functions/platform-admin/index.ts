// Platform administration is always deployed with JWT verification enabled.
import { admin, auth, corsHeaders, json, userClient } from '../_shared/core.ts';
import { validateAiRateCard, validateAiRateCardEnabled, validateCompanyAiBudget } from '../_shared/platformAiFinancialPolicy.js';
import { isPlatformAdminCurrent, normalizePlatformAdminExpiry, platformAdminCanAccessAction, PLATFORM_ROLES } from '../_shared/platformAdminAccess.js';
import { getCompanyAiOverview } from '../_shared/platformAiOverview.js';

const PLANS = ['free', 'pro', 'business', 'premium'];
const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled'];
const COMPANY_ROLES = ['admin', 'gestor', 'financeiro', 'comercial', 'vendedor', 'estoque', 'atendimento'];

function clean(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function assertCapability(role: string, action: string) {
  if (platformAdminCanAccessAction(role, action)) return;
  const message = role === 'support' ? 'PLATFORM_SUPPORT_SCOPE_DENIED'
    : role === 'readonly' ? 'PLATFORM_READ_SCOPE_DENIED'
    : ['create_platform_admin', 'update_platform_admin'].includes(action) ? 'PLATFORM_OWNER_REQUIRED'
    : 'PLATFORM_ADMIN_FORBIDDEN';
  throw Object.assign(new Error(message), { status: 403 });
}
async function one(client: any, table: string, columns: string, id: string) {
  const result = await client.from(table).select(columns).eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
async function audit(client: any, input: { admin_user_id: string; company_id?: string | null; action: string; entity: string; entity_id?: string | null; before_data?: unknown; after_data?: unknown; reason?: string }, req: Request) {
  const { error } = await client.from('platform_admin_audit_logs').insert({ ...input, actor_kind: 'platform_admin', actor_reference: null, reason: clean(input.reason, 1000) || null, ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null, user_agent: clean(req.headers.get('user-agent'), 300) || null });
  if (error) throw error;
}
async function companySummary(client: any, company: any) {
  const id = company.id;
  const [subscription, manualGrant, members, products, customers, sales, warnings, integrations, ai] = await Promise.all([
    client.from('company_subscriptions').select('plan,status,trial_ends_at,current_period_start,current_period_end,billing_model,billing_checkout_id').eq('company_id', id).maybeSingle(),
    client.from('company_plan_grants').select('id,plan_code,grant_type,starts_at,ends_at,granted_by,reason').eq('company_id', id).is('revoked_at', null).lte('starts_at', new Date().toISOString()).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).order('starts_at', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('company_users').select('id,active', { count: 'exact', head: false }).eq('company_id', id),
    client.from('products').select('id', { count: 'exact', head: true }).eq('company_id', id),
    client.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', id),
    client.from('sales').select('id', { count: 'exact', head: true }).eq('company_id', id),
    client.from('platform_company_warnings').select('id', { count: 'exact', head: true }).eq('company_id', id).eq('status', 'open'),
    client.from('company_integrations').select('provider,status,external_phone_id,external_account_id,updated_at').eq('company_id', id),
    client.from('company_assistant_settings').select('mode,automatic_reply_enabled,allow_web_research,allow_product_lookup,allow_price_lookup,allow_stock_lookup,max_daily_ai_calls,max_daily_web_queries,max_tokens_per_request').eq('company_id', id).maybeSingle(),
  ]);
  const firstError = [subscription, manualGrant, members, products, customers, sales, warnings, integrations, ai].find((item) => item.error);
  if (firstError) throw firstError.error;
  const accessSubscription = manualGrant.data ? { ...(subscription.data || {}), plan: manualGrant.data.plan_code, status: 'active', current_period_end: manualGrant.data.ends_at, access_origin: manualGrant.data.grant_type, manual_grant: manualGrant.data, paid_subscription: subscription.data } : { ...(subscription.data || {}), access_origin: subscription.data?.billing_checkout_id ? 'paid' : 'legacy' };
  return { ...company, subscription: accessSubscription, user_count: members.data?.filter((row: any) => row.active).length || 0, product_count: products.count || 0, customer_count: customers.count || 0, sales_count: sales.count || 0, open_warning_count: warnings.count || 0, integrations: integrations.data || [], ai: ai.data || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req);
    const service = admin();
    const identity = await service.auth.getUser(jwt);
    if (identity.error || !identity.data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
    const actor = identity.data.user;
    const adminRow = await service.from('platform_admins').select('id,role,status,expires_at').eq('user_id', actor.id).eq('status', 'active').maybeSingle();
    if (adminRow.error) throw adminRow.error;
    if (!adminRow.data || !isPlatformAdminCurrent(adminRow.data)) return json({ error: 'PLATFORM_ADMIN_REQUIRED' }, 403);
    await service.from('platform_admins').update({ last_access_at: new Date().toISOString() }).eq('id', adminRow.data.id);
    const input = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = clean(input.action || 'access', 80);
    assertCapability(adminRow.data.role, action);
    if (['support', 'readonly'].includes(adminRow.data.role)) {
      await audit(service, { admin_user_id: actor.id, action: 'platform_admin.read', entity: 'platform_admin_api', entity_id: action, after_data: { action }, reason: 'Scoped read access' }, req);
    }
    if (['ai_financial_rates', 'ai_financial_usage'].includes(action) && !['support', 'readonly'].includes(adminRow.data.role)) {
      await audit(service, { admin_user_id: actor.id, company_id: action === 'ai_financial_usage' ? clean(input.company_id, 80) || null : null, action: 'platform_admin.ai_financial.read', entity: 'ai_financial_admin', entity_id: action, after_data: { action }, reason: 'Financial AI data read' }, req);
    }

    if (action === 'access') return json({ is_platform_admin: true, role: adminRow.data.role });
    if (action === 'product_commerce_overview') {
      const [products, offers, accounts, licenses, companies, licenseEvents, checkouts, webhookEvents, foodDeliveries] = await Promise.all([
        service.from('product_catalog').select('product_key,name,description,access_url,active,sort_order').order('sort_order'),
        service.from('product_offers').select('id,product_key,offer_code,name,description,price_minor,currency,billing_period,trial_days,features,active,sort_order').order('product_key').order('sort_order'),
        service.from('commercial_accounts').select('id,display_name,created_at').order('created_at', { ascending: false }).limit(500),
        service.from('commercial_product_licenses').select('id,commercial_account_id,product_key,offer_id,status,starts_at,ends_at,source,updated_at').order('updated_at', { ascending: false }).limit(1000),
        service.from('companies').select('id,name'),
        service.from('commercial_product_license_events').select('id,commercial_account_id,license_id,product_key,actor_id,action,reason,before_state,after_state,command_id,occurred_at').order('occurred_at', { ascending: false }).limit(100),
        service.from('product_checkout_sessions').select('id,commercial_account_id,offer_id,product_key,amount_minor,currency,billing_period,status,provider,provider_checkout_id,provider_payment_id,created_at,updated_at').order('created_at', { ascending: false }).limit(100),
        service.from('product_checkout_webhook_events').select('id,provider,provider_event_id,checkout_id,event_type,status,received_at,processed_at').order('received_at', { ascending: false }).limit(100),
        service.from('product_license_delivery_outbox').select('id,license_id,commercial_account_id,food_company_id,status,attempts,last_http_status,last_error,remote_license_id,delivered_at,created_at,updated_at').order('created_at', { ascending: false }).limit(100),
      ]);
      const failed = [products, offers, accounts, licenses, companies, licenseEvents, checkouts, webhookEvents, foodDeliveries].find((item) => item.error);
      if (failed) throw failed.error;
      const offerMap = new Map((offers.data || []).map((offer: any) => [offer.id, offer]));
      const accountMap = new Map((accounts.data || []).map((account: any) => [account.id, account]));
      const companyMap = new Map((companies.data || []).map((company: any) => [company.id, company.name]));
      return json({
        products: products.data || [], offers: offers.data || [], accounts: accounts.data || [],
        licenses: (licenses.data || []).map((license: any) => ({ ...license, account_name: accountMap.get(license.commercial_account_id)?.display_name || 'Conta comercial', offer: offerMap.get(license.offer_id) || null, pro_company_name: license.pro_company_id ? companyMap.get(license.pro_company_id) || null : null })),
        license_events: (licenseEvents.data || []).map((event: any) => ({ ...event, account_name: accountMap.get(event.commercial_account_id)?.display_name || 'Conta comercial' })),
        checkouts: (checkouts.data || []).map((checkout: any) => ({ ...checkout, account_name: accountMap.get(checkout.commercial_account_id)?.display_name || 'Conta comercial', offer: offerMap.get(checkout.offer_id) || null })),
        webhook_events: webhookEvents.data || [],
        food_license_deliveries: (foodDeliveries.data || []).map((row: any) => ({ ...row, account_name: accountMap.get(row.commercial_account_id)?.display_name || 'Conta comercial' })),
      });
    }
    if (action === 'product_commerce_set_offer') {
      const offerId = uuid(input.offer_id);
      const result = await service.rpc('product_platform_admin_set_offer', {
        p_offer_id: offerId, p_product_key: clean(input.product_key, 40), p_offer_code: clean(input.offer_code, 40),
        p_name: clean(input.name, 100), p_description: clean(input.description, 1000),
        p_price_minor: input.price_minor === '' || input.price_minor == null ? null : Number(input.price_minor),
        p_billing_period: clean(input.billing_period, 10), p_trial_days: Number(input.trial_days || 0),
        p_features: input.features && typeof input.features === 'object' ? input.features : {}, p_active: input.active !== false,
      });
      if (result.error) throw result.error;
      await audit(service, { admin_user_id: actor.id, action: offerId ? 'product.offer.updated' : 'product.offer.created', entity: 'product_offers', entity_id: result.data?.id || null, after_data: result.data, reason: clean(input.reason, 1000) || 'Product offer administration' }, req);
      return json({ offer: result.data });
    }
    if (action === 'product_commerce_set_license') {
      const accountId = uuid(input.commercial_account_id); const offerId = uuid(input.offer_id); const commandId = uuid(input.command_id);
      if (!accountId || !offerId || !commandId) return json({ error: 'PRODUCT_LICENSE_INPUT_INVALID' }, 422);
      const result = await service.rpc('product_platform_admin_set_license', {
        p_account_id: accountId, p_product_key: clean(input.product_key, 40), p_offer_id: offerId,
        p_status: clean(input.status, 20), p_starts_at: input.starts_at || new Date().toISOString(),
        p_ends_at: input.ends_at || null, p_reason: clean(input.reason, 500), p_command_id: commandId, p_actor_id: actor.id,
      });
      if (result.error) throw result.error;
      return json({ license: result.data });
    }
    if (action === 'overview') {
      const [companies, members, subscriptions, manualGrants, integrations, ai, warnings, logs, catalogPlans, planFeatures, featureOverrides] = await Promise.all([
        service.from('companies').select('id,name,created_at,updated_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(100),
        service.from('company_users').select('id,company_id,user_id,active,role', { count: 'exact' }).limit(1000),
        service.from('company_subscriptions').select('company_id,plan,status,current_period_end'),
        service.from('company_plan_grants').select('id,company_id,plan_code,grant_type,starts_at,ends_at,granted_by,reason,created_at').is('revoked_at', null).lte('starts_at', new Date().toISOString()).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).order('starts_at', { ascending: false }).order('created_at', { ascending: false }),
        service.from('company_integrations').select('company_id,provider,status'),
        service.from('company_assistant_settings').select('company_id,mode,automatic_reply_enabled'),
        service.from('platform_company_warnings').select('id,company_id,status,severity', { count: 'exact' }).eq('status', 'open'),
        service.from('integration_logs').select('status,created_at').order('created_at', { ascending: false }).limit(100),
        service.from('plans').select('id,code,active'),
        service.from('plan_features').select('plan_id,feature,enabled').in('feature', ['ai','ai_sales']),
        service.from('company_feature_overrides').select('company_id,feature,enabled').in('feature', ['ai','ai_sales']),
      ]);
      const firstError = [companies, members, subscriptions, manualGrants, integrations, ai, warnings, logs, catalogPlans, planFeatures, featureOverrides].find((item) => item.error);
      if (firstError) throw firstError.error;
      const plans = new Map((subscriptions.data || []).map((row: any) => [row.company_id, row]));
      const currentManualGrants = new Map((manualGrants.data || []).map((row: any) => [row.company_id, row]));
      const planById = new Map((catalogPlans.data || []).map((row: any) => [row.id, row]));
      const planByCode = new Map((catalogPlans.data || []).map((row: any) => [row.code, row]));
      const planFeatureRows = (planFeatures.data || []).map((row: any) => ({ ...row, plan_code: planById.get(row.plan_id)?.code, plan_active: planById.get(row.plan_id)?.active === true }));
      const providerStatus = {
        enabled: Deno.env.get('AI_ENABLED')?.trim().toLowerCase() === 'true',
        configured: Boolean(Deno.env.get('AI_API_KEY')?.trim() && Deno.env.get('AI_MODEL')?.trim()),
        maintenance: Deno.env.get('AI_MAINTENANCE_MODE')?.trim().toLowerCase() === 'true',
      };
      const rows = (companies.data || []).map((company: any) => {
        const paidSubscription = plans.get(company.id) || null;
        const manualGrant = currentManualGrants.get(company.id) || null;
        const subscription = manualGrant
          ? { ...(paidSubscription || {}), plan: manualGrant.plan_code, status: 'active', current_period_end: manualGrant.ends_at, access_origin: manualGrant.grant_type === 'lifetime' ? 'lifetime' : manualGrant.grant_type, manual_grant: manualGrant }
          : paidSubscription;
        const companySettings = (ai.data || []).find((row: any) => row.company_id === company.id) || null;
        const planCode = subscription?.plan || 'free';
        const aiOverview = getCompanyAiOverview({
          subscription,
          planCode,
          planActive: planByCode.get(planCode)?.active === true,
          planFeatures: planFeatureRows.filter((row: any) => row.plan_code === planCode) as any[],
          overrides: (featureOverrides.data || []).filter((row: any) => row.company_id === company.id) as any[],
          assistantSettings: companySettings as any,
          provider: providerStatus,
        });
        return {
          ...company,
          subscription,
          user_count: (members.data || []).filter((row: any) => row.company_id === company.id && row.active).length,
          whatsapp: (integrations.data || []).some((row: any) => row.company_id === company.id && row.provider === 'whatsapp' && ['connected', 'active', 'enabled'].includes(row.status)),
          ai_enabled: aiOverview.state === 'assisted_ready',
          ai_overview: aiOverview,
          open_warning_count: (warnings.data || []).filter((row: any) => row.company_id === company.id).length,
        };
      });
      return json({ role: adminRow.data.role, metrics: { companies: companies.count || 0, users: (members.data || []).filter((row: any) => row.active).length, active_companies: rows.filter((row: any) => ['active', 'trial'].includes(row.subscription?.status)).length, trials: rows.filter((row: any) => row.subscription?.status === 'trial').length, suspended: rows.filter((row: any) => row.subscription?.status === 'suspended').length, cancelled: rows.filter((row: any) => row.subscription?.status === 'cancelled').length, whatsapp: (integrations.data || []).filter((row: any) => row.provider === 'whatsapp' && ['connected', 'active', 'enabled'].includes(row.status)).length, ai: rows.filter((row: any) => row.ai_enabled).length, warnings: warnings.count || 0, errors: (logs.data || []).filter((row: any) => ['error', 'failed'].includes(String(row.status).toLowerCase())).length }, companies: rows });
    }
    if (action === 'companies') {
      const page = Math.max(1, Number(input.page) || 1); const pageSize = Math.min(100, Math.max(10, Number(input.page_size) || 25));
      let query = service.from('companies').select('id,name,created_at,updated_at', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      if (clean(input.search, 120)) query = query.or(`name.ilike.%${clean(input.search, 80)}%,id.eq.${clean(input.search, 80)}`);
      const result = await query; if (result.error) throw result.error;
      return json({ rows: result.data || [], page, page_size: pageSize, total: result.count || 0 });
    }
    if (action === 'users') {
      const [members, companies, authUsers] = await Promise.all([
        service.from('company_users').select('id,company_id,user_id,role,active,created_at').order('created_at', { ascending: false }).limit(5000),
        service.from('companies').select('id,name'),
        service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      const firstError = [members, companies, authUsers].find((item: any) => item.error);
      if (firstError) throw firstError.error;
      const companyMap = new Map((companies.data || []).map((row: any) => [row.id, row.name]));
      const userMap = new Map((authUsers.data?.users || []).map((row: any) => [row.id, row]));
      const rows = (members.data || []).map((member: any) => ({ ...member, company_name: companyMap.get(member.company_id) || '—', user: userMap.get(member.user_id) ? { id: member.user_id, email: userMap.get(member.user_id).email, name: userMap.get(member.user_id).user_metadata?.full_name || userMap.get(member.user_id).user_metadata?.name || userMap.get(member.user_id).email } : { id: member.user_id, email: null, name: null } }));
      return json({ rows });
    }
    if (action === 'subscriptions') {
      const [companies, subscriptions] = await Promise.all([
        service.from('companies').select('id,name,created_at').order('created_at', { ascending: false }),
        service.from('company_subscriptions').select('company_id,plan,status,trial_ends_at,current_period_start,current_period_end,billing_model,billing_checkout_id,updated_at'),
      ]);
      const firstError = [companies, subscriptions].find((item: any) => item.error);
      if (firstError) throw firstError.error;
      const subscriptionMap = new Map((subscriptions.data || []).map((row: any) => [row.company_id, row]));
      return json({ rows: (companies.data || []).map((company: any) => ({ ...company, subscription: subscriptionMap.get(company.id) || null })) });
    }
    if (action === 'plan_grants') {
      const companyId = clean(input.company_id, 80);
      let query = service.from('company_plan_grants').select('id,company_id,plan_code,grant_type,starts_at,ends_at,granted_by,reason,revoked_at,revoked_by,revoke_reason,created_at').order('created_at', { ascending: false }).limit(500);
      if (companyId) query = query.eq('company_id', companyId);
      const result = await query;
      if (result.error) throw result.error;
      const companyRows = companyId ? [] : await service.from('companies').select('id,name');
      if (companyRows.error) throw companyRows.error;
      const companyNames = new Map((companyRows.data || []).map((row: any) => [row.id, row.name]));
      return json({ rows: (result.data || []).map((row: any) => ({ ...row, company_name: companyNames.get(row.company_id) || null, effective_now: !row.revoked_at && Date.parse(row.starts_at) <= Date.now() && (!row.ends_at || Date.parse(row.ends_at) > Date.now()), state: row.revoked_at ? 'revoked' : Date.parse(row.starts_at) > Date.now() ? 'scheduled' : row.ends_at && Date.parse(row.ends_at) <= Date.now() ? 'expired' : 'active' })) });
    }
    if (action === 'create_plan_grant') {
      const result = await userClient(jwt).rpc('platform_admin_create_plan_grant', {
        p_company_id: clean(input.company_id, 80),
        p_plan_code: clean(input.plan_code, 30).toLowerCase(),
        p_grant_type: clean(input.grant_type, 30).toLowerCase(),
        p_starts_at: input.starts_at,
        p_ends_at: input.ends_at || null,
        p_reason: clean(input.reason, 500),
      });
      if (result.error) return json({ error: clean(result.error.message, 120) || 'PLAN_GRANT_FAILED' }, result.error.code === '42501' ? 403 : 422);
      return json(result.data);
    }
    if (action === 'revoke_plan_grant') {
      const result = await userClient(jwt).rpc('platform_admin_revoke_plan_grant', { p_grant_id: clean(input.grant_id, 80), p_reason: clean(input.reason, 500) });
      if (result.error) return json({ error: clean(result.error.message, 120) || 'PLAN_GRANT_FAILED' }, result.error.code === '42501' ? 403 : 422);
      return json(result.data);
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
      const result = await service.from('platform_admin_audit_logs').select('id,admin_user_id,actor_kind,actor_reference,company_id,action,entity,entity_id,before_data,after_data,reason,created_at').order('created_at', { ascending: false }).limit(100);
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
    if (action === 'features') { let query = service.from('company_feature_overrides').select('company_id,feature,enabled,reason,updated_at'); if (input.company_id) query = query.eq('company_id', clean(input.company_id, 80)); const result = await query; if (result.error) throw result.error; if (!input.company_id) { const companies = await service.from('companies').select('id,name'); if (companies.error) throw companies.error; const names = new Map((companies.data || []).map((row: any) => [row.id, row.name])); return json({ rows: (result.data || []).map((row: any) => ({ ...row, company_name: names.get(row.company_id) || '—' })) }); } return json({ rows: result.data || [] }); }
    if (action === 'update_feature') { const companyId = clean(input.company_id, 80); const feature = clean(input.feature, 80).toLowerCase(); if (!feature) return json({ error: 'INVALID_FEATURE' }, 422); if (input.enabled === null) { const removed = await service.from('company_feature_overrides').delete().eq('company_id', companyId).eq('feature', feature); if (removed.error) throw removed.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: 'company.feature.removed', entity: 'company_feature_overrides', entity_id: feature, reason: input.reason }, req); return json({ removed: true }); } const result = await service.from('company_feature_overrides').upsert({ company_id: companyId, feature, enabled: Boolean(input.enabled), reason: clean(input.reason, 500) || null, updated_at: new Date().toISOString() }, { onConflict: 'company_id,feature' }).select('*').single(); if (result.error) throw result.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: input.enabled ? 'company.feature.enabled' : 'company.feature.disabled', entity: 'company_feature_overrides', entity_id: feature, after_data: result.data, reason: input.reason }, req); return json({ override: result.data }); }
    if (action === 'ai') { let query = service.from('company_assistant_settings').select('company_id,mode,automatic_reply_enabled,allow_web_research,allow_product_lookup,allow_price_lookup,allow_stock_lookup,allow_customer_lookup,allow_quote_draft,max_daily_ai_calls,max_daily_web_queries,max_tokens_per_request'); if (input.company_id) { const result = await query.eq('company_id', clean(input.company_id, 80)).maybeSingle(); if (result.error) throw result.error; return json({ settings: result.data }); } const result = await query; if (result.error) throw result.error; const companies = await service.from('companies').select('id,name'); if (companies.error) throw companies.error; const names = new Map((companies.data || []).map((row: any) => [row.id, row.name])); return json({ rows: (result.data || []).map((row: any) => ({ ...row, company_name: names.get(row.company_id) || '—' })) }); }
    if (action === 'update_ai') { const companyId = clean(input.company_id, 80); const allowed = ['mode','automatic_reply_enabled','allow_web_research','allow_product_lookup','allow_price_lookup','allow_stock_lookup','allow_customer_lookup','allow_quote_draft']; const payload: any = {}; for (const field of allowed) if (input[field] !== undefined) payload[field] = input[field]; if (!Object.keys(payload).length) return json({ error: 'AI_FINANCIAL_CONTROLS_REQUIRE_FINANCIAL_ACTION' }, 422); const before = await service.from('company_assistant_settings').select(allowed.join(',')).eq('company_id', companyId).maybeSingle(); if (before.error) throw before.error; const result = await service.from('company_assistant_settings').update(payload).eq('company_id', companyId).select(allowed.join(',')).single(); if (result.error) throw result.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: 'company.ai_settings.changed', entity: 'company_assistant_settings', entity_id: companyId, before_data: before.data, after_data: result.data, reason: input.reason }, req); return json({ settings: result.data }); }
    if (action === 'ai_financial_rates' || action === 'ai_financial_usage' || action === 'ai_financial_budget' || action === 'ai_financial_rate_create' || action === 'ai_financial_rate_enable') {
      // Keep the source tables revoked from service_role. The caller JWT reaches
      // tightly-scoped SECURITY DEFINER RPCs that re-check owner/admin in SQL.
      const caller = userClient(jwt);
      if (action === 'ai_financial_budget') {
        const validation = validateCompanyAiBudget({ ...input, reason: clean(input.reason, 500) });
        if (!validation.allowed) return json({ error: validation.reason }, 422);
      }
      if (action === 'ai_financial_rate_create') {
        const validation = validateAiRateCard({ ...input, reason: clean(input.reason, 500) });
        if (!validation.allowed) return json({ error: validation.reason }, 422);
      }
      if (action === 'ai_financial_rate_enable') {
        const validation = validateAiRateCardEnabled({ ...input, reason: clean(input.reason, 500) });
        if (!validation.allowed) return json({ error: validation.reason }, 422);
      }
      const procedures: Record<string, [string, Record<string, unknown>]> = {
        ai_financial_rates: ['platform_admin_ai_list_rate_cards', {}],
        ai_financial_usage: ['platform_admin_ai_company_financial_usage', { target_company: clean(input.company_id, 80) }],
        ai_financial_budget: ['platform_admin_ai_set_company_budget', { target_company: clean(input.company_id, 80), consumption_enabled: input.consumption_enabled, target_daily_calls: input.daily_calls, target_daily_web_queries: input.daily_web_queries, target_daily_budget: input.daily_budget, target_currency: input.currency, target_max_tokens: input.max_tokens_per_request, audit_reason: clean(input.reason, 500), target_clear_budget: input.clear_budget === true }],
        ai_financial_rate_create: ['platform_admin_ai_create_rate_card', { target_rate_kind: input.rate_kind, target_provider: input.provider_key, target_model: input.model_key || null, target_version: input.rate_version, target_currency: input.currency, target_input_cost: input.input_cost_per_1k ?? null, target_output_cost: input.output_cost_per_1k ?? null, target_query_cost: input.cost_per_query ?? null, target_source_reference: input.source_reference, target_effective_from: input.effective_from, target_effective_until: input.effective_until || null, target_enabled: input.enabled, audit_reason: clean(input.reason, 500) }],
        ai_financial_rate_enable: ['platform_admin_ai_set_rate_card_enabled', { target_rate_card: clean(input.rate_card_id, 80), target_enabled: input.enabled, audit_reason: clean(input.reason, 500) }],
      };
      const [procedure, args] = procedures[action];
      const { data, error } = await caller.rpc(procedure, args);
      if (error) {
        const code = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '23505' ? 409 : error.code === '22023' ? 422 : 500;
        const allowedErrors = ['PLATFORM_ADMIN_FORBIDDEN','AI_FINANCIAL_COMPANY_REQUIRED','AI_FINANCIAL_COMPANY_NOT_FOUND','AI_FINANCIAL_REASON_REQUIRED','AI_FINANCIAL_CONFIG_INVALID','AI_FINANCIAL_ACTIVE_RATE_REQUIRED','AI_FINANCIAL_RATE_OVERLAP','AI_FINANCIAL_RATE_NOT_FOUND','AI_FINANCIAL_RATE_NOT_EFFECTIVE'];
        const message = allowedErrors.includes(error.message) ? error.message : 'AI_FINANCIAL_OPERATION_FAILED';
        return json({ error: message }, code);
      }
      if (action === 'ai_financial_rates') return json({ rows: data || [] });
      if (action === 'ai_financial_usage') return json({ usage: data });
      if (action === 'ai_financial_budget') return json({ settings: data });
      if (action === 'ai_financial_rate_create') return json({ rate_card: data });
      return json({ rate_card: data });
    }
    if (action === 'whatsapp') { let query = service.from('company_integrations').select('company_id,provider,status,external_phone_id,external_account_id,external_business_id,updated_at').eq('provider', 'whatsapp'); if (input.company_id) { const result = await query.eq('company_id', clean(input.company_id, 80)).maybeSingle(); if (result.error) throw result.error; return json({ integration: result.data }); } const result = await query; if (result.error) throw result.error; const companies = await service.from('companies').select('id,name'); if (companies.error) throw companies.error; const names = new Map((companies.data || []).map((row: any) => [row.id, row.name])); return json({ rows: (result.data || []).map((row: any) => ({ ...row, company_name: names.get(row.company_id) || '—' })) }); }
    if (action === 'disable_whatsapp') { const companyId = clean(input.company_id, 80); const before = await service.from('company_integrations').select('provider,status,external_phone_id,external_account_id,external_business_id').eq('company_id', companyId).eq('provider', 'whatsapp').maybeSingle(); if (before.error) throw before.error; const result = await service.from('company_integrations').update({ status: input.enabled === false ? 'disabled' : 'active', updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('provider', 'whatsapp').select('provider,status,external_phone_id,external_account_id,external_business_id').maybeSingle(); if (result.error) throw result.error; await audit(service, { admin_user_id: actor.id, company_id: companyId, action: input.enabled === false ? 'company.whatsapp.disabled' : 'company.whatsapp.enabled', entity: 'company_integrations', entity_id: companyId, before_data: before.data, after_data: result.data, reason: input.reason }, req); return json({ integration: result.data }); }
    if (action === 'finance') return json({ available: false, source: 'platform_billing', reason: 'BILLING_INTEGRATION_REQUIRED', message: 'Dados de faturamento da plataforma estarão disponíveis após a integração do sistema de cobrança.', summary: null, rows: [] });
    if (action === 'usage') { const companyId = clean(input.company_id, 80); const [aiRuns, integrationLogs, automations] = await Promise.all([service.from('ai_runs').select('id,status,created_at,cost_usd,tokens_used').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100), service.from('integration_logs').select('provider,status,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100), service.from('automation_runs').select('id,status,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100)]); const firstError = [aiRuns, integrationLogs, automations].find((item) => item.error); if (firstError) throw firstError.error; return json({ ai_runs: aiRuns.data || [], integration_logs: integrationLogs.data || [], automation_runs: automations.data || [] }); }
    if (action === 'health') { const [companies, errors, integrations] = await Promise.all([service.from('companies').select('id', { count: 'exact', head: true }), service.from('integration_logs').select('id,status,created_at').in('status', ['error', 'failed']).order('created_at', { ascending: false }).limit(20), service.from('company_integrations').select('provider,status,updated_at').limit(500)]); const firstError = [companies, errors, integrations].find((item) => item.error); if (firstError) throw firstError.error; return json({ checks: [{ key: 'database', status: 'ok' }, { key: 'companies', status: (companies.count || 0) >= 0 ? 'ok' : 'unknown' }, { key: 'integrations', status: (integrations.data || []).some((row: any) => row.status === 'error') ? 'attention' : 'ok' }], recent_errors: errors.data || [] }); }
    if (action === 'data') { const allowedTables: Record<string, string> = { companies: 'id,name,created_at,updated_at', company_users: 'id,company_id,user_id,role,active,created_at', company_subscriptions: 'company_id,plan,status,trial_ends_at,updated_at', company_feature_overrides: 'company_id,feature,enabled,reason,updated_at', company_assistant_settings: 'company_id,mode,automatic_reply_enabled,allow_web_research,max_daily_ai_calls,max_daily_web_queries', products: 'id,company_id,name,sku,price,cost,stock,minimum_stock,active', customers: 'id,company_id,name,email,phone,created_at', sales: 'id,company_id,status,total,sale_date,created_at' }; const table = clean(input.entity, 50); if (!allowedTables[table]) return json({ error: 'ENTITY_NOT_ALLOWED' }, 403); let query = service.from(table).select(allowedTables[table], { count: 'exact' }).limit(100); if (input.company_id && table !== 'companies') query = query.eq('company_id', clean(input.company_id, 80)); const result = await query; if (result.error) throw result.error; return json({ entity: table, rows: result.data || [], total: result.count || 0 }); }
    if (action === 'create_platform_admin' || action === 'update_platform_admin') {
      if (adminRow.data.role !== 'owner') return json({ error: 'PLATFORM_OWNER_REQUIRED' }, 403);
      if (action === 'create_platform_admin') {
        const userId = clean(input.user_id, 80);
        const role = clean(input.role || 'readonly', 20);
        const permanent = input.permanent === true;
        const expiry = normalizePlatformAdminExpiry(input.expires_at, { required: !permanent, allowPermanent: permanent });
        const permanentRequestValid = !permanent || (role === 'admin' && Object.hasOwn(input, 'expires_at') && input.expires_at === null);
        if (!userId || !['admin', 'support', 'readonly'].includes(role) || !expiry.valid || (!permanent && !expiry.value) || !permanentRequestValid) return json({ error: 'INVALID_PLATFORM_ADMIN_TERM' }, 422);
        const result = await service.from('platform_admins').insert({ user_id: userId, role, status: 'active', expires_at: expiry.value, created_by: actor.id }).select('id,user_id,role,status,expires_at,created_at,last_access_at').single();
        if (result.error) throw result.error;
        await audit(service, { admin_user_id: actor.id, action: permanent ? 'platform_admin.permanent_admin.created' : 'platform_admin.temporary_admin.created', entity: 'platform_admins', entity_id: result.data.id, after_data: result.data, reason: input.reason }, req);
        return json({ admin: result.data });
      }
      const id = clean(input.id, 80);
      const before = await service.from('platform_admins').select('id,user_id,role,status,expires_at').eq('id', id).maybeSingle();
      if (before.error) throw before.error;
      if (!before.data) return json({ error: 'PLATFORM_ADMIN_NOT_FOUND' }, 404);
      const role = clean(input.role ?? before.data.role, 20);
      const status = clean(input.status ?? before.data.status, 20);
      const permanent = input.permanent === true;
      const expiry = normalizePlatformAdminExpiry(input.expires_at, { allowPermanent: permanent || role === 'owner' || status === 'disabled' });
      const expiryProvided = Object.hasOwn(input, 'expires_at');
      const permanentRequestValid = !permanent || (role === 'admin' && expiryProvided && input.expires_at === null);
      const expiresAt = permanent ? null : expiry.value === undefined ? before.data.expires_at : expiry.value;
      if (!PLATFORM_ROLES.includes(role) || !['active', 'disabled'].includes(status) || !expiry.valid) return json({ error: 'INVALID_PLATFORM_ADMIN' }, 422);
      if (!permanentRequestValid || (expiryProvided && input.expires_at === null && !permanent && role !== 'owner' && status === 'active')) return json({ error: 'INVALID_PLATFORM_ADMIN_TERM' }, 422);
      if (role === 'owner' && expiresAt !== null) return json({ error: 'PLATFORM_OWNER_MUST_BE_PERMANENT' }, 422);
      const explicitlyBecomingPermanent = permanent && role === 'admin' && expiresAt === null;
      const preservesExistingPermanentAdmin = before.data.role === 'admin' && before.data.status === 'active' && before.data.expires_at == null && role === 'admin' && !expiryProvided;
      if (role === 'admin' && status === 'active' && expiresAt === null && !explicitlyBecomingPermanent && !preservesExistingPermanentAdmin) return json({ error: 'PERMANENT_ADMIN_REQUIRES_OWNER_CONFIRMATION' }, 422);
      if (role !== 'owner' && status === 'active' && !explicitlyBecomingPermanent && !preservesExistingPermanentAdmin && !isPlatformAdminCurrent({ role, status, expires_at: expiresAt })) return json({ error: 'ACTIVE_PLATFORM_ADMIN_REQUIRES_FUTURE_EXPIRY' }, 422);
      if (before.data.role === 'owner' && (role !== 'owner' || status !== 'active' || expiresAt !== null)) {
        const owners = await service.from('platform_admins').select('id', { count: 'exact', head: true }).eq('role', 'owner').eq('status', 'active').is('expires_at', null);
        if (owners.error) throw owners.error;
        if ((owners.count || 0) <= 1) return json({ error: 'LAST_OWNER_PROTECTED' }, 409);
      }
      const result = await service.from('platform_admins').update({ role, status, expires_at: expiresAt }).eq('id', id).select('id,user_id,role,status,expires_at,created_at,last_access_at').single();
      if (result.error) throw result.error;
      await audit(service, { admin_user_id: actor.id, action: 'platform_admin.updated', entity: 'platform_admins', entity_id: id, before_data: before.data, after_data: result.data, reason: input.reason }, req);
      return json({ admin: result.data });
    }
    if (action === 'platform_admins') { if (!['owner','admin'].includes(adminRow.data.role)) throw Object.assign(new Error('PLATFORM_ADMIN_FORBIDDEN'), { status: 403 }); const result = await service.from('platform_admins').select('id,user_id,role,status,expires_at,created_at,created_by,last_access_at').order('created_at', { ascending: true }); if (result.error) throw result.error; return json({ rows: result.data || [] }); }
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    const status = Number((error as any)?.status) || (String((error as any)?.message) === 'AUTH_REQUIRED' ? 401 : 500);
    return json({ error: status === 500 ? 'PLATFORM_ADMIN_PROVIDER_ERROR' : clean((error as any)?.message, 80) }, status);
  }
});
