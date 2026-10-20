import { handleBillingWebhookRequest } from './index.ts';

const TEST_SECRET = 'billing-webhook-local-test-only';
const PLAN_CHECKOUT_ID = '6c7dd73c-2e91-4abe-97a4-e4e6e2bd4671';
const ORDER_ID = 'ORDTST01M5B4CFB5RBFC1VEAPK5K3090';

async function signedRequest(reference: string, orderId = ORDER_ID) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = 'billing-purchase-routing-regression';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:${orderId.toLowerCase()};request-id:${requestId};ts:${timestamp};`));
  const digest = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return new Request(`https://local.invalid/functions/v1/billing-webhook?data.id=${encodeURIComponent(orderId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${digest}` },
    body: JSON.stringify({ id: `event-${orderId}`, type: 'order', action: 'order.processed', live_mode: false, data: { id: orderId }, external_reference: reference }),
  });
}

function createAdminMock(planCheckoutId: string | null, aiRpcError: { code: string } | null = null) {
  const calls: { rpc: string[]; updates: Record<string, unknown>[] } = { rpc: [], updates: [] };
  let nextUpdate = false;
  const builderFor = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters[column] = value; return builder; },
      is: () => builder,
      insert: () => builder,
      update: (values: Record<string, unknown>) => { calls.updates.push(values); nextUpdate = true; return builder; },
      maybeSingle: async () => {
        if (table === 'billing_webhook_events' && !nextUpdate) return { data: null, error: null };
        if (table === 'billing_webhook_events' && nextUpdate) { nextUpdate = false; return { data: { id: 'event-row-id' }, error: null }; }
        if (table === 'billing_checkout_sessions') return { data: planCheckoutId ? { id: planCheckoutId, provider: 'mercado_pago' } : null, error: null };
        if (table === 'billing_payments') return { data: null, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: { id: 'event-row-id' }, error: null }),
    };
    return builder;
  };
  const adminClient = {
    from: (table: string) => builderFor(table),
    rpc: async (name: string) => {
      calls.rpc.push(name);
      if (name === 'settle_ai_credit_purchase_v1' && aiRpcError) return { data: null, error: aiRpcError };
      return { data: { code: 'OK', status: 'approved', duplicate: false, access_granted: true }, error: null };
    },
  };
  return { adminClient, calls };
}

function providerFetchForOrder() {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://api.mercadolibre.com/users/me') {
      return new Response(JSON.stringify({ id: 987654321, site_id: 'MLB', tags: ['test_user'] }), { status: 200 });
    }
    if (url === `https://api.mercadopago.com/v1/orders/${ORDER_ID}`) {
      return new Response(JSON.stringify({
        id: ORDER_ID,
        user_id: 987654321,
        status: 'processed',
        status_detail: 'accredited',
        total_amount: 100,
        external_reference: PLAN_CHECKOUT_ID,
        transactions: { payments: [{ id: 'payment-test-id', amount: 100, currency_id: 'BRL', status: 'processed', status_detail: 'accredited' }] },
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
}

Deno.test('plan payment with UUID reference settles through Billing without requiring AI Credits RPC/schema', async () => {
  const old = {
    secret: Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET'),
    environment: Deno.env.get('MERCADO_PAGO_ENVIRONMENT'),
    token: Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN'),
    supabase: Deno.env.get('SUPABASE_URL'),
    productionGate: Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED'),
  };
  Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', TEST_SECRET);
  Deno.env.set('MERCADO_PAGO_ENVIRONMENT', 'test');
  Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'local-test-token');
  Deno.env.set('SUPABASE_URL', 'https://isolated-test.invalid');
  Deno.env.set('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'false');
  try {
    // AI Credits is intentionally absent: invoking its RPC would return PGRST202.
    const { adminClient, calls } = createAdminMock(PLAN_CHECKOUT_ID, { code: 'PGRST202' });
    const response = await handleBillingWebhookRequest(await signedRequest(PLAN_CHECKOUT_ID), { adminClient, providerFetch: providerFetchForOrder() });
    const payload = await response.json();
    if (response.status !== 200 || payload.code !== 'OK' || payload.status !== 'approved') throw new Error(`expected approved plan settlement, got HTTP ${response.status} ${payload.code}`);
    if (calls.rpc.includes('settle_ai_credit_purchase_v1')) throw new Error('plan payment called the AI Credits settlement RPC');
    if (!calls.rpc.includes('settle_billing_webhook_event')) throw new Error('plan payment did not call Billing settlement');
  } finally {
    for (const [name, value] of Object.entries({
      MERCADO_PAGO_WEBHOOK_SECRET: old.secret,
      MERCADO_PAGO_ENVIRONMENT: old.environment,
      MERCADO_PAGO_ACCESS_TOKEN: old.token,
      SUPABASE_URL: old.supabase,
      MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: old.productionGate,
    })) value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  }
});

Deno.test('unknown UUID payment with AI Credits schema absent stays retryable and is not financially settled', async () => {
  const old = {
    secret: Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET'),
    environment: Deno.env.get('MERCADO_PAGO_ENVIRONMENT'),
    token: Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN'),
    supabase: Deno.env.get('SUPABASE_URL'),
  };
  Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', TEST_SECRET);
  Deno.env.set('MERCADO_PAGO_ENVIRONMENT', 'test');
  Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'local-test-token');
  Deno.env.set('SUPABASE_URL', 'https://isolated-test.invalid');
  try {
    const unknownReference = 'b1aa0b0a-f9c0-4be2-9e5e-b691c4705d13';
    const { adminClient, calls } = createAdminMock(null, { code: 'PGRST202' });
    const response = await handleBillingWebhookRequest(await signedRequest(unknownReference), { adminClient, providerFetch: providerFetchForOrder() });
    const payload = await response.json();
    if (response.status !== 503 || payload.code !== 'BILLING_REFERENCE_PENDING') throw new Error(`expected pending unknown reference, got HTTP ${response.status} ${payload.code}`);
    if (calls.rpc.includes('settle_billing_webhook_event')) throw new Error('unknown reference reached financial settlement');
    if (!calls.updates.some((update) => update.status === 'received' && update.processed === false && update.error_message === 'AI_CREDITS_SCHEMA_UNAVAILABLE')) {
      throw new Error('unknown event was not retained in a retryable auditable state');
    }
  } finally {
    for (const [name, value] of Object.entries({
      MERCADO_PAGO_WEBHOOK_SECRET: old.secret,
      MERCADO_PAGO_ENVIRONMENT: old.environment,
      MERCADO_PAGO_ACCESS_TOKEN: old.token,
      SUPABASE_URL: old.supabase,
    })) value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  }
});
