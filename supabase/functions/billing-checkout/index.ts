import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const providerUrl = 'https://api.mercadopago.com/v1/orders';

const providerError = (payload: any) => {
  const causes = Array.isArray(payload?.cause) ? payload.cause.slice(0, 5).map((cause: any) => ({
    code: clean(cause?.code, 80),
    description: clean(cause?.description || cause?.message, 240),
  })) : [];
  return {
    code: clean(payload?.error || payload?.code || payload?.cause_code, 80),
    message: clean(payload?.message || payload?.error_description, 240),
    causes,
  };
};

const logProviderFailure = (details: Record<string, unknown>) => {
  console.error(JSON.stringify({ event: 'BILLING_PROVIDER_REQUEST_FAILED', ...details, timestamp: new Date().toISOString() }));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  let companyId: string | null = null;
  try {
    const sb = admin(); const jwt = auth(req); const { data: userData } = await sb.auth.getUser(jwt); if (!userData?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({})); companyId = uuid(body?.company_id); const planCode = clean(body?.plan_code, 20).toLowerCase(); const method = body?.method === 'card' ? 'card' : 'pix';
    if (!companyId || !['free', 'pro', 'business', 'premium'].includes(planCode)) return json({ code: 'INVALID_REQUEST' }, 422);
    const { data: member } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', userData.user.id).maybeSingle(); if (!member?.active || !['admin', 'gestor'].includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { data: plan } = await sb.from('plans').select('id,code,name,price_minor,currency,billing_period').eq('code', planCode).eq('active', true).maybeSingle(); if (!plan) return json({ code: 'PLAN_NOT_FOUND' }, 404);
    if (plan.price_minor == null) return json({ code: 'PLAN_PRICE_NOT_CONFIGURED', message: 'O preço deste plano ainda não foi definido.' }, 409);
    if (plan.code === 'free') return json({ code: 'FREE_PLAN_NO_PAYMENT_REQUIRED', plan });
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
    if (method === 'card') return json({ code: 'CARD_CHECKOUT_REQUIRES_TOKENIZATION', message: 'Cartão exige tokenização oficial do Checkout Bricks.' }, 409);
    const { data: existing } = await sb.from('billing_checkout_sessions').select('id,company_id,plan_id,method,amount_minor,status,expires_at,provider_order_id,provider_payment_id').eq('company_id', companyId).eq('user_id', userData.user.id).eq('plan_id', plan.id).eq('method', method).in('status', ['created', 'pending']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing?.status === 'pending' && (existing.provider_order_id || existing.provider_payment_id)) return json({ code: 'OK', reused: true, checkout: existing, status: 'pending' });
    const checkout = existing || (await sb.from('billing_checkout_sessions').insert({ company_id: companyId, user_id: userData.user.id, plan_id: plan.id, method, amount_minor: plan.price_minor, status: 'created', expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }).select('id,company_id,plan_id,method,amount_minor,status,expires_at,provider_order_id,provider_payment_id').single()).data;
    if (!checkout) throw new Error('CHECKOUT_CREATE_FAILED');
    const idempotency = `f7-order-${checkout.id}`;
    const isTest = environment === 'test';
    const amount = (Number(plan.price_minor) / 100).toFixed(2);
    const payer = isTest ? { email: 'test_user_br@testuser.com', first_name: 'APRO' } : { email: userData.user.email };
    const orderBody = { type: 'online', external_reference: checkout.id, total_amount: amount, processing_mode: 'automatic', payer, transactions: { payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' } }] } };
    const response = await fetch(providerUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotency }, body: JSON.stringify(orderBody) });
    const rawBody = await response.text();
    let payload: any = {};
    try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { payload = {}; }
    if (!response.ok) {
      const failure = providerError(payload);
      logProviderFailure({ provider: 'mercado_pago', operation: 'create_order', endpoint: providerUrl, http_status: response.status, provider_code: failure.code || `HTTP_${response.status}`, provider_message: failure.message || clean(response.statusText, 240), provider_causes: failure.causes, request_id: response.headers.get('x-request-id'), checkout_id: checkout.id, company_id: companyId });
      await sb.from('billing_checkout_sessions').update({ status: 'failed' }).eq('id', checkout.id).eq('company_id', companyId);
      return json({ code: 'MERCADO_PAGO_ERROR' }, 502);
    }
    const providerOrderId = String(payload.id || '');
    const payment = payload.transactions?.payments?.[0] || {};
    const providerPaymentId = String(payment.id || '');
    const providerStatus = String(payment.status || payload.status || 'pending');
    await sb.from('billing_checkout_sessions').update({ status: 'pending', provider_order_id: providerOrderId || null, provider_payment_id: providerPaymentId || null }).eq('id', checkout.id).eq('company_id', companyId);
    if (providerPaymentId) await sb.from('billing_payments').upsert({ company_id: companyId, provider: 'mercado_pago', provider_payment_id: providerPaymentId, provider_status: providerStatus, amount_minor: plan.price_minor, currency: plan.currency, status: 'pending', metadata: { checkout_id: checkout.id, plan_code: plan.code, provider_order_id: providerOrderId || null } }, { onConflict: 'provider,provider_payment_id' });
    return json({ code: 'OK', checkout: { ...checkout, status: 'pending', provider_order_id: providerOrderId || null, provider_payment_id: providerPaymentId || null }, pix: { qr_code: payment.payment_method?.qr_code || null, qr_code_base64: payment.payment_method?.qr_code_base64 || null, ticket_url: payment.payment_method?.ticket_url || null }, status: providerStatus, status_detail: payment.status_detail || payload.status_detail || null });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'BILLING_CHECKOUT_FAILED' }, 500);
  }
});
