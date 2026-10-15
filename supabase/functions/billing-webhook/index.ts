import { admin, corsHeaders, json } from '../_shared/core.ts';

const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const hexBytes = (value: string) => {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

const constantTimeEqual = (left: string, right: string) => {
  const leftBytes = hexBytes(left.trim().toLowerCase());
  const rightBytes = hexBytes(right.trim().toLowerCase());
  if (!leftBytes || !rightBytes || leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
};

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 10 * 60;
const isWebhookTimestampValid = (value: string, nowSeconds = Math.floor(Date.now() / 1000)) => {
  const tsSeconds = Number(value);
  return Number.isFinite(tsSeconds) && Math.abs(nowSeconds - tsSeconds) <= WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
};

const resolveDataId = (req: Request, body: any) => {
  const url = new URL(req.url);
  const queryDataId = clean(url.searchParams.get('data.id') || url.searchParams.get('data_id'));
  if (queryDataId) return { value: queryDataId, origin: 'query' };
  const bodyDataId = clean(body?.data?.id || body?.id);
  return { value: bodyDataId, origin: bodyDataId ? 'body' : 'none' };
};

async function validateSignature(req: Request, body: any) {
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';
  const signature = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const resolvedDataId = resolveDataId(req, body);
  const dataId = resolvedDataId.value;
  const ts = signature.match(/(?:^|,)ts=([^,]+)/)?.[1] || '';
  const v1 = signature.match(/(?:^|,)v1=([^,]+)/)?.[1] || '';
  const diagnostics = { event: 'BILLING_WEBHOOK_SIGNATURE_CHECK', x_request_id_present: Boolean(requestId), x_signature_present: Boolean(signature), ts: ts || null, data_id: dataId || null, data_id_origin: resolvedDataId.origin, received_digest_length: v1.length };
  const invalid = (reason: string) => { console.error(JSON.stringify({ ...diagnostics, result: 'invalid', reason })); return { valid: false, dataId }; };
  if (!secret) return invalid('secret_missing');
  if (!ts || !v1 || !dataId) return invalid('required_signature_field_missing');
  if (!isWebhookTimestampValid(ts)) return invalid('timestamp_invalid_or_expired');
  const manifest = [`id:${dataId};`, requestId ? `request-id:${requestId};` : '', `ts:${ts};`].join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const valid = constantTimeEqual(expected, v1);
  console.error(JSON.stringify({ ...diagnostics, result: valid ? 'valid' : 'invalid', reason: valid ? null : 'digest_mismatch' }));
  return { valid, dataId };
}

const normalizeLegacyPaymentStatus = (status: unknown) => {
  const normalized = String(status || '').toLowerCase();
  const result = ({ approved: 'approved', action_required: 'pending', processing: 'pending', pending: 'pending', in_process: 'pending', rejected: 'rejected', failed: 'rejected', cancelled: 'cancelled', refunded: 'refunded', charged_back: 'charged_back' } as Record<string, string>)[normalized] || 'pending';
  return { status: result, activationEligible: result === 'approved', reason: result === 'approved' ? null : `legacy_${normalized || 'unknown'}` };
};

const normalizeOrdersPaymentStatus = (input: { orderStatus?: unknown; orderStatusDetail?: unknown; transactionStatus?: unknown; transactionStatusDetail?: unknown }) => {
  const { orderStatus, orderStatusDetail, transactionStatus, transactionStatusDetail } = input;
  const order = String(orderStatus || '').toLowerCase();
  const orderDetail = String(orderStatusDetail || '').toLowerCase();
  const transaction = String(transactionStatus || '').toLowerCase();
  const transactionDetail = String(transactionStatusDetail || '').toLowerCase();
  const hasTransaction = Boolean(transaction || transactionDetail);
  const transactionApproved = transaction === 'processed' && transactionDetail === 'accredited';
  if (order === 'processed' && orderDetail === 'partially_refunded' || transaction === 'processed' && transactionDetail === 'partially_refunded') return { status: 'refunded', activationEligible: false, reason: 'partial_refund' };
  if (order === 'processed' && orderDetail === 'accredited' && (!hasTransaction || transactionApproved)) return { status: 'approved', activationEligible: true, reason: null };
  if (order === 'processed' && orderDetail === 'accredited' && hasTransaction && !transactionApproved) return { status: 'pending', activationEligible: false, reason: 'transaction_status_mismatch' };
  if (order === 'action_required' && orderDetail === 'waiting_payment') return { status: 'pending', activationEligible: false, reason: 'waiting_payment' };
  if (order === 'processing' && orderDetail === 'in_process') return { status: 'pending', activationEligible: false, reason: 'in_process' };
  if (order === 'created' && orderDetail === 'created') return { status: 'pending', activationEligible: false, reason: 'created' };
  if (order === 'refunded' || transaction === 'refunded') return { status: 'refunded', activationEligible: false, reason: 'refunded' };
  if (order === 'cancelled' || order === 'canceled' || transaction === 'cancelled' || transaction === 'canceled') return { status: 'cancelled', activationEligible: false, reason: 'cancelled' };
  if (order === 'failed' || transaction === 'failed') return { status: 'rejected', activationEligible: false, reason: 'failed' };
  if (order === 'expired' || transaction === 'expired') return { status: 'rejected', activationEligible: false, reason: 'expired' };
  if (order === 'processed') return { status: 'pending', activationEligible: false, reason: 'order_status_detail_unverified' };
  return { status: 'pending', activationEligible: false, reason: 'provider_status_unverified' };
};
const periodEnd = (start: Date, billingPeriod: string) => { const end = new Date(start); if (billingPeriod === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1); else end.setUTCMonth(end.getUTCMonth() + 1); return end; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  const signature = await validateSignature(req, body);
  if (!signature.valid) return json({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const eventId = clean(body?.id || body?.data?.id);
  const type = clean(body?.type || body?.action, 80);
  const resourceId = clean(signature.dataId || body?.data?.object_id);
  const isOrder = type === 'order' || type.startsWith('order.');
  const { data: existingEvent } = await sb.from('billing_webhook_events').select('status,metadata').eq('provider_event_id', eventId).maybeSingle();
  const legacyEventNeedsReconciliation = existingEvent?.status === 'processed' && !existingEvent.metadata?.normalized_payment_status;
  if (existingEvent && !legacyEventNeedsReconciliation) return json({ code: 'OK', duplicate: true });
  if (!existingEvent) {
    const inserted = await sb.from('billing_webhook_events').insert({ provider: 'mercado_pago', provider_event_id: eventId, event_type: type, provider_resource_id: resourceId, status: 'received', metadata: { live_mode: Boolean(body?.live_mode) } });
    if (inserted.error?.code === '23505') return json({ code: 'OK', duplicate: true });
    if (inserted.error) return json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
  }
  const updateEvent = (values: Record<string, unknown>, evidence: Record<string, unknown> = {}) => sb.from('billing_webhook_events').update({ ...values, metadata: { ...(existingEvent?.metadata || {}), live_mode: Boolean(body?.live_mode), ...evidence } }).eq('provider_event_id', eventId);
  if ((!isOrder && type !== 'payment') || !resourceId) { await updateEvent({ status: 'ignored', processed: true, processed_at: new Date().toISOString() }); return json({ code: 'OK', ignored: true }); }
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
  const providerEvidence = {
    provider_order_status: isOrder ? clean(resource.status, 80) || null : null,
    provider_order_status_detail: isOrder ? clean(resource.status_detail, 120) || null : null,
    provider_transaction_status: isOrder ? clean(payment.status, 80) || null : clean(resource.status, 80) || null,
    provider_transaction_status_detail: isOrder ? clean(payment.status_detail, 120) || null : clean(resource.status_detail, 120) || null,
  };
  const normalized = isOrder
    ? normalizeOrdersPaymentStatus({ orderStatus: resource.status, orderStatusDetail: resource.status_detail, transactionStatus: payment.status, transactionStatusDetail: payment.status_detail })
    : normalizeLegacyPaymentStatus(payment.status || resource.status);
  const evidence = { ...providerEvidence, normalized_payment_status: normalized.status, normalization_reason: normalized.reason };
  console.error(JSON.stringify({ event: 'BILLING_WEBHOOK_STATUS_NORMALIZED', provider: 'mercado_pago', provider_resource_id: resourceId, ...evidence }));
  const paymentId = clean(payment.id);
  const { data: orderCheckout } = isOrder ? await sb.from('billing_checkout_sessions').select('id,company_id,plan_id,amount_minor,provider_order_id').eq('provider', 'mercado_pago').eq('provider_order_id', resourceId).maybeSingle() : { data: null };
  let { data: local } = paymentId ? await sb.from('billing_payments').select('id,company_id,metadata,amount_minor,currency,provider_payment_id,status,provider_status').eq('provider', 'mercado_pago').eq('provider_payment_id', paymentId).maybeSingle() : { data: null };
  if (!local && isOrder) {
    if (orderCheckout && paymentId) {
      const { data: created } = await sb.from('billing_payments').upsert({ company_id: orderCheckout.company_id, provider: 'mercado_pago', provider_payment_id: paymentId, provider_status: payment.status || resource.status || 'pending', amount_minor: orderCheckout.amount_minor, currency: 'BRL', status: 'pending', metadata: { checkout_id: orderCheckout.id, plan_code: null, provider_order_id: resourceId } }, { onConflict: 'provider,provider_payment_id' }).select('id,company_id,metadata,amount_minor,currency,provider_payment_id,status,provider_status').maybeSingle();
      local = created || null;
    }
  }
  if (!local) { await updateEvent({ status: 'ignored', processed: true, processed_at: new Date().toISOString() }, evidence); return json({ code: 'OK', ignored: true }); }
  const checkoutId = clean(local.metadata?.checkout_id);
  const { data: checkout } = checkoutId
    ? await sb.from('billing_checkout_sessions').select('id,company_id,plan_id,amount_minor,provider_order_id').eq('id', checkoutId).eq('company_id', local.company_id).maybeSingle()
    : orderCheckout && orderCheckout.company_id === local.company_id ? { data: orderCheckout } : { data: null };
  const { data: plan } = checkout ? await sb.from('plans').select('code,billing_period,price_minor,currency').eq('id', checkout.plan_id).maybeSingle() : { data: null };
  const externalReference = clean(resource.external_reference || payment.external_reference);
  const referenceMismatch = isOrder && (!externalReference || !checkout || externalReference !== String(checkout.id));
  const orderMismatch = isOrder && (!checkout || checkout.provider_order_id !== resourceId || (checkoutId && checkoutId !== checkout.id));
  const companyMismatch = !checkout || checkout.company_id !== local.company_id;
  const planMismatch = !plan || (local.metadata?.plan_code && local.metadata.plan_code !== plan.code);
  if (referenceMismatch || orderMismatch || companyMismatch || planMismatch) {
    const code = referenceMismatch ? 'PAYMENT_REFERENCE_MISMATCH' : orderMismatch ? 'PROVIDER_ORDER_MISMATCH' : companyMismatch ? 'PAYMENT_COMPANY_MISMATCH' : 'PLAN_REFERENCE_MISMATCH';
    await sb.from('billing_payments').update({ metadata: { ...(local.metadata || {}), ...evidence, rejection_code: code }, updated_at: new Date().toISOString() }).eq('id', local.id).eq('company_id', local.company_id);
    await updateEvent({ status: 'failed', error_message: code, processed_at: new Date().toISOString() }, evidence);
    return json({ code }, 422);
  }
  const providerAmountMinor = Number.isFinite(Number(payment.amount || resource.total_amount || resource.transaction_amount)) ? Math.round(Number(payment.amount || resource.total_amount || resource.transaction_amount) * 100) : null;
  const providerCurrency = String(payment.currency_id || resource.currency_id || (resource.country_code === 'BRA' ? 'BRL' : '')).toUpperCase();
  const expectedAmountMinor = Number(checkout?.amount_minor);
  const expectedCurrency = String(plan?.currency || local.currency || '').toUpperCase();
  if (providerAmountMinor == null || providerAmountMinor !== expectedAmountMinor || providerAmountMinor !== Number(local.amount_minor) || plan?.price_minor == null || Number(plan.price_minor) !== expectedAmountMinor) {
    const rejection = { ...evidence, rejection_code: 'PAYMENT_AMOUNT_MISMATCH', provider_amount_minor: providerAmountMinor, expected_amount_minor: expectedAmountMinor, provider_currency: providerCurrency, expected_currency: expectedCurrency };
    await sb.from('billing_payments').update({ provider_status: payment.status || resource.status || null, status: 'rejected', updated_at: new Date().toISOString(), metadata: { ...(local.metadata || {}), ...rejection } }).eq('id', local.id).eq('company_id', local.company_id);
    await updateEvent({ status: 'failed', error_message: 'PAYMENT_AMOUNT_MISMATCH', processed_at: new Date().toISOString() }, rejection);
    return json({ code: 'PAYMENT_AMOUNT_MISMATCH' }, 422);
  }
  if (providerCurrency !== expectedCurrency) {
    const rejection = { ...evidence, rejection_code: 'PAYMENT_CURRENCY_MISMATCH', provider_currency: providerCurrency, expected_currency: expectedCurrency };
    await sb.from('billing_payments').update({ provider_status: payment.status || resource.status || null, status: 'rejected', updated_at: new Date().toISOString(), metadata: { ...(local.metadata || {}), ...rejection } }).eq('id', local.id).eq('company_id', local.company_id);
    await updateEvent({ status: 'failed', error_message: 'PAYMENT_CURRENCY_MISMATCH', processed_at: new Date().toISOString() }, rejection);
    return json({ code: 'PAYMENT_CURRENCY_MISMATCH' }, 422);
  }
  const status = normalized.status;
  const paidAt = status === 'approved' ? new Date().toISOString() : null;
  await sb.from('billing_payments').update({ provider_status: payment.status || resource.status || null, status, paid_at: paidAt, updated_at: new Date().toISOString(), metadata: { ...(local.metadata || {}), ...evidence } }).eq('id', local.id).eq('company_id', local.company_id);
  const checkoutStatus = status === 'approved' ? 'approved' : status === 'pending' || status === 'refunded' ? 'pending' : 'failed';
  await sb.from('billing_checkout_sessions').update({ status: checkoutStatus, updated_at: new Date().toISOString() }).eq('id', checkout.id).eq('company_id', local.company_id);
  if (status === 'approved' && normalized.activationEligible) {
    const periodStart = new Date();
    await sb.from('company_subscriptions').upsert({ company_id: checkout.company_id, plan: plan.code, status: 'active', trial_used: true, current_period_start: periodStart.toISOString(), current_period_end: periodEnd(periodStart, plan.billing_period).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
    await sb.from('audit_logs').insert({ company_id: checkout.company_id, action: 'billing.subscription_activated', entity: 'company_subscriptions', entity_id: checkout.company_id, new_data: { plan: plan.code, payment_id: paymentId, order_id: isOrder ? resourceId : null, ...evidence } });
  }
  await updateEvent({ status: 'processed', processed: true, processed_at: new Date().toISOString() }, evidence);
  return json({ code: 'OK', status });
});
