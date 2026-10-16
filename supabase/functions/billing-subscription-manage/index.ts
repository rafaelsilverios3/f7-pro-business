import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
import { blocksLiveBillingInHomologation } from '../_shared/billingEnvironment.ts';
import { verifyMercadoPagoCredentialEnvironment } from '../_shared/mercadoPagoCredentials.ts';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const normalizeProviderStatus = (value: unknown) => {
  const status = String(value || '').toLowerCase();
  return status === 'canceled' ? 'cancelled' : status;
};

export async function handleBillingSubscriptionManageRequest(req: Request, dependencies: { adminClient?: any; providerFetch?: typeof fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const jwt = auth(req);
    const sb = dependencies.adminClient || admin();
    const providerFetch = dependencies.providerFetch || fetch;
    const { data: userData } = await sb.auth.getUser(jwt);
    if (!userData?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({}));
    const companyId = body?.company_id;
    const subscriptionId = body?.subscription_id;
    const action = body?.action;
    if (!uuid(companyId) || !uuid(subscriptionId) || !['pause', 'resume', 'cancel'].includes(action)) return json({ code: 'INVALID_REQUEST' }, 422);

    const membership = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', userData.user.id).maybeSingle();
    if (membership.error) return json({ code: 'MEMBERSHIP_LOOKUP_FAILED' }, 500);
    if (!membership.data?.active || !['admin', 'gestor'].includes(membership.data.role)) return json({ code: 'FORBIDDEN' }, 403);

    const { data: subscription, error: subscriptionError } = await sb.from('billing_subscriptions')
      .select('id,company_id,provider,provider_subscription_id,status')
      .eq('id', subscriptionId).eq('company_id', companyId).maybeSingle();
    if (subscriptionError) return json({ code: 'SUBSCRIPTION_LOOKUP_FAILED' }, 500);
    if (!subscription || subscription.provider !== 'mercado_pago' || !subscription.provider_subscription_id) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404);
    if (action === 'cancel' && subscription.status === 'cancelled') return json({ code: 'OK', status: 'cancelled', duplicate: true });

    const expectedStatus = action === 'pause' ? 'authorized' : action === 'resume' ? 'paused' : subscription.status;
    if (action === 'cancel' && !['pending', 'authorized', 'paused', 'past_due', 'rejected', 'expired'].includes(subscription.status)) return json({ code: 'SUBSCRIPTION_ACTION_NOT_ALLOWED' }, 409);
    if (action !== 'cancel' && subscription.status !== expectedStatus) return json({ code: 'SUBSCRIPTION_ACTION_NOT_ALLOWED' }, 409);
    const environment = (Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || '').trim().toLowerCase();
    if (blocksLiveBillingInHomologation(environment)) return json({ code: 'HOMOLOGATION_LIVE_PAYMENTS_DISABLED' }, 409);
    const providerToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
    const livePaymentsEnabled = (Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') || '').trim().toLowerCase() === 'true';
    if (environment === 'production' && !livePaymentsEnabled) return json({ code: 'PRODUCTION_PAYMENTS_DISABLED' }, 409);
    if (!['test', 'production'].includes(environment) || !providerToken) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 409);
    const credentialCheck = await verifyMercadoPagoCredentialEnvironment(providerToken, environment as 'test' | 'production', providerFetch);
    if (credentialCheck !== 'verified') {
      return json({ code: 'MERCADO_PAGO_CREDENTIAL_ENVIRONMENT_UNVERIFIED' }, credentialCheck === 'unavailable' ? 503 : 409);
    }

    const controlToken = crypto.randomUUID();
    const claimed = await sb.rpc('claim_billing_subscription_control', {
      p_subscription_id: subscription.id, p_company_id: companyId, p_action: action, p_control_token: controlToken,
    });
    if (claimed.error) return json({ code: 'SUBSCRIPTION_CONTROL_RETRYABLE' }, 503);
    if (claimed.data?.code !== 'OK') return json({ code: clean(claimed.data?.code) || 'SUBSCRIPTION_CONTROL_REJECTED', status: claimed.data?.status || null }, 409);
    if (claimed.data.duplicate) return json({ code: 'OK', status: claimed.data.status, duplicate: true });

    const providerAction = action === 'cancel' ? 'canceled' : action === 'pause' ? 'paused' : 'authorized';
    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        response = await providerFetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: providerAction }), signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }
    } catch {
      return json({ code: 'SUBSCRIPTION_RESULT_UNCERTAIN' }, 503);
    }
    const raw = await response.text();
    let providerResult: any = {};
    try { providerResult = raw ? JSON.parse(raw) : {}; } catch { providerResult = {}; }
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'BILLING_SUBSCRIPTION_CONTROL_FAILED', provider: 'mercado_pago', action, http_status: response.status, request_id_present: Boolean(response.headers.get('x-request-id')) }));
      if (response.status < 500 && response.status !== 429) await sb.rpc('release_billing_subscription_control', { p_subscription_id: subscription.id, p_company_id: companyId, p_control_token: controlToken });
      return json({ code: response.status >= 500 || response.status === 429 ? 'SUBSCRIPTION_RESULT_UNCERTAIN' : 'SUBSCRIPTION_PROVIDER_REJECTED' }, response.status >= 500 || response.status === 429 ? 503 : 502);
    }
    const providerSubscriptionId = clean(providerResult.id);
    const providerStatus = normalizeProviderStatus(providerResult.status);
    const nextStatus = action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'authorized';
    if (providerSubscriptionId !== subscription.provider_subscription_id || providerStatus !== nextStatus) return json({ code: 'SUBSCRIPTION_PROVIDER_RESPONSE_MISMATCH' }, 502);

    const settled = await sb.rpc('record_billing_subscription_control', {
      p_subscription_id: subscription.id, p_company_id: companyId, p_action: action,
      p_expected_status: subscription.status, p_provider_status: clean(providerResult.status), p_control_token: controlToken,
    });
    if (settled.error) return json({ code: 'SUBSCRIPTION_STATE_RETRYABLE' }, 503);
    if (settled.data?.code !== 'OK') return json({ code: clean(settled.data?.code) || 'SUBSCRIPTION_STATE_CONFLICT', status: settled.data?.status || null }, 409);
    return json({ code: 'OK', status: settled.data.status, duplicate: Boolean(settled.data.duplicate) });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'SUBSCRIPTION_MANAGE_FAILED' }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handleBillingSubscriptionManageRequest(req));
