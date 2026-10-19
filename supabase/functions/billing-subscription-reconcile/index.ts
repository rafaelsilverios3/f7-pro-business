import { admin, corsHeaders, json } from '../_shared/core.ts';
import { blocksBillingEnvironmentMismatch } from '../_shared/billingEnvironment.ts';
import { getMercadoPagoCredentialIdentity } from '../_shared/mercadoPagoCredentials.ts';

type Claim = {
  id: string;
  company_id: string;
  checkout_id: string;
  plan_id: string;
  provider_subscription_id: string;
  amount_minor: number;
  currency: string;
  billing_period_snapshot: 'month' | 'year';
  lease_token: string;
};

const clean = (value: unknown, max = 120) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const timingSafeEqual = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};
const uuid = (value: unknown) => {
  const raw = clean(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
};
const minorUnits = (value: unknown) => {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100 ? Math.round(n * 100) : null;
};
const paymentStatus = (payment: any) => {
  const status = String(payment?.status || '').toLowerCase();
  const detail = String(payment?.status_detail || '').toLowerCase();
  if (status === 'refunded' || detail.includes('refund')) return 'refunded';
  if (status === 'charged_back' || status === 'chargeback') return 'charged_back';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'pending';
};
const hashId = async (value: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
};

async function providerGet(url: string, token: string, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal });
    let body: any = {};
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
    return body;
  } finally { clearTimeout(timeout); }
}

async function claimEvent(sb: any, eventId: string, type: string, resourceId: string) {
  const lease = crypto.randomUUID();
  const metadata = { reconciliation: true, processing_token: lease, processing_started_at: new Date().toISOString() };
  const inserted = await sb.from('billing_webhook_events').insert({ provider: 'mercado_pago', provider_event_id: eventId, event_type: type, provider_resource_id: resourceId, status: 'received', processed: false, metadata }).select('id').maybeSingle();
  if (!inserted.error && inserted.data?.id) return { id: inserted.data.id, lease };
  if (inserted.error?.code !== '23505') throw new Error('RECONCILIATION_EVENT_WRITE_FAILED');
  const existing = await sb.from('billing_webhook_events').select('id,status,processed,metadata').eq('provider_event_id', eventId).maybeSingle();
  if (existing.error || !existing.data?.id) throw new Error('RECONCILIATION_EVENT_READ_FAILED');
  if (existing.data.processed || ['processed','ignored'].includes(String(existing.data.status))) return null;
  const started = Date.parse(String(existing.data.metadata?.processing_started_at || ''));
  if (existing.data.metadata?.processing_token && Number.isFinite(started) && Date.now() - started < 120_000) return null;
  let query = sb.from('billing_webhook_events').update({ status: existing.data.status, processed: false, metadata: { ...(existing.data.metadata || {}), ...metadata } })
    .eq('id', existing.data.id).eq('status', existing.data.status).eq('processed', false);
  query = existing.data.metadata?.processing_token
    ? query.eq('metadata->>processing_token', existing.data.metadata.processing_token)
    : query.is('metadata->>processing_token', null);
  const updated = await query.select('id').maybeSingle();
  if (updated.error) throw new Error('RECONCILIATION_EVENT_CLAIM_FAILED');
  return updated.data?.id ? { id: updated.data.id, lease } : null;
}

async function settle(sb: any, input: {
  kind: 'preapproval' | 'authorized_payment'; claim: Claim; providerStatus: string;
  paymentId?: string; paymentStatus?: string; amountMinor?: number; currency?: string; paidAt?: string | null;
  resourceId: string;
}) {
  const type = input.kind === 'preapproval' ? 'subscription_preapproval.reconciliation' : 'subscription_authorized_payment.reconciliation';
  const eventId = `f7reconcile-${await hashId(`${input.kind}:${input.claim.provider_subscription_id}:${input.resourceId}:${input.providerStatus}:${input.paymentStatus || ''}`)}`;
  const event = await claimEvent(sb, eventId, type, input.resourceId);
  if (!event) return { duplicate: true };
  const result = await sb.rpc('settle_billing_recurring_event', {
    p_event_id: event.id,
    p_processing_token: event.lease,
    p_event_kind: input.kind,
    p_checkout_id: input.claim.checkout_id,
    p_provider_subscription_id: input.claim.provider_subscription_id,
    p_provider_payment_id: input.paymentId || null,
    p_provider_status: input.providerStatus,
    p_payment_status: input.paymentStatus || null,
    p_amount_minor: input.amountMinor ?? null,
    p_currency: input.currency || null,
    p_paid_at: input.paidAt || null,
  });
  if (result.error || result.data?.code !== 'OK') throw new Error(clean(result.data?.code, 60) || 'BILLING_SETTLEMENT_FAILED');
  return { duplicate: Boolean(result.data?.duplicate), status: clean(result.data?.status, 30) || 'processed' };
}

async function processSubscription(sb: any, token: string, sellerId: string, claim: Claim, fetcher: typeof fetch) {
  const subscription = await providerGet(`https://api.mercadopago.com/preapproval/${encodeURIComponent(claim.provider_subscription_id)}`, token, fetcher);
  if (clean(subscription.id) !== claim.provider_subscription_id || String(subscription.collector_id ?? '') !== sellerId) throw new Error('SUBSCRIPTION_SELLER_OR_ID_MISMATCH');
  if (uuid(subscription.external_reference) !== claim.checkout_id) throw new Error('SUBSCRIPTION_REFERENCE_MISMATCH');
  const recurring = subscription.auto_recurring || {};
  if (minorUnits(recurring.transaction_amount) !== Number(claim.amount_minor) || String(recurring.currency_id || '').toUpperCase() !== String(claim.currency).toUpperCase()) throw new Error('SUBSCRIPTION_TERMS_MISMATCH');
  const status = clean(subscription.status, 60).toLowerCase();
  if (!status) throw new Error('SUBSCRIPTION_STATUS_MISSING');
  const outcomes = [await settle(sb, { kind: 'preapproval', claim, providerStatus: status, resourceId: claim.provider_subscription_id })];

  let offset = 0;
  const pageSize = 100;
  let total = Number.POSITIVE_INFINITY;
  let pages = 0;
  while (offset < total && pages < 10) {
    const searchUrl = new URL('https://api.mercadopago.com/authorized_payments/search');
    searchUrl.searchParams.set('preapproval_id', claim.provider_subscription_id);
    searchUrl.searchParams.set('limit', String(pageSize));
    searchUrl.searchParams.set('offset', String(offset));
    const search = await providerGet(searchUrl.toString(), token, fetcher);
    const invoices = Array.isArray(search.results) ? search.results : [];
    total = Number(search.paging?.total ?? invoices.length);
    for (const invoiceRow of invoices) {
      const invoiceId = clean(invoiceRow?.id, 120);
      if (!invoiceId || clean(invoiceRow?.preapproval_id, 120) !== claim.provider_subscription_id) continue;
      const invoice = await providerGet(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(invoiceId)}`, token, fetcher);
      if (clean(invoice.id, 120) !== invoiceId || clean(invoice.preapproval_id, 120) !== claim.provider_subscription_id) throw new Error('INVOICE_SUBSCRIPTION_MISMATCH');
      const paymentId = clean(invoice.payment?.id, 120);
      if (!paymentId) continue; // Not yet charged; subsequent scheduled runs will observe it.
      const payment = await providerGet(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, token, fetcher);
      if (clean(payment.id, 120) !== paymentId || String(payment.collector_id ?? '') !== sellerId) throw new Error('PAYMENT_SELLER_OR_ID_MISMATCH');
      const amount = minorUnits(payment.transaction_amount);
      const currency = String(payment.currency_id || '').toUpperCase();
      if (amount !== Number(claim.amount_minor) || currency !== String(claim.currency).toUpperCase()) throw new Error('PAYMENT_TERMS_MISMATCH');
      const normalized = paymentStatus(payment);
      const paidSource = payment.date_approved || invoice.last_modified || payment.date_created;
      const paidTime = normalized === 'approved' && paidSource && Number.isFinite(Date.parse(String(paidSource))) ? new Date(String(paidSource)).toISOString() : null;
      outcomes.push(await settle(sb, {
        kind: 'authorized_payment', claim, providerStatus: clean(payment.status, 60), paymentId,
        paymentStatus: normalized, amountMinor: amount!, currency, paidAt: paidTime, resourceId: invoiceId,
      }));
    }
    offset += invoices.length;
    pages += 1;
    if (!invoices.length) break;
  }
  if (pages >= 10 && offset < total) throw new Error('INVOICE_PAGE_LIMIT_REACHED');
  return { outcomes: outcomes.length };
}

export async function handleBillingSubscriptionReconcile(req: Request, dependencies: { adminClient?: any; providerFetch?: typeof fetch; env?: Record<string, string | undefined> } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const env = dependencies.env || { BILLING_RECONCILIATION_ENABLED: Deno.env.get('BILLING_RECONCILIATION_ENABLED'), BILLING_RECONCILIATION_SECRET: Deno.env.get('BILLING_RECONCILIATION_SECRET'), MERCADO_PAGO_ENVIRONMENT: Deno.env.get('MERCADO_PAGO_ENVIRONMENT'), MERCADO_PAGO_ACCESS_TOKEN: Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN'), MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') };
  if (env.BILLING_RECONCILIATION_ENABLED !== 'true') return json({ code: 'RECONCILIATION_DISABLED' }, 503);
  const secret = env.BILLING_RECONCILIATION_SECRET || '';
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!secret || !timingSafeEqual(supplied, secret)) return json({ code: 'UNAUTHORIZED' }, 401);
  const environment = (env.MERCADO_PAGO_ENVIRONMENT || '').trim().toLowerCase();
  const token = env.MERCADO_PAGO_ACCESS_TOKEN || '';
  const productionEnabled = (env.MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED || '').trim().toLowerCase() === 'true';
  if (!['test','production'].includes(environment) || !token) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 503);
  if (blocksBillingEnvironmentMismatch(environment)) return json({ code: 'BILLING_ENVIRONMENT_MISMATCH' }, 409);
  if (environment === 'production' && !productionEnabled) return json({ code: 'MERCADO_PAGO_PRODUCTION_DISABLED' }, 503);
  const providerFetch = dependencies.providerFetch || fetch;
  const credentialIdentity = await getMercadoPagoCredentialIdentity(token, environment, providerFetch);
  if (credentialIdentity.check !== 'verified') return json({ code: credentialIdentity.check === 'unavailable' ? 'MERCADO_PAGO_IDENTITY_UNAVAILABLE' : 'MERCADO_PAGO_CREDENTIAL_ENVIRONMENT_MISMATCH' }, credentialIdentity.check === 'unavailable' ? 503 : 409);
  const sellerId = credentialIdentity.sellerId;
  if (!sellerId) return json({ code: 'MERCADO_PAGO_SELLER_IDENTITY_INVALID' }, 409);
  const sb = dependencies.adminClient || admin();
  const limit = Math.min(100, Math.max(1, Number(req.headers.get('x-f7-batch-limit') || 25) || 25));
  const claimed = await sb.rpc('claim_billing_subscription_reconciliation_v1', { p_limit: limit, p_lease_seconds: 120 });
  if (claimed.error || !Array.isArray(claimed.data)) return json({ code: 'RECONCILIATION_CLAIM_FAILED' }, 500);
  let succeeded = 0;
  let retried = 0;
  for (const row of claimed.data as Claim[]) {
    let success = false;
    let failureCode = 'UNKNOWN';
    try {
      await processSubscription(sb, token, sellerId, row, providerFetch);
      success = true;
      succeeded += 1;
    } catch (error) {
      failureCode = error instanceof Error ? clean(error.message, 60) : 'UNKNOWN';
      retried += 1;
      console.error(JSON.stringify({ event: 'BILLING_SUBSCRIPTION_RECONCILIATION_FAILED', timestamp: new Date().toISOString(), environment, subscription_fingerprint: await hashId(row.provider_subscription_id), error_code: failureCode }));
    } finally {
      const finished = await sb.rpc('finish_billing_subscription_reconciliation_v1', { p_subscription_id: row.id, p_lease_token: row.lease_token, p_success: success });
      if (finished.error || finished.data?.code !== 'OK') {
        console.error(JSON.stringify({ event: 'BILLING_SUBSCRIPTION_RECONCILIATION_LEASE_FINISH_FAILED', timestamp: new Date().toISOString(), subscription_fingerprint: await hashId(row.provider_subscription_id) }));
        retried += 1;
      }
    }
  }
  console.log(JSON.stringify({ event: 'BILLING_SUBSCRIPTION_RECONCILIATION_RUN', timestamp: new Date().toISOString(), environment, claimed: claimed.data.length, succeeded, retried }));
  return json({ code: 'OK', claimed: claimed.data.length, succeeded, retried });
}

if (import.meta.main) Deno.serve((req) => handleBillingSubscriptionReconcile(req));
