import { admin, corsHeaders, json } from '../_shared/core.ts';
import { blocksLiveBillingInHomologation } from '../_shared/billingEnvironment.ts';
import { verifyMercadoPagoCredentialEnvironment } from '../_shared/mercadoPagoCredentials.ts';

const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeProviderLabel = (value: unknown) => {
  const label = String(value || '').toLowerCase();
  return /^[a-z][a-z0-9_]{0,31}$/.test(label) ? label : null;
};
const safeDiagnosticId = (value: unknown) => {
  const id = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : null;
};
const resourceFingerprint = async (value: string) => {
  if (!value) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

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
  const queryDataId = url.searchParams.get('data.id') ?? url.searchParams.get('data_id');
  if (queryDataId) return { value: queryDataId, origin: 'query' };
  const rawBodyDataId = body?.data?.id ?? body?.id;
  const bodyDataId = rawBodyDataId === null || rawBodyDataId === undefined ? '' : String(rawBodyDataId);
  return { value: bodyDataId, origin: bodyDataId ? 'body' : 'none' };
};

export async function validateSignature(req: Request, body: any) {
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';
  const signature = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const resolvedDataId = resolveDataId(req, body);
  const dataId = resolvedDataId.value;
  const environment = (Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || 'unconfigured').trim().toLowerCase();
  const diagnosticId = safeDiagnosticId(req.headers.get('x-f7-diagnostic-id'));
  const diagnosticContext = {
    timestamp: new Date().toISOString(),
    diagnostic_id: diagnosticId,
    environment: ['test', 'production'].includes(environment) ? environment : 'unconfigured',
    type: safeProviderLabel(body?.type || body?.action) || 'unknown',
    resource_fingerprint: await resourceFingerprint(dataId),
  };
  const ts = signature.match(/(?:^|,)ts=([^,]+)/)?.[1] || '';
  const v1 = signature.match(/(?:^|,)v1=([^,]+)/)?.[1] || '';
  const diagnostics = { event: 'BILLING_WEBHOOK_SIGNATURE_CHECK', ...diagnosticContext, x_request_id_present: Boolean(requestId), x_signature_present: Boolean(signature), timestamp_present: Boolean(ts), data_id_present: Boolean(dataId), data_id_origin: resolvedDataId.origin, received_digest_length: v1.length };
  const invalid = (reason: string) => { console.error(JSON.stringify({ ...diagnostics, result: 'invalid', reason })); return { valid: false, dataId }; };
  if (!secret) return invalid('secret_missing');
  if (!ts || !v1 || !dataId) return invalid('required_signature_field_missing');
  if (!isWebhookTimestampValid(ts)) return invalid('timestamp_invalid_or_expired');
  // The signature covers the raw data.id value. Do not normalize its case:
  // uppercase and mixed-case IDs are signed exactly as Mercado Pago sends them.
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
export async function handleBillingWebhookRequest(req: Request, dependencies: { adminClient?: any; providerFetch?: typeof fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const sb = dependencies.adminClient || admin();
  const providerFetch = dependencies.providerFetch || fetch;
  const body = await req.json().catch(() => ({}));
  const signature = await validateSignature(req, body);
  if (!signature.valid) return json({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const environment = (Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || '').trim().toLowerCase();
  if (blocksLiveBillingInHomologation(environment)) return json({ code: 'HOMOLOGATION_LIVE_PAYMENTS_DISABLED' }, 409);
  const providerToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
  const productionPaymentsEnabled = (Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') || '').trim().toLowerCase() === 'true';
  if (!['test', 'production'].includes(environment) || !providerToken) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 503);
  if (environment === 'production' && !productionPaymentsEnabled) return json({ code: 'MERCADO_PAGO_PRODUCTION_DISABLED' }, 503);
  if (typeof body?.live_mode !== 'boolean' || body.live_mode !== (environment === 'production')) {
    console.error(JSON.stringify({
      event: 'BILLING_WEBHOOK_MODE_CHECK',
      timestamp: new Date().toISOString(),
      diagnostic_id: safeDiagnosticId(req.headers.get('x-f7-diagnostic-id')),
      environment: ['test', 'production'].includes(environment) ? environment : 'unconfigured',
      type: safeProviderLabel(body?.type || body?.action) || 'unknown',
      resource_fingerprint: await resourceFingerprint(signature.dataId),
      live_mode_type: typeof body?.live_mode,
      live_mode: typeof body?.live_mode === 'boolean' ? body.live_mode : null,
      result: 'rejected',
      reason: 'environment_mismatch',
    }));
    return json({ code: 'WEBHOOK_MODE_MISMATCH' }, 409);
  }
  const credentialCheck = await verifyMercadoPagoCredentialEnvironment(providerToken, environment as 'test' | 'production', providerFetch);
  if (credentialCheck !== 'verified') {
    return json({ code: 'MERCADO_PAGO_CREDENTIAL_ENVIRONMENT_UNVERIFIED' }, credentialCheck === 'unavailable' ? 503 : 409);
  }
  const eventId = clean(body?.id || body?.data?.id);
  const type = clean(body?.type || body?.action, 80);
  const resourceId = clean(signature.dataId || body?.data?.object_id);
  const isOrder = type === 'order' || type.startsWith('order.');
  if (!eventId || !type) return json({ code: 'INVALID_WEBHOOK_EVENT' }, 422);
  const processingToken = crypto.randomUUID();
  const leaseDurationMs = 2 * 60 * 1000;
  let eventMetadata: Record<string, unknown> = { live_mode: Boolean(body?.live_mode) };
  let eventRecordId: string | null = null;
  const { data: existingEvent, error: eventReadError } = await sb.from('billing_webhook_events').select('id,status,processed,processed_at,metadata').eq('provider_event_id', eventId).maybeSingle();
  if (eventReadError) return json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
  if (existingEvent) {
    eventRecordId = existingEvent.id;
    const startedAt = Date.parse(String(existingEvent.metadata?.processing_started_at || ''));
    const leaseActive = Boolean(existingEvent.metadata?.processing_token) && Number.isFinite(startedAt) && Date.now() - startedAt < leaseDurationMs;
    if (leaseActive) return json({ code: 'WEBHOOK_PROCESSING' }, 503);
    const legacyEventNeedsReconciliation = existingEvent.status === 'processed' && !existingEvent.metadata?.normalized_payment_status;
    if (!legacyEventNeedsReconciliation && (existingEvent.processed || ['processed', 'ignored'].includes(existingEvent.status))) return json({ code: 'OK', duplicate: true });
    eventMetadata = { ...(existingEvent.metadata || {}), live_mode: Boolean(body?.live_mode), processing_token: processingToken, processing_started_at: new Date().toISOString() };
    // Compare-and-swap the JSONB metadata snapshot. Only one concurrent retry
    // may acquire an expired/unclaimed event; no schema change is needed.
    let claimQuery = sb.from('billing_webhook_events').update({ status: existingEvent.status, processed: Boolean(existingEvent.processed), metadata: eventMetadata })
      .eq('id', existingEvent.id).eq('status', existingEvent.status).eq('processed', Boolean(existingEvent.processed));
    claimQuery = existingEvent.metadata?.processing_token
      ? claimQuery.eq('metadata->>processing_token', existingEvent.metadata.processing_token)
      : claimQuery.is('metadata->>processing_token', null);
    const claimed = await claimQuery.select('id').maybeSingle();
    if (claimed.error) return json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
    if (!claimed.data?.id) return json({ code: 'WEBHOOK_PROCESSING' }, 503);
  } else {
    eventMetadata = { live_mode: Boolean(body?.live_mode), processing_token: processingToken, processing_started_at: new Date().toISOString() };
    const inserted = await sb.from('billing_webhook_events').insert({ provider: 'mercado_pago', provider_event_id: eventId, event_type: type, provider_resource_id: resourceId, status: 'received', metadata: eventMetadata }).select('id').single();
    if (inserted.error?.code === '23505') return json({ code: 'WEBHOOK_PROCESSING' }, 503);
    if (inserted.error) return json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
    eventRecordId = inserted.data?.id || null;
  }
  const updateEvent = async (values: Record<string, unknown>, evidence: Record<string, unknown> = {}) => {
    const metadata: Record<string, unknown> = { ...eventMetadata, live_mode: Boolean(body?.live_mode), ...evidence };
    const terminalOrRetryable = ['processed', 'ignored', 'failed'].includes(String(values.status || ''));
    if (terminalOrRetryable) {
      delete metadata.processing_token;
      delete metadata.processing_started_at;
    }
    const result = await sb.from('billing_webhook_events').update({ ...values, metadata })
      .eq('provider_event_id', eventId).eq('metadata->>processing_token', processingToken).select('id').maybeSingle();
    if (result.error || !result.data?.id) {
      console.error(JSON.stringify({ event: 'BILLING_WEBHOOK_EVENT_UPDATE_FAILED', operation: String(values.status || 'update'), provider: 'mercado_pago', error_code: result.error?.code || 'LEASE_NOT_OWNED' }));
      return false;
    }
    return true;
  };
  const isRecurringSubscription = type === 'subscription_preapproval' || type.startsWith('subscription_preapproval.');
  const isRecurringInvoice = type === 'subscription_authorized_payment' || type.startsWith('subscription_authorized_payment.');
  if (isRecurringSubscription || isRecurringInvoice) {
    if (!eventRecordId || !resourceId) {
      const saved = await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_RESOURCE_ID_MISSING' });
      return saved ? json({ code: 'INVALID_WEBHOOK_EVENT' }, 422) : json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
    }
    const fetchProviderObject = async (url: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const result = await providerFetch(url, { headers: { Authorization: `Bearer ${providerToken}` }, signal: controller.signal });
        const raw = await result.text();
        let value: any = {};
        try { value = raw ? JSON.parse(raw) : {}; } catch { value = {}; }
        return { response: result, value };
      } finally { clearTimeout(timeout); }
    };
    try {
      if (isRecurringSubscription) {
        const { response, value } = await fetchProviderObject(`https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`);
        if (!response.ok) {
          console.error(JSON.stringify({ event: 'BILLING_PROVIDER_REQUEST_FAILED', provider: 'mercado_pago', operation: 'get_subscription', http_status: response.status, request_id_present: Boolean(response.headers.get('x-request-id')) }));
          await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'SUBSCRIPTION_LOOKUP_FAILED' });
          return json({ code: 'SUBSCRIPTION_LOOKUP_FAILED' }, 502);
        }
        const providerSubscriptionId = clean(value.id, 120);
        if (!providerSubscriptionId || !value.status) {
          await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_RESPONSE_INCOMPLETE' });
          return json({ code: 'PROVIDER_RESPONSE_INCOMPLETE' }, 502);
        }
        const rawCheckoutId = clean(value.external_reference, 80);
        const checkoutId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawCheckoutId) ? rawCheckoutId : null;
        const settled = await sb.rpc('settle_billing_recurring_event', {
          p_event_id: eventRecordId, p_processing_token: processingToken, p_event_kind: 'preapproval',
          p_checkout_id: checkoutId, p_provider_subscription_id: providerSubscriptionId,
          p_provider_payment_id: null, p_provider_status: clean(value.status, 80), p_payment_status: null,
          p_amount_minor: null, p_currency: null, p_paid_at: null,
        });
        if (settled.error) return json({ code: 'BILLING_SETTLEMENT_RETRYABLE' }, 503);
        if (settled.data?.code !== 'OK') return json({ code: clean(settled.data?.code, 80) || 'BILLING_SETTLEMENT_REJECTED' }, 422);
        return json({ code: 'OK', status: settled.data.status || 'pending', duplicate: Boolean(settled.data.duplicate), ignored: Boolean(settled.data.ignored) });
      }

      const invoiceResult = await fetchProviderObject(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(resourceId)}`);
      if (!invoiceResult.response.ok) {
        console.error(JSON.stringify({ event: 'BILLING_PROVIDER_REQUEST_FAILED', provider: 'mercado_pago', operation: 'get_subscription_invoice', http_status: invoiceResult.response.status, request_id_present: Boolean(invoiceResult.response.headers.get('x-request-id')) }));
        await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'SUBSCRIPTION_INVOICE_LOOKUP_FAILED' });
        return json({ code: 'SUBSCRIPTION_INVOICE_LOOKUP_FAILED' }, 502);
      }
      const invoice = invoiceResult.value;
      const invoicePaymentId = clean(invoice.payment?.id, 120);
      const providerSubscriptionId = clean(invoice.preapproval_id, 120);
      if (!invoicePaymentId || !providerSubscriptionId) {
        await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_RESPONSE_INCOMPLETE' });
        return json({ code: 'PROVIDER_RESPONSE_INCOMPLETE' }, 502);
      }
      const paymentResult = await fetchProviderObject(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(invoicePaymentId)}`);
      if (!paymentResult.response.ok) {
        console.error(JSON.stringify({ event: 'BILLING_PROVIDER_REQUEST_FAILED', provider: 'mercado_pago', operation: 'get_subscription_payment', http_status: paymentResult.response.status, request_id_present: Boolean(paymentResult.response.headers.get('x-request-id')) }));
        await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'SUBSCRIPTION_PAYMENT_LOOKUP_FAILED' });
        return json({ code: 'SUBSCRIPTION_PAYMENT_LOOKUP_FAILED' }, 502);
      }
      const payment = paymentResult.value;
      const paymentId = clean(payment.id, 120);
      const paymentStatus = normalizeLegacyPaymentStatus(payment.status).status;
      const providerAmount = payment.transaction_amount;
      const amount = providerAmount === null || providerAmount === undefined || providerAmount === '' ? Number.NaN : Number(providerAmount);
      const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : null;
      const currency = String(payment.currency_id || invoice.currency_id || '').toUpperCase();
      if (!paymentId || amountMinor === null || !currency) {
        await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_RESPONSE_INCOMPLETE' });
        return json({ code: 'PROVIDER_RESPONSE_INCOMPLETE' }, 502);
      }
      const rawCheckoutId = clean(invoice.external_reference, 80);
      const checkoutId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawCheckoutId) ? rawCheckoutId : null;
      const paidAtSource = payment.date_approved || invoice.last_modified || payment.date_created;
      const paidAtParsed = paidAtSource ? new Date(String(paidAtSource)) : new Date();
      const paidAt = payment.status === 'approved'
        ? (Number.isFinite(paidAtParsed.getTime()) ? paidAtParsed.toISOString() : new Date().toISOString())
        : null;
      const settled = await sb.rpc('settle_billing_recurring_event', {
        p_event_id: eventRecordId, p_processing_token: processingToken, p_event_kind: 'authorized_payment',
        p_checkout_id: checkoutId, p_provider_subscription_id: providerSubscriptionId,
        p_provider_payment_id: paymentId, p_provider_status: clean(payment.status, 80), p_payment_status: paymentStatus,
        p_amount_minor: amountMinor, p_currency: currency, p_paid_at: paidAt,
      });
      if (settled.error) return json({ code: 'BILLING_SETTLEMENT_RETRYABLE' }, 503);
      if (settled.data?.code !== 'OK') return json({ code: clean(settled.data?.code, 80) || 'BILLING_SETTLEMENT_REJECTED' }, 422);
      return json({ code: 'OK', status: settled.data.status || paymentStatus, duplicate: Boolean(settled.data.duplicate), access_granted: settled.data.access_granted !== false });
    } catch {
      await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_LOOKUP_UNAVAILABLE' });
      return json({ code: 'SUBSCRIPTION_LOOKUP_FAILED' }, 502);
    }
  }
  if ((!isOrder && type !== 'payment') || !resourceId) { const saved = await updateEvent({ status: 'ignored', processed: true, processed_at: new Date().toISOString() }); return saved ? json({ code: 'OK', ignored: true }) : json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500); }
  const token = providerToken;
  const endpoint = isOrder ? `https://api.mercadopago.com/v1/orders/${encodeURIComponent(resourceId)}` : `https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`;
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try { response = await providerFetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  } catch {
    await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_LOOKUP_UNAVAILABLE' });
    return json({ code: isOrder ? 'ORDER_LOOKUP_FAILED' : 'PAYMENT_LOOKUP_FAILED' }, 502);
  }
  const rawBody = await response.text();
  let resource: any = {};
  try { resource = rawBody ? JSON.parse(rawBody) : {}; } catch { resource = {}; }
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'BILLING_PROVIDER_REQUEST_FAILED', provider: 'mercado_pago', operation: isOrder ? 'get_order' : 'get_payment', http_status: response.status, request_id_present: Boolean(response.headers.get('x-request-id')), timestamp: new Date().toISOString() }));
    await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: isOrder ? 'ORDER_LOOKUP_FAILED' : 'PAYMENT_LOOKUP_FAILED' });
    return json({ code: isOrder ? 'ORDER_LOOKUP_FAILED' : 'PAYMENT_LOOKUP_FAILED' }, 502);
  }
  const payment = isOrder ? (resource.transactions?.payments?.[0] || {}) : resource;
  const providerEvidence = {
    provider_order_status: isOrder ? safeProviderLabel(resource.status) : null,
    provider_order_status_detail: isOrder ? safeProviderLabel(resource.status_detail) : null,
    provider_transaction_status: isOrder ? safeProviderLabel(payment.status) : safeProviderLabel(resource.status),
    provider_transaction_status_detail: isOrder ? safeProviderLabel(payment.status_detail) : safeProviderLabel(resource.status_detail),
  };
  const normalized = isOrder
    ? normalizeOrdersPaymentStatus({ orderStatus: resource.status, orderStatusDetail: resource.status_detail, transactionStatus: payment.status, transactionStatusDetail: payment.status_detail })
    : normalizeLegacyPaymentStatus(payment.status || resource.status);
  const evidence = { ...providerEvidence, normalized_payment_status: normalized.status, normalization_reason: normalized.reason };
  console.error(JSON.stringify({ event: 'BILLING_WEBHOOK_STATUS_NORMALIZED', provider: 'mercado_pago', timestamp: new Date().toISOString(), diagnostic_id: safeDiagnosticId(req.headers.get('x-f7-diagnostic-id')), environment, type: safeProviderLabel(type) || 'unknown', resource_fingerprint: await resourceFingerprint(signature.dataId), ...evidence }));
  const paymentId = clean(payment.id);
  const externalReference = clean(resource.external_reference || payment.external_reference);
  const providerAmountValue = payment.amount ?? resource.total_amount ?? resource.transaction_amount;
  const providerAmount = providerAmountValue === null || providerAmountValue === undefined || providerAmountValue === '' ? Number.NaN : Number(providerAmountValue);
  const providerAmountMinor = Number.isFinite(providerAmount) ? Math.round(providerAmount * 100) : null;
  // Mercado Pago Orders responses omit currency_id for Brazilian PIX orders.
  // `verified` here means the access token identity was verified as an MLB
  // account, so BRL is the provider market currency. Explicit provider values
  // remain authoritative and are still checked against the purchase/session.
  const providerCurrency = String(payment.currency_id || resource.currency_id || (isOrder && credentialCheck === 'verified' ? 'BRL' : '')).toUpperCase();
  if (!eventRecordId) return json({ code: 'WEBHOOK_EVENT_NOT_AVAILABLE' }, 503);
  if (!paymentId || providerAmountMinor === null || !providerCurrency) {
    await updateEvent({ status: 'failed', processed: false, processed_at: null, error_message: 'PROVIDER_RESPONSE_INCOMPLETE' }, evidence);
    return json({ code: 'PROVIDER_RESPONSE_INCOMPLETE' }, 502);
  }
  const purchaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(externalReference) ? externalReference : null;
  if (purchaseId) {
    const creditStatus = normalized.activationEligible ? 'approved'
      : ['refunded','charged_back'].includes(normalized.status) ? 'refunded'
        : ['rejected','cancelled'].includes(normalized.status) ? normalized.status : 'pending';
    const creditSettlement = await sb.rpc('settle_ai_credit_purchase_v1', {
      p_purchase_id: purchaseId, p_payment_id: paymentId, p_status: creditStatus,
      p_amount_minor: providerAmountMinor, p_currency: providerCurrency,
    });
    if (creditSettlement.error) return json({ code: 'AI_CREDIT_PURCHASE_SETTLEMENT_RETRYABLE' }, 503);
    if (creditSettlement.data?.code !== 'AI_CREDIT_PURCHASE_NOT_FOUND') {
      if (creditSettlement.data?.code !== 'OK') return json({ code: clean(creditSettlement.data?.code, 80) || 'AI_CREDIT_PURCHASE_SETTLEMENT_REJECTED' }, 422);
      await updateEvent({ status: 'processed', processed: true, processed_at: new Date().toISOString() }, evidence);
      return json({ code: 'OK', status: creditSettlement.data.status || creditStatus, credited: Boolean(creditSettlement.data.credited), duplicate: Boolean(creditSettlement.data.duplicate) });
    }
  }
  const settled = await sb.rpc('settle_billing_webhook_event', {
    p_event_id: eventRecordId,
    p_processing_token: processingToken,
    p_provider_payment_id: paymentId,
    p_provider_order_id: isOrder ? resourceId : null,
    p_external_reference: externalReference || null,
    p_provider_status: payment.status || resource.status || null,
    p_normalized_status: normalized.status,
    p_provider_amount_minor: providerAmountMinor,
    p_provider_currency: providerCurrency,
    p_evidence: evidence,
    p_paid_at: normalized.activationEligible ? new Date().toISOString() : null,
  });
  if (settled.error) {
    console.error(JSON.stringify({ event: 'BILLING_SETTLEMENT_FAILED', provider: 'mercado_pago', error_code: settled.error.code || 'DATABASE_ERROR' }));
    return json({ code: 'BILLING_SETTLEMENT_RETRYABLE' }, 503);
  }
  const settlement = settled.data || {};
  if (settlement.code !== 'OK') return json({ code: clean(settlement.code, 80) || 'BILLING_SETTLEMENT_REJECTED' }, 422);
  return json({ code: 'OK', status: settlement.status || normalized.status, duplicate: Boolean(settlement.duplicate), ignored: Boolean(settlement.ignored) });
}

if (import.meta.main) Deno.serve((req) => handleBillingWebhookRequest(req));
