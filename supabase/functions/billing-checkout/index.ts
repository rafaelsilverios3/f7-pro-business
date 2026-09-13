import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const providerUrl = 'https://api.mercadopago.com/v1/payments';

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
    const { data: checkout, error: checkoutError } = await sb.from('billing_checkout_sessions').insert({ company_id: companyId, user_id: userData.user.id, plan_id: plan.id, method, amount_minor: plan.price_minor, status: 'created', expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }).select('id,company_id,plan_id,method,amount_minor,status,expires_at').single();
    if (checkoutError) throw checkoutError;
    const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || ''; if (!token) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED', checkout });
    if (method === 'card') return json({ code: 'CARD_CHECKOUT_REQUIRES_TOKENIZATION', message: 'Cartão exige tokenização oficial do Checkout Bricks.', checkout }, 409);
    const idempotency = `f7-checkout-${checkout.id}`;
    const response = await fetch(providerUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotency }, body: JSON.stringify({ transaction_amount: Number(plan.price_minor) / 100, description: `F7 Business ${plan.name}`, payment_method_id: 'pix', payer: { email: userData.user.email }, external_reference: checkout.id }) });
    const payload = await response.json().catch(() => ({})); if (!response.ok) { await sb.from('billing_checkout_sessions').update({ status: 'failed' }).eq('id', checkout.id); return json({ code: 'MERCADO_PAGO_ERROR' }, 502); }
    const providerPaymentId = String(payload.id || ''); await sb.from('billing_checkout_sessions').update({ status: 'pending', provider_payment_id: providerPaymentId }).eq('id', checkout.id);
    await sb.from('billing_payments').upsert({ company_id: companyId, provider: 'mercado_pago', provider_payment_id: providerPaymentId, provider_status: payload.status || 'pending', amount_minor: plan.price_minor, currency: plan.currency, status: 'pending', metadata: { checkout_id: checkout.id, plan_code: plan.code } }, { onConflict: 'provider,provider_payment_id' });
    return json({ code: 'OK', checkout: { ...checkout, status: 'pending', provider_payment_id: providerPaymentId }, pix: { qr_code: payload.point_of_interaction?.transaction_data?.qr_code || payload.qr_code || null, qr_code_base64: payload.point_of_interaction?.transaction_data?.qr_code_base64 || payload.qr_code_base64 || null, ticket_url: payload.point_of_interaction?.transaction_data?.ticket_url || null }, status: payload.status || 'pending' });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'BILLING_CHECKOUT_FAILED' }, 500);
  }
});
