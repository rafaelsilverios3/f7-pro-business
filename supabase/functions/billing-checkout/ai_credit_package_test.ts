import { handleBillingCheckoutRequest } from './index.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(body: Record<string, unknown>, jwt = 'fixture-jwt') {
  return new Request('http://127.0.0.1/functions/v1/billing-checkout', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fakeAdmin(role = 'admin') {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'buyer@example.invalid' } } }) },
    from(table: string) {
      const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'company_users' ? { role, active: true } : null, error: null }) };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === 'create_ai_credit_purchase_v1') return { data: { code: 'OK', id: '22222222-2222-4222-8222-222222222222', credits: 500, amount_minor: 1990, currency: 'BRL', status: 'created' }, error: null };
      if (name === 'persist_ai_credit_purchase_provider_v1') return { data: { code: 'OK', status: 'pending' }, error: null };
      return { data: null, error: null };
    },
    rpcCalls,
  };
  return client;
}

async function withTestEnvironment(run: () => Promise<void>) {
  const names = ['MERCADO_PAGO_ENVIRONMENT', 'MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'MERCADO_PAGO_AI_CREDITS_ENABLED', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET'];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  try {
    Deno.env.set('MERCADO_PAGO_ENVIRONMENT', 'test');
    Deno.env.set('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'false');
    Deno.env.set('MERCADO_PAGO_AI_CREDITS_ENABLED', 'true');
    Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'fixture-only-token');
    Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', 'fixture-only-webhook-secret');
    await run();
  } finally {
    for (const [name, value] of previous) value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  }
}

Deno.test('AI credit package checkout stays disabled by default independently of plan billing', async () => {
  await withTestEnvironment(async () => {
    Deno.env.delete('MERCADO_PAGO_AI_CREDITS_ENABLED');
    const sb = fakeAdmin();
    let providerCalls = 0;
    const response = await handleBillingCheckoutRequest(request({
      purchase_type: 'ai_credits', company_id: '33333333-3333-4333-8333-333333333333', package_code: 'credits_500',
      method: 'pix', request_id: '44444444-4444-4444-8444-444444444444',
    }), { adminClient: sb, providerFetch: async () => { providerCalls += 1; return Response.json({}); } });
    assert(response.status === 409 && (await response.json()).code === 'AI_CREDITS_COMMERCE_DISABLED', 'AI credit commerce was not independently gated');
    assert(providerCalls === 0 && sb.rpcCalls.length === 0, 'disabled AI credit checkout touched the provider or purchase ledger');
  });
});

Deno.test('AI credit package PIX uses database amount and remains pending until webhook; all provider I/O is stubbed', async () => {
  await withTestEnvironment(async () => {
    const sb = fakeAdmin();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); calls.push({ url, init });
      if (url === 'https://api.mercadolibre.com/users/me') return Response.json({ id: 1, site_id: 'MLB', tags: ['test_user'] });
      if (url === 'https://api.mercadopago.com/v1/orders') return Response.json({
        id: 'fixture-order', status: 'action_required', external_reference: '22222222-2222-4222-8222-222222222222',
        total_amount: '19.90',
        transactions: { payments: [{ id: 'fixture-payment', status: 'pending', amount: '19.90', payment_method: { qr_code: 'fixture-qr', qr_code_base64: 'fixture-base64', ticket_url: 'https://sandbox.example.invalid/ticket' } }] },
      }, { status: 201 });
      throw new Error('unexpected external request');
    };
    const response = await handleBillingCheckoutRequest(request({
      purchase_type: 'ai_credits', company_id: '33333333-3333-4333-8333-333333333333', package_code: 'credits_500',
      method: 'pix', billing_model: 'one_time', request_id: '44444444-4444-4444-8444-444444444444', amount_minor: 1,
    }), { adminClient: sb, providerFetch: fetcher });
    const body = await response.json();
    assert(response.status === 200 && body.code === 'OK', 'local PIX package handler did not return pending checkout');
    assert(body.purchase.amount_minor === 1990 && body.purchase.status === 'pending', 'client-supplied price influenced the purchase');
    assert(body.payment.qr_code === 'fixture-qr' && body.payment.qr_code_base64 === 'fixture-base64' && body.payment.ticket_url === 'https://sandbox.example.invalid/ticket', 'Orders payment_method PIX details were not returned to the client');
    assert(body.purchase.credits === 500 && body.payment.status === 'pending' && body.payment.qr_code === 'fixture-qr', 'pending payment response lost package state');
    assert(sb.rpcCalls.some((call) => call.name === 'create_ai_credit_purchase_v1' && call.args.package_code === 'credits_500'), 'server did not create the catalog package');
    assert(sb.rpcCalls.some((call) => call.name === 'persist_ai_credit_purchase_provider_v1'), 'provider idempotency state was not persisted');
    assert(sb.rpcCalls.every((call) => call.name !== 'settle_ai_credit_purchase_v1'), 'checkout directly granted credits before webhook');
    assert(calls.length === 2 && calls[0].url === 'https://api.mercadolibre.com/users/me' && calls[1].url === 'https://api.mercadopago.com/v1/orders', 'unexpected provider calls occurred');
    const orderBody = JSON.parse(String(calls[1].init?.body));
    assert(orderBody.total_amount === '19.90' && orderBody.external_reference === body.purchase.id, 'provider order was not bound to the server purchase');
    assert(new Headers(calls[1].init?.headers).get('X-Idempotency-Key') === `f7-ai-credit-${body.purchase.id}`, 'provider request omitted stable idempotency key');
  });
});

Deno.test('AI credit package checkout rejects company users without purchase role before provider call', async () => {
  await withTestEnvironment(async () => {
    const sb = fakeAdmin('comercial');
    let providerCalls = 0;
    const response = await handleBillingCheckoutRequest(request({
      purchase_type: 'ai_credits', company_id: '33333333-3333-4333-8333-333333333333', package_code: 'credits_500',
      method: 'pix', request_id: '44444444-4444-4444-8444-444444444444',
    }), { adminClient: sb, providerFetch: async () => { providerCalls += 1; return Response.json({}); } });
    assert(response.status === 403 && (await response.json()).code === 'FORBIDDEN', 'non-admin company user purchased credits');
    assert(providerCalls === 0 && sb.rpcCalls.length === 0, 'forbidden user reached provider or purchase RPC');
  });
});

Deno.test('AI credit package card checkout is one-time and never grants before the signed webhook', async () => {
  await withTestEnvironment(async () => {
    const sb = fakeAdmin();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); calls.push({ url, init });
      if (url === 'https://api.mercadolibre.com/users/me') return Response.json({ id: 1, site_id: 'MLB', tags: ['test_user'] });
      if (url === 'https://api.mercadopago.com/v1/payments') return Response.json({
        id: 'fixture-card-payment', status: 'approved', transaction_amount: 19.90, currency_id: 'BRL',
      }, { status: 201 });
      throw new Error('unexpected external request');
    };
    const response = await handleBillingCheckoutRequest(request({
      purchase_type: 'ai_credits', company_id: '33333333-3333-4333-8333-333333333333', package_code: 'credits_500',
      method: 'card', billing_model: 'one_time', request_id: '44444444-4444-4444-8444-444444444444',
      card_payment: { token: 'fixture-card-token', payment_method_id: 'visa', installments: 1, payer: { email: 'buyer@example.invalid', identification: { type: 'CPF', number: '12345678901' } } },
    }), { adminClient: sb, providerFetch: fetcher });
    const body = await response.json();
    assert(response.status === 200 && body.code === 'OK' && body.purchase.status === 'pending', 'card checkout did not remain pending for webhook settlement');
    assert(calls.length === 2 && calls[1].url === 'https://api.mercadopago.com/v1/payments', 'card checkout used an unexpected endpoint');
    const providerBody = JSON.parse(String(calls[1].init?.body));
    assert(providerBody.transaction_amount === 19.9 && providerBody.external_reference === body.purchase.id, 'card checkout ignored server catalog values');
    assert(!('auto_recurring' in providerBody) && providerBody.description.includes('F7 AI Credits'), 'card purchase was not one-time');
    assert(sb.rpcCalls.every((call) => call.name !== 'settle_ai_credit_purchase_v1'), 'card checkout granted credits directly');
  });
});
