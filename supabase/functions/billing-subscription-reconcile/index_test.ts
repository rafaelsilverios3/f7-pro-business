import { handleBillingSubscriptionReconcile } from './index.ts';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const checkoutId = '5a9a0e8c-4096-4b28-8f3b-0dc4ab35ad3f';
const subId = 'preapproval-test-01';
const claim = { id: '4f847735-c824-46f0-bdfd-4296dc63442e', company_id: '80447da8-38ca-4c1f-927f-ad53c6aa9152', checkout_id: checkoutId, plan_id: '7b48f19b-65ee-4f35-b115-4de692ae21c3', provider_subscription_id: subId, amount_minor: 1990, currency: 'BRL', billing_period_snapshot: 'month', lease_token: '9b7445b4-0662-4fd9-bc0c-492888b6e5a0' };

function fixture(options: { sellerId?: string } = {}) {
  const events = new Map<string, any>();
  const settlements: any[] = [];
  const finished: boolean[] = [];
  const calls: string[] = [];
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'claim_billing_subscription_reconciliation_v1') return { data: [claim], error: null };
      if (name === 'finish_billing_subscription_reconciliation_v1') { finished.push(args.p_success); return { data: { code: 'OK' }, error: null }; }
      if (name === 'settle_billing_recurring_event') { settlements.push(args); const event = [...events.values()].find((e) => e.id === args.p_event_id); if (event) { event.processed = true; event.status = 'processed'; } return { data: { code: 'OK', status: args.p_payment_status || 'authorized' }, error: null }; }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      if (table !== 'billing_webhook_events') throw new Error(`unexpected table ${table}`);
      let mode = ''; let values: any; let filter: any; let inserted: any;
      const q: any = {
        insert(v: any) { mode = 'insert'; values = v; return q; },
        update(v: any) { mode = 'update'; values = v; return q; },
        select() { return q; },
        eq(k: string, v: any) { filter = { ...(filter || {}), [k]: v }; return q; },
        is(k: string, v: any) { filter = { ...(filter || {}), [k]: v }; return q; },
        async maybeSingle() {
          if (mode === 'insert') {
            if (events.has(values.provider_event_id)) return { data: null, error: { code: '23505' } };
            inserted = { ...values, id: crypto.randomUUID() }; events.set(values.provider_event_id, inserted); return { data: { id: inserted.id }, error: null };
          }
          const found = [...events.values()].find((e) => e.id === filter?.id || e.provider_event_id === filter?.provider_event_id);
          if (mode === 'update' && found) { Object.assign(found, values); return { data: { id: found.id }, error: null }; }
          return { data: found || null, error: null };
        },
      };
      return q;
    },
  };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input)); calls.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === 'api.mercadolibre.com' && url.pathname === '/users/me') return Response.json({ id: options.sellerId || '123456789', site_id: 'MLB', tags: ['test_user'] });
    if (url.hostname !== 'api.mercadopago.com') return new Response('', { status: 404 });
    if (url.pathname === `/preapproval/${subId}`) return Response.json({ id: subId, collector_id: '123456789', external_reference: checkoutId, status: 'authorized', auto_recurring: { transaction_amount: 19.9, currency_id: 'BRL' } });
    if (url.pathname === '/authorized_payments/search') return Response.json({ paging: { offset: 0, limit: 100, total: 1 }, results: [{ id: 'invoice-1', preapproval_id: subId, payment: { id: 'payment-1', status: 'approved' } }] });
    if (url.pathname === '/authorized_payments/invoice-1') return Response.json({ id: 'invoice-1', preapproval_id: subId, payment: { id: 'payment-1', status: 'approved' } });
    if (url.pathname === '/v1/payments/payment-1') return Response.json({ id: 'payment-1', collector_id: '123456789', external_reference: checkoutId, transaction_amount: 19.9, currency_id: 'BRL', status: 'approved', date_approved: '2026-10-19T00:00:00Z' });
    return new Response('', { status: 404 });
  };
  const env = { BILLING_RECONCILIATION_ENABLED: 'true', BILLING_RECONCILIATION_SECRET: 'local-test-secret', MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token', MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: 'false' };
  const request = () => new Request('http://localhost/functions/v1/billing-subscription-reconcile', { method: 'POST', headers: { Authorization: 'Bearer local-test-secret' } });
  return { client, fetcher, env, request, settlements, finished, calls, events };
}

Deno.test('reconciles provider subscription and approved invoice, idempotently', async () => {
  const f = fixture();
  const first = await handleBillingSubscriptionReconcile(f.request(), { adminClient: f.client, providerFetch: f.fetcher, env: f.env });
  assert(first.status === 200, `first reconciliation failed: ${first.status} ${await first.text()}`);
  assert(f.settlements.length === 2, 'subscription plus one payment must settle once');
  assert(f.settlements.some((x) => x.p_event_kind === 'authorized_payment' && x.p_provider_payment_id === 'payment-1' && x.p_amount_minor === 1990 && x.p_currency === 'BRL' && x.p_payment_status === 'approved'), 'approved provider payment evidence was not settled with expected terms');
  const second = await handleBillingSubscriptionReconcile(f.request(), { adminClient: f.client, providerFetch: f.fetcher, env: f.env });
  assert(second.status === 200, 'second reconciliation failed');
  assert(f.settlements.length === 2, 'repeated poll must not settle duplicate provider events');
  assert(f.finished.length === 2 && f.finished.every(Boolean), 'successful leases must be released');
});

Deno.test('rejects unauthorized callers before provider or database access', async () => {
  const f = fixture();
  const response = await handleBillingSubscriptionReconcile(new Request('http://localhost', { method: 'POST' }), { adminClient: f.client, providerFetch: f.fetcher, env: f.env });
  assert(response.status === 401, 'missing scheduler secret must be unauthorized');
  assert(f.calls.length === 0 && f.settlements.length === 0, 'unauthorized request reached dependencies');
});

Deno.test('fails closed on provider seller mismatch and releases lease for backoff retry', async () => {
  const f = fixture();
  const mismatchFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.mercadolibre.com') return Response.json({ id: '123456789', site_id: 'MLB', tags: ['test_user'] });
    if (url.pathname === `/preapproval/${subId}`) return Response.json({ id: subId, collector_id: 'other-seller', external_reference: checkoutId, status: 'authorized', auto_recurring: { transaction_amount: 19.9, currency_id: 'BRL' } });
    return new Response('', { status: 404 });
  };
  const response = await handleBillingSubscriptionReconcile(f.request(), { adminClient: f.client, providerFetch: mismatchFetch, env: f.env });
  assert(response.status === 200, 'batch should complete with an item retry');
  assert(f.settlements.length === 0, 'seller mismatch must not settle');
  assert(f.finished.length === 1 && !f.finished[0], 'failed item must be released for bounded retry');
});

Deno.test('disabled gate cannot query provider or database', async () => {
  const f = fixture(); f.env.BILLING_RECONCILIATION_ENABLED = 'false';
  const unauthorized = await handleBillingSubscriptionReconcile(new Request('http://localhost', { method: 'POST' }), { adminClient: f.client, providerFetch: f.fetcher, env: f.env });
  assert(unauthorized.status === 401, 'disabled gate must not bypass scheduler authentication');
  const response = await handleBillingSubscriptionReconcile(f.request(), { adminClient: f.client, providerFetch: f.fetcher, env: f.env });
  assert(response.status === 503, 'disabled reconciliation must fail closed');
  assert((await response.json()).code === 'RECONCILIATION_DISABLED', 'authenticated caller should receive disabled status');
  assert(f.calls.length === 0 && f.settlements.length === 0, 'disabled gate reached dependencies');
});
