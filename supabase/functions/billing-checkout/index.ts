import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const providerUrl = 'https://api.mercadopago.com/v1/orders';

const logProviderFailure = (details: Record<string, unknown>) => {
  // Keep operational evidence useful without retaining provider payloads,
  // customer identifiers, URLs, or free-form messages in function logs.
  const httpStatus = Number(details.http_status);
  console.error(JSON.stringify({
    event: 'BILLING_PROVIDER_REQUEST_FAILED',
    provider: 'mercado_pago',
    operation: ['create_order', 'create_subscription'].includes(String(details.operation)) ? details.operation : 'unknown',
    http_status: Number.isInteger(httpStatus) ? httpStatus : null,
    request_id_present: Boolean(details.request_id_present),
    timestamp: new Date().toISOString(),
  }));
};

export async function handleBillingCheckoutRequest(req: Request, dependencies: { adminClient?: any; providerFetch?: typeof fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  let companyId: string | null = null;
  try {
    const sb = dependencies.adminClient || admin(); const providerFetch = dependencies.providerFetch || fetch; const jwt = auth(req); const { data: userData } = await sb.auth.getUser(jwt); if (!userData?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({})); companyId = uuid(body?.company_id); const planCode = clean(body?.plan_code, 20).toLowerCase(); const method = body?.method ?? 'pix';
    if (!companyId || !['free', 'pro', 'business', 'premium'].includes(planCode)) return json({ code: 'INVALID_REQUEST' }, 422);
    if (!['pix', 'card'].includes(method)) return json({ code: 'INVALID_PAYMENT_METHOD' }, 422);
    const { data: member } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', userData.user.id).maybeSingle(); if (!member?.active || !['admin', 'gestor'].includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { data: plan } = await sb.from('plans').select('id,code,name,price_minor,currency,billing_period').eq('code', planCode).eq('active', true).maybeSingle(); if (!plan) return json({ code: 'PLAN_NOT_FOUND' }, 404);
    if (plan.price_minor == null) return json({ code: 'PLAN_PRICE_NOT_CONFIGURED', message: 'O preço deste plano ainda não foi definido.' }, 409);
    if (plan.code === 'free') return json({ code: 'FREE_PLAN_NO_PAYMENT_REQUIRED', plan });
    const amountMinor = Number(plan.price_minor);
    const billingPeriod = String(plan.billing_period || '').toLowerCase();
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || String(plan.currency || '').toUpperCase() !== 'BRL') {
      return json({ code: 'PLAN_PRICE_INVALID' }, 409);
    }
    if (!['month', 'year'].includes(billingPeriod)) return json({ code: 'BILLING_PERIOD_UNSUPPORTED' }, 409);
    const environment = (Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || '').trim().toLowerCase();
    const validEnvironment = environment === 'test' || environment === 'production';
    if (!validEnvironment) return json({ code: 'MERCADO_PAGO_ENVIRONMENT_NOT_CONFIGURED' }, 409);
    const productionPaymentsEnabled = (Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') || '').trim().toLowerCase() === 'true';
    if (environment === 'production' && !productionPaymentsEnabled) return json({ code: 'PRODUCTION_PAYMENTS_DISABLED' }, 409);
    if (!Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET')) return json({ code: 'MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED' }, 409);
    // Reject unavailable payment paths before creating a persistent checkout
    // intent. In particular, a missing provider credential or unsupported
    // card flow must not leave an orphan `created` session behind.
    const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
    if (!token) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 409);
    if (environment === 'test' && !token.startsWith('TEST-')) return json({ code: 'MERCADO_PAGO_TEST_CREDENTIALS_REQUIRED' }, 409);
    if (environment === 'production' && !token.startsWith('APP_USR-')) return json({ code: 'MERCADO_PAGO_LIVE_CREDENTIALS_REQUIRED' }, 409);
    const accountEmail = typeof userData.user.email === 'string' ? userData.user.email.trim().toLowerCase() : '';
    if (environment === 'production' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return json({ code: 'PAYER_EMAIL_REQUIRED' }, 409);
    const cardTokenId = typeof body?.card_token_id === 'string' ? body.card_token_id.trim() : '';
    if (method === 'card' && (!cardTokenId || cardTokenId.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cardTokenId))) {
      return json({ code: 'CARD_TOKEN_REQUIRED' }, 422);
    }
    const { data: checkoutRows, error: checkoutError } = await sb.rpc('get_or_create_billing_checkout', {
      p_company_id: companyId, p_user_id: userData.user.id, p_plan_id: plan.id, p_method: method,
    });
    if (checkoutError) {
      console.error(JSON.stringify({ event: 'BILLING_CHECKOUT_RESERVATION_FAILED', database_code: /^[0-9A-Z]{5}$/.test(String(checkoutError.code || '')) ? checkoutError.code : 'UNKNOWN' }));
      return json({ code: checkoutError.code === '42501' ? 'FORBIDDEN' : 'CHECKOUT_CREATE_FAILED' }, checkoutError.code === '42501' ? 403 : 500);
    }
    const checkout = Array.isArray(checkoutRows) ? checkoutRows[0] : checkoutRows;
    if (!checkout) throw new Error('CHECKOUT_CREATE_FAILED');
    if (Number(checkout.amount_minor) !== amountMinor) return json({ code: 'CHECKOUT_PRICE_CHANGED' }, 409);
    const idempotency = `f7-order-${checkout.id}`;
    const isTest = environment === 'test';
    const amount = (Number(checkout.amount_minor) / 100).toFixed(2);
    const payer = isTest ? { email: 'test_user_br@testuser.com', first_name: 'APRO' } : { email: accountEmail };
    if (method === 'card') {
      const subscriptionBody = {
        reason: `F7 Business ${plan.name}`,
        external_reference: checkout.id,
        payer_email: payer.email,
        card_token_id: cardTokenId,
        auto_recurring: {
          // Mercado Pago recurring plans use days/months; represent an annual
          // plan as 12 months instead of the unsupported `years` unit.
          frequency: billingPeriod === 'year' ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: Number(amount),
          currency_id: String(plan.currency).toUpperCase(),
        },
        status: 'authorized',
      };
      let subscriptionResponse: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          subscriptionResponse = await providerFetch('https://api.mercadopago.com/preapproval', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `f7-subscription-${checkout.id}` },
            body: JSON.stringify(subscriptionBody), signal: controller.signal,
          });
        } finally { clearTimeout(timeout); }
      } catch {
        return json({ code: 'MERCADO_PAGO_RESULT_UNCERTAIN' }, 503);
      }
      const rawSubscription = await subscriptionResponse.text();
      let subscription: any = {};
      try { subscription = rawSubscription ? JSON.parse(rawSubscription) : {}; } catch { subscription = {}; }
      if (!subscriptionResponse.ok) {
        logProviderFailure({ operation: 'create_subscription', http_status: subscriptionResponse.status, request_id_present: Boolean(subscriptionResponse.headers.get('x-request-id')) });
        if (subscriptionResponse.status < 500 && subscriptionResponse.status !== 429) await sb.from('billing_checkout_sessions').update({ status: 'failed' }).eq('id', checkout.id).eq('company_id', companyId);
        else return json({ code: 'MERCADO_PAGO_RESULT_UNCERTAIN' }, 503);
        return json({ code: 'MERCADO_PAGO_ERROR' }, 502);
      }
      const providerSubscriptionId = clean(subscription.id, 120);
      const providerStatus = clean(subscription.status, 80);
      if (!providerSubscriptionId || !providerStatus) return json({ code: 'MERCADO_PAGO_RESPONSE_INCOMPLETE' }, 503);
      const initPoint = typeof subscription.init_point === 'string' ? subscription.init_point : '';
      let safeInitPoint: string | null = null;
      try {
        const candidate = new URL(initPoint);
        if (candidate.protocol === 'https:' && ['mercadopago.com.br', 'www.mercadopago.com.br', 'mercadopago.com', 'www.mercadopago.com'].includes(candidate.hostname)) safeInitPoint = candidate.toString();
      } catch { /* no redirect target when provider response is incomplete */ }
      const { data: persisted, error: persistError } = await sb.rpc('persist_billing_subscription', {
        p_checkout_id: checkout.id, p_company_id: companyId,
        p_provider_subscription_id: providerSubscriptionId, p_provider_status: providerStatus,
      });
      if (persistError || persisted?.code !== 'OK') {
        console.error(JSON.stringify({ event: 'BILLING_SUBSCRIPTION_STATE_FAILED', database_code: /^[0-9A-Z]{5}$/.test(String(persistError?.code || '')) ? persistError.code : 'UNKNOWN' }));
        return json({ code: 'CHECKOUT_STATE_RETRYABLE' }, 503);
      }
      return json({ code: 'OK', checkout: { id: checkout.id, status: 'pending', amount_minor: checkout.amount_minor, expires_at: checkout.expires_at },
        subscription: { id: persisted.subscription_id, status: persisted.status, provider_status: providerStatus,
          init_point: safeInitPoint } });
    }
    const orderBody = { type: 'online', external_reference: checkout.id, total_amount: amount, processing_mode: 'automatic', payer, transactions: { payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' } }] } };
    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try { response = await providerFetch(providerUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotency }, body: JSON.stringify(orderBody), signal: controller.signal }); }
      finally { clearTimeout(timeout); }
    } catch {
      // The provider may have accepted the order before a timeout. Keep the
      // checkout id and retry with the same idempotency key.
      return json({ code: 'MERCADO_PAGO_RESULT_UNCERTAIN' }, 503);
    }
    const rawBody = await response.text();
    let payload: any = {};
    try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { payload = {}; }
    if (!response.ok) {
      logProviderFailure({ operation: 'create_order', http_status: response.status, request_id_present: Boolean(response.headers.get('x-request-id')) });
      if (response.status < 500 && response.status !== 429) await sb.from('billing_checkout_sessions').update({ status: 'failed' }).eq('id', checkout.id).eq('company_id', companyId);
      else return json({ code: 'MERCADO_PAGO_RESULT_UNCERTAIN' }, 503);
      return json({ code: 'MERCADO_PAGO_ERROR' }, 502);
    }
    const providerOrderId = String(payload.id || '');
    const payment = payload.transactions?.payments?.[0] || {};
    const providerPaymentId = String(payment.id || '');
    const providerStatus = String(payment.status || payload.status || 'pending');
    const providerAmount = Number(payment.amount ?? payload.total_amount);
    const providerAmountMinor = Number.isFinite(providerAmount) ? Math.round(providerAmount * 100) : null;
    const providerCurrency = String(payment.currency_id || payload.currency_id || '').toUpperCase();
    if (!providerOrderId || !providerPaymentId || providerAmountMinor === null || !providerCurrency) return json({ code: 'MERCADO_PAGO_RESPONSE_INCOMPLETE' }, 503);
    if (providerAmountMinor !== Number(checkout.amount_minor) || providerCurrency !== String(plan.currency).toUpperCase()) return json({ code: 'MERCADO_PAGO_RESPONSE_MISMATCH' }, 502);
    const { data: persisted, error: persistError } = await sb.rpc('persist_billing_checkout_order', {
      p_checkout_id: checkout.id,
      p_company_id: companyId,
      p_provider_order_id: providerOrderId,
      p_provider_payment_id: providerPaymentId,
      p_provider_status: clean(providerStatus, 80) || 'pending',
      p_currency: providerCurrency,
    });
    if (persistError || persisted?.code !== 'OK') {
      console.error(JSON.stringify({ event: 'BILLING_CHECKOUT_PROVIDER_STATE_FAILED', database_code: /^[0-9A-Z]{5}$/.test(String(persistError?.code || '')) ? persistError.code : 'UNKNOWN' }));
      return json({ code: 'CHECKOUT_STATE_RETRYABLE' }, 503);
    }
    return json({ code: 'OK', checkout: { ...checkout, status: 'pending', provider_order_id: providerOrderId || null, provider_payment_id: providerPaymentId || null }, pix: { qr_code: payment.payment_method?.qr_code || null, qr_code_base64: payment.payment_method?.qr_code_base64 || null, ticket_url: payment.payment_method?.ticket_url || null }, status: providerStatus, status_detail: payment.status_detail || payload.status_detail || null });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'BILLING_CHECKOUT_FAILED' }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handleBillingCheckoutRequest(req));
