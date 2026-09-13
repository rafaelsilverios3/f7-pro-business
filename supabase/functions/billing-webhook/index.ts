import { admin, corsHeaders, json } from '../_shared/core.ts';

const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function validSignature(req: Request, body: any) {
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';
  if (!secret) return false;
  const signature = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const dataId = clean(body?.data?.id || body?.id);
  const ts = signature.match(/(?:^|,)ts=([^,]+)/)?.[1] || '';
  const v1 = signature.match(/(?:^|,)v1=([^,]+)/)?.[1] || '';
  if (!ts || !v1 || !dataId || !Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) return false;
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return expected === v1;
}

const mapped = (status: string) => ({ approved: 'approved', action_required: 'pending', processing: 'pending', pending: 'pending', in_process: 'pending', rejected: 'rejected', failed: 'rejected', cancelled: 'cancelled', refunded: 'refunded', charged_back: 'charged_back' } as Record<string, string>)[status] || 'pending';
const periodEnd = (start: Date, billingPeriod: string) => { const end = new Date(start); if (billingPeriod === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1); else end.setUTCMonth(end.getUTCMonth() + 1); return end; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  if (!(await validSignature(req, body))) return json({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const eventId = clean(body?.id || body?.data?.id);
  const type = clean(body?.type || body?.action, 80);
  const resourceId = clean(body?.data?.id || body?.data?.object_id);
  const isOrder = type === 'order' || type.startsWith('order.');
  const inserted = await sb.from('billing_webhook_events').insert({ provider: 'mercado_pago', provider_event_id: eventId, event_type: type, provider_resource_id: resourceId, status: 'received', metadata: { live_mode: Boolean(body?.live_mode) } });
  if (inserted.error?.code === '23505') return json({ code: 'OK', duplicate: true });
  if (inserted.error) return json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
  if ((!isOrder && type !== 'payment') || !resourceId) { await sb.from('billing_webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId); return json({ code: 'OK', ignored: true }); }
  const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
  if (!token) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 503);
  const endpoint = isOrder ? `https://api.mercadopago.com/v1/orders/${encodeURIComponent(resourceId)}` : `https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const rawBody = await response.text();
  let resource: any = {};
  try { resource = rawBody ? JSON.parse(rawBody) : {}; } catch { resource = {}; }
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'BILLING_PROVIDER_REQUEST_FAILED', provider: 'mercado_pago', operation: isOrder ? 'get_order' : 'get_payment', endpoint, http_status: response.status, provider_code: clean(resource?.error || resource?.code, 80) || `HTTP_${response.status}`, provider_message: clean(resource?.message || resource?.error_description, 240) || clean(response.statusText, 240), request_id: response.headers.get('x-request-id'), provider_resource_id: resourceId, timestamp: new Date().toISOString() }));
    return json({ code: isOrder ? 'ORDER_LOOKUP_FAILED' : 'PAYMENT_LOOKUP_FAILED' }, 502);
  }
  const payment = isOrder ? (resource.transactions?.payments?.[0] || {}) : resource;
  const paymentId = clean(payment.id);
  let { data: local } = paymentId ? await sb.from('billing_payments').select('id,company_id,metadata,amount_minor,currency,provider_payment_id').eq('provider', 'mercado_pago').eq('provider_payment_id', paymentId).maybeSingle() : { data: null };
  if (!local && isOrder) {
    const { data: checkout } = await sb.from('billing_checkout_sessions').select('id,company_id,plan_id,amount_minor,provider_order_id').eq('provider', 'mercado_pago').eq('provider_order_id', resourceId).maybeSingle();
    if (checkout && paymentId) {
      const { data: created } = await sb.from('billing_payments').upsert({ company_id: checkout.company_id, provider: 'mercado_pago', provider_payment_id: paymentId, provider_status: payment.status || resource.status || 'pending', amount_minor: checkout.amount_minor, currency: 'BRL', status: 'pending', metadata: { checkout_id: checkout.id, provider_order_id: resourceId } }, { onConflict: 'provider,provider_payment_id' }).select('id,company_id,metadata,amount_minor,currency,provider_payment_id').maybeSingle();
      local = created || null;
    }
  }
  if (!local) { await sb.from('billing_webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId); return json({ code: 'OK', ignored: true }); }
  const status = mapped(String(payment.status || resource.status || 'pending'));
  const providerAmountMinor = Number.isFinite(Number(payment.amount || resource.total_amount || resource.transaction_amount)) ? Math.round(Number(payment.amount || resource.total_amount || resource.transaction_amount) * 100) : null;
  const providerCurrency = String(payment.currency_id || resource.currency_id || (resource.country_code === 'BRA' ? 'BRL' : '')).toUpperCase();
  const expectedCurrency = String(local.currency || '').toUpperCase();
  if (providerAmountMinor == null || providerAmountMinor !== Number(local.amount_minor) || providerCurrency !== expectedCurrency) {
    await sb.from('billing_payments').update({ provider_status: payment.status || resource.status || null, status: 'rejected', updated_at: new Date().toISOString(), metadata: { ...(local.metadata || {}), rejection_code: 'PAYMENT_AMOUNT_MISMATCH', provider_amount_minor: providerAmountMinor, provider_currency: providerCurrency } }).eq('id', local.id).eq('company_id', local.company_id);
    await sb.from('billing_webhook_events').update({ status: 'failed', error_message: 'PAYMENT_AMOUNT_MISMATCH', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId);
    return json({ code: 'PAYMENT_AMOUNT_MISMATCH' }, 422);
  }
  const externalReference = clean(resource.external_reference || payment.external_reference);
  if (externalReference && local.metadata?.checkout_id && externalReference !== String(local.metadata.checkout_id)) { await sb.from('billing_webhook_events').update({ status: 'failed', error_message: 'PAYMENT_REFERENCE_MISMATCH', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId); return json({ code: 'PAYMENT_REFERENCE_MISMATCH' }, 422); }
  const paidAt = status === 'approved' ? new Date().toISOString() : null;
  await sb.from('billing_payments').update({ provider_status: payment.status || resource.status || null, status, paid_at: paidAt, updated_at: new Date().toISOString() }).eq('id', local.id).eq('company_id', local.company_id);
  const checkoutId = local.metadata?.checkout_id;
  const { data: checkout } = checkoutId ? await sb.from('billing_checkout_sessions').select('id,plan_id,company_id').eq('id', checkoutId).eq('company_id', local.company_id).maybeSingle() : { data: null };
  if (checkout) { await sb.from('billing_checkout_sessions').update({ status: status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'failed', updated_at: new Date().toISOString() }).eq('id', checkout.id); if (status === 'approved') { const { data: plan } = await sb.from('plans').select('code,billing_period').eq('id', checkout.plan_id).maybeSingle(); const periodStart = new Date(); if (plan) await sb.from('company_subscriptions').upsert({ company_id: checkout.company_id, plan: plan.code, status: 'active', current_period_start: periodStart.toISOString(), current_period_end: periodEnd(periodStart, plan.billing_period).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'company_id' }); await sb.from('audit_logs').insert({ company_id: checkout.company_id, action: 'billing.subscription_activated', entity: 'company_subscriptions', entity_id: checkout.company_id, new_data: { plan: plan?.code || null, payment_id: paymentId, order_id: isOrder ? resourceId : null } }); } }
  await sb.from('billing_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId);
  return json({ code: 'OK', status });
});
