import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
import { blocksLiveBillingInHomologation, blocksRecurringBillingInHomologation } from '../_shared/billingEnvironment.ts';
import { verifyMercadoPagoCredentialEnvironment } from '../_shared/mercadoPagoCredentials.ts';

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
    operation: ['create_order', 'create_payment', 'create_subscription'].includes(String(details.operation)) ? details.operation : 'unknown',
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
    const body = await req.json().catch(() => ({})); companyId = uuid(body?.company_id); const planCode = clean(body?.plan_code, 20).toLowerCase(); const method = body?.method;
    const billingModel = body?.billing_model;
    const billingPeriod = body?.billing_period;
    if (!companyId || !['free', 'pro', 'business', 'premium'].includes(planCode)) return json({ code: 'INVALID_REQUEST' }, 422);
    if (!['pix', 'card'].includes(method)) return json({ code: 'INVALID_PAYMENT_METHOD' }, 422);
    if (!['one_time', 'recurring'].includes(billingModel)) return json({ code: 'INVALID_BILLING_MODEL' }, 422);
    if (!['month', 'year'].includes(billingPeriod)) return json({ code: 'INVALID_BILLING_PERIOD' }, 422);
    if (billingModel === 'recurring' && method !== 'card') return json({ code: 'RECURRING_CARD_REQUIRED' }, 422);
    const { data: member } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', userData.user.id).maybeSingle(); if (!member?.active || !['admin', 'gestor'].includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { data: plan } = await sb.from('plans').select('id,code,name,price_minor,currency,billing_period').eq('code', planCode).eq('active', true).maybeSingle(); if (!plan) return json({ code: 'PLAN_NOT_FOUND' }, 404);
    if (plan.price_minor == null) return json({ code: 'PLAN_PRICE_NOT_CONFIGURED', message: 'O preço deste plano ainda não foi definido.' }, 409);
    if (plan.code === 'free') return json({ code: 'FREE_PLAN_NO_PAYMENT_REQUIRED', plan });
    const configuredPeriod = String(plan.billing_period || '').toLowerCase();
    const baseAmountMinor = Number(plan.price_minor);
    const amountMinor = billingPeriod === configuredPeriod ? baseAmountMinor
      : configuredPeriod === 'month' && billingPeriod === 'year' ? baseAmountMinor * 12 : Number.NaN;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || String(plan.currency || '').toUpperCase() !== 'BRL') {
      return json({ code: 'PLAN_PRICE_INVALID' }, 409);
    }
    const environment = (Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || '').trim().toLowerCase();
    if (blocksRecurringBillingInHomologation(billingModel, environment)) return json({ code: 'HOMOLOGATION_RECURRING_BILLING_TEST_ONLY' }, 409);
    if (blocksLiveBillingInHomologation(environment)) return json({ code: 'HOMOLOGATION_LIVE_PAYMENTS_DISABLED' }, 409);
    const validEnvironment = environment === 'test' || environment === 'production';
    if (!validEnvironment) return json({ code: 'MERCADO_PAGO_ENVIRONMENT_NOT_CONFIGURED' }, 409);
    const productionPaymentsEnabled = (Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') || '').trim().toLowerCase() === 'true';
    if (environment === 'production' && !productionPaymentsEnabled) return json({ code: 'PRODUCTION_PAYMENTS_DISABLED' }, 409);
    let appBackUrl: string | null = null;
    if (billingModel === 'recurring') {
      try {
        const candidate = new URL(Deno.env.get('APP_URL') || '');
        const configuredOrigin = new URL(Deno.env.get('APP_ORIGIN') || '');
        const localTestOrigin = environment === 'test' && candidate.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(candidate.hostname);
        if (candidate.username || candidate.password || candidate.search || candidate.hash ||
          (!localTestOrigin && candidate.protocol !== 'https:') ||
          (!localTestOrigin && candidate.origin !== configuredOrigin.origin)) return json({ code: 'BILLING_RETURN_URL_NOT_CONFIGURED' }, 409);
        appBackUrl = candidate.toString();
      } catch { return json({ code: 'BILLING_RETURN_URL_NOT_CONFIGURED' }, 409); }
    }
    if (!Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET')) return json({ code: 'MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED' }, 409);
    // Reject unavailable payment paths before creating a persistent checkout
    // intent. In particular, a missing provider credential or unsupported
    // card flow must not leave an orphan `created` session behind.
    const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
    if (!token) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 409);
    const credentialCheck = await verifyMercadoPagoCredentialEnvironment(token, environment as 'test' | 'production', providerFetch);
    if (credentialCheck !== 'verified') {
      return json({ code: 'MERCADO_PAGO_CREDENTIAL_ENVIRONMENT_UNVERIFIED' }, credentialCheck === 'unavailable' ? 503 : 409);
    }
    const accountEmail = typeof userData.user.email === 'string' ? userData.user.email.trim().toLowerCase() : '';
    if (environment === 'production' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return json({ code: 'PAYER_EMAIL_REQUIRED' }, 409);
    const cardPayment = body?.card_payment && typeof body.card_payment === 'object' ? body.card_payment : {};
    const cardTokenId = typeof cardPayment.token === 'string' ? cardPayment.token.trim() : '';
    const paymentMethodId = typeof cardPayment.payment_method_id === 'string' ? cardPayment.payment_method_id.trim() : '';
    const installments = Number(cardPayment.installments);
    const payerIdentification = cardPayment.payer?.identification;
    const payerEmail = typeof cardPayment.payer?.email === 'string' ? cardPayment.payer.email.trim().toLowerCase() : accountEmail;
    if (method === 'card' && (!cardTokenId || cardTokenId.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cardTokenId)
      || !/^[A-Za-z0-9_-]{1,40}$/.test(paymentMethodId) || !Number.isInteger(installments) || installments < 1 || installments > 24
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)
      || !['CPF','CNPJ'].includes(String(payerIdentification?.type || '').toUpperCase())
      || !/^\d{11,14}$/.test(String(payerIdentification?.number || '').replace(/\D/g, '')))) {
      return json({ code: 'CARD_PAYMENT_DATA_INVALID' }, 422);
    }
    const { data: checkoutRows, error: checkoutError } = await sb.rpc('get_or_create_billing_checkout_v2', {
      p_company_id: companyId, p_user_id: userData.user.id, p_plan_id: plan.id, p_method: method,
      p_billing_model: billingModel, p_billing_period: billingPeriod,
    });
    if (checkoutError) {
      console.error(JSON.stringify({ event: 'BILLING_CHECKOUT_RESERVATION_FAILED', database_code: /^[0-9A-Z]{5}$/.test(String(checkoutError.code || '')) ? checkoutError.code : 'UNKNOWN' }));
      const status = checkoutError.code === '42501' ? 403
        : ['23514', '22023', '22003'].includes(String(checkoutError.code)) ? 409 : 500;
      const code = checkoutError.code === '42501' ? 'FORBIDDEN'
        : checkoutError.code === '23514' ? 'ACTIVE_CONTRACT_CONFLICT'
        : ['22023', '22003'].includes(String(checkoutError.code)) ? 'CHECKOUT_TERMS_INVALID' : 'CHECKOUT_CREATE_FAILED';
      return json({ code }, status);
    }
    const checkout = Array.isArray(checkoutRows) ? checkoutRows[0] : checkoutRows;
    if (!checkout) throw new Error('CHECKOUT_CREATE_FAILED');
    if (Number(checkout.amount_minor) !== amountMinor || checkout.billing_model !== billingModel || checkout.billing_period_snapshot !== billingPeriod) return json({ code: 'CHECKOUT_PRICE_CHANGED' }, 409);
    const idempotency = `f7-order-${checkout.id}`;
    const isTest = environment === 'test';
    const amount = (Number(checkout.amount_minor) / 100).toFixed(2);
    // Orders API test flows require the documented generic test payer email;
    // the older Payments API test-user pattern is not valid for Orders.
    const payer = isTest ? { email: 'test@testuser.com', first_name: 'APRO' } : { email: accountEmail };
    if (billingModel === 'recurring') {
      const subscriptionBody = {
        reason: `F7 Business ${plan.name}`,
        back_url: appBackUrl,
        external_reference: checkout.id,
        payer_email: payerEmail,
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
    if (method === 'card') {
      const paymentBody = {
        transaction_amount: Number(amount),
        token: cardTokenId,
        description: `F7 Business ${plan.name} - ${billingPeriod === 'year' ? '12 meses' : '1 mês'}`,
        installments,
        payment_method_id: paymentMethodId,
        ...(cardPayment.issuer_id ? { issuer_id: clean(cardPayment.issuer_id, 40) } : {}),
        external_reference: checkout.id,
        payer: {
          email: payerEmail,
          identification: {
            type: String(payerIdentification.type).toUpperCase(),
            number: String(payerIdentification.number).replace(/\D/g, ''),
          },
        },
      };
      let paymentResponse: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          paymentResponse = await providerFetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `f7-payment-${checkout.id}` },
            body: JSON.stringify(paymentBody), signal: controller.signal,
          });
        } finally { clearTimeout(timeout); }
      } catch {
        return json({ code: 'MERCADO_PAGO_RESULT_UNCERTAIN' }, 503);
      }
      const rawPayment = await paymentResponse.text();
      let paymentResult: any = {};
      try { paymentResult = rawPayment ? JSON.parse(rawPayment) : {}; } catch { paymentResult = {}; }
      if (!paymentResponse.ok) {
        logProviderFailure({ operation: 'create_payment', http_status: paymentResponse.status, request_id_present: Boolean(paymentResponse.headers.get('x-request-id')) });
        if (paymentResponse.status < 500 && paymentResponse.status !== 429) await sb.from('billing_checkout_sessions').update({ status: 'failed' }).eq('id', checkout.id).eq('company_id', companyId);
        else return json({ code: 'MERCADO_PAGO_RESULT_UNCERTAIN' }, 503);
        return json({ code: 'MERCADO_PAGO_ERROR' }, 502);
      }
      const providerPaymentId = clean(paymentResult.id, 120);
      const providerStatus = clean(paymentResult.status, 80);
      const providerAmountMinor = Number.isFinite(Number(paymentResult.transaction_amount)) ? Math.round(Number(paymentResult.transaction_amount) * 100) : null;
      const providerCurrency = String(paymentResult.currency_id || '').toUpperCase();
      if (!providerPaymentId || !providerStatus || providerAmountMinor !== Number(checkout.amount_minor) || providerCurrency !== String(plan.currency).toUpperCase()) {
        return json({ code: 'MERCADO_PAGO_RESPONSE_MISMATCH' }, 502);
      }
      const { data: persisted, error: persistError } = await sb.rpc('persist_billing_checkout_payment', {
        p_checkout_id: checkout.id, p_company_id: companyId,
        p_provider_payment_id: providerPaymentId, p_provider_status: providerStatus,
        p_currency: providerCurrency,
      });
      if (persistError || persisted?.code !== 'OK') {
        console.error(JSON.stringify({ event: 'BILLING_CHECKOUT_PROVIDER_STATE_FAILED', database_code: /^[0-9A-Z]{5}$/.test(String(persistError?.code || '')) ? persistError.code : 'UNKNOWN' }));
        return json({ code: 'CHECKOUT_STATE_RETRYABLE' }, 503);
      }
      return json({ code: 'OK', checkout: { id: checkout.id, status: 'pending', amount_minor: checkout.amount_minor },
        payment: { id: providerPaymentId, status: providerStatus, status_detail: clean(paymentResult.status_detail, 80) || null } });
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
