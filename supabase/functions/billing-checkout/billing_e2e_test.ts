import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { handleBillingCheckoutRequest } from './index.ts';
import { handleBillingWebhookRequest } from '../billing-webhook/index.ts';

const baseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const dbContainer = Deno.env.get('E2E_DB_CONTAINER') || '';
const local = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || !anonKey || !serviceKey || !dbContainer) {
  throw new Error('Billing E2E requires an explicitly configured local-only Supabase stack.');
}

const admin = createClient(baseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const previousEnv = new Map(['MERCADO_PAGO_ENVIRONMENT', 'MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET'].map((key) => [key, Deno.env.get(key)]));
const createdUsers: string[] = [];
const createdCompanies: string[] = [];
const createdWebhookEvents: string[] = [];
let priorProPrice: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function localSql(sql: string): Promise<string> {
  const result = await new Deno.Command('docker', {
    args: ['exec', dbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', sql],
    stdout: 'piped', stderr: 'piped',
  }).output();
  if (result.code !== 0) throw new Error('Local billing database assertion failed.');
  return new TextDecoder().decode(result.stdout).trim();
}

async function makeUser(label: string) {
  const nonce = crypto.randomUUID();
  const email = `billing-${label}-${nonce}@example.invalid`;
  const password = `${crypto.randomUUID()}!Aa9`;
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error('Local billing Auth fixture creation failed.');
  createdUsers.push(result.data.user.id);
  const client = createClient(baseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error || !session.data.session) throw new Error('Local billing Auth session failed.');
  const company = await client.rpc('create_company_with_owner', { company_name: `Billing E2E ${label} ${nonce.slice(0, 8)}` });
  if (company.error || !company.data?.id) throw new Error('Local billing company fixture failed.');
  createdCompanies.push(company.data.id);
  return { id: result.data.user.id, companyId: company.data.id as string, jwt: session.data.session.access_token, client };
}

function makeSignature(secret: string, dataId: string, requestId: string, timestamp: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:${dataId};request-id:${requestId};ts:${timestamp};`)))
    .then((bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''));
}

function checkoutRequest(jwt: string, companyId: string, method = 'pix') {
  return new Request('http://127.0.0.1/functions/v1/billing-checkout', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, plan_code: 'pro', method }),
  });
}

function approvedOrder(checkoutId: string, orderId: string, paymentId: string, amount: number) {
  return {
    id: orderId, status: 'processed', status_detail: 'accredited', external_reference: checkoutId,
    currency_id: 'BRL', total_amount: amount,
    transactions: { payments: [{ id: paymentId, status: 'processed', status_detail: 'accredited', amount, currency_id: 'BRL' }] },
  };
}

Deno.test('Billing: sandbox local checkout, webhook HMAC, idempotência e ativação somente por pagamento validado', async () => {
  const webhookSecret = 'local-only-webhook-secret';
  Deno.env.set('MERCADO_PAGO_ENVIRONMENT', 'test');
  Deno.env.set('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'false');
  Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-local-only-test-token');
  Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', webhookSecret);
  let ownerA: Awaited<ReturnType<typeof makeUser>> | undefined;
  let ownerB: Awaited<ReturnType<typeof makeUser>> | undefined;
  let orderToReturn: Record<string, unknown> | null = null;
  const testMarker = crypto.randomUUID().replaceAll('-', '');
  const orderId = `order-local-${testMarker}`;
  const paymentId = `payment-local-${testMarker}`;
  const secondOrderId = `order-local-b-${testMarker}`;
  const secondPaymentId = `payment-local-b-${testMarker}`;
  let providerOrderCreates = 0;
  const providerOrdersByIdempotency = new Map<string, unknown>();
  let failNextLookup = true;
  let providerLookupGate: { started: () => void; result: Promise<Response> } | null = null;
  const providerCalls: Array<{ method: string; endpoint: string; idempotency: string | null }> = [];
  const providerFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    providerCalls.push({ method: init?.method || 'GET', endpoint: `${url.origin}${url.pathname}`, idempotency: new Headers(init?.headers).get('X-Idempotency-Key') });
    if (url.origin === 'https://api.mercadolibre.com' && url.pathname === '/users/me') {
      const token = new Headers(init?.headers).get('Authorization') || '';
      return Response.json({ id: 987654321, site_id: 'MLB', tags: token.includes('must-not-run-in-test') ? ['normal'] : ['test_user'] });
    }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('unexpected provider host');
    if (init?.method === 'POST' && url.pathname === '/v1/orders') {
      const idempotency = new Headers(init.headers).get('X-Idempotency-Key') || '';
      const prior = providerOrdersByIdempotency.get(idempotency);
      if (prior) return new Response(JSON.stringify(prior), { status: 201, headers: { 'Content-Type': 'application/json' } });
      providerOrderCreates += 1;
      const currentOrderId = providerOrderCreates === 1 ? orderId : secondOrderId;
      const currentPaymentId = providerOrderCreates === 1 ? paymentId : secondPaymentId;
      const providerOrder = {
        id: currentOrderId, status: 'action_required',
        transactions: { payments: [{ id: currentPaymentId, status: 'pending', amount: 125, currency_id: 'BRL', payment_method: { qr_code: 'local-pix', qr_code_base64: 'ZHVtbXk=', ticket_url: 'https://example.invalid/pix' } }] },
      };
      providerOrdersByIdempotency.set(idempotency, providerOrder);
      return new Response(JSON.stringify(providerOrder), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if ((init?.method || 'GET') !== 'GET' || !orderToReturn) throw new Error('unexpected local provider operation');
    if (providerLookupGate) {
      const gate = providerLookupGate;
      providerLookupGate = null;
      gate.started();
      return await gate.result;
    }
    if (failNextLookup) { failNextLookup = false; return new Response(JSON.stringify({ error: 'synthetic_transient_failure' }), { status: 503 }); }
    return new Response(JSON.stringify(orderToReturn), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    priorProPrice = await localSql("select coalesce(price_minor::text,'NULL') from public.plans where code='pro'");
    await localSql("update public.plans set price_minor=12500, currency='BRL', billing_period='month', active=true where code='pro'");
    ownerA = await makeUser('a');
    ownerB = await makeUser('b');

    const invalidMethodProviderCalls = providerCalls.length;
    const invalidMethodResponse = await handleBillingCheckoutRequest(checkoutRequest(ownerA.jwt, ownerA.companyId, 'unexpected-method'), { adminClient: admin, providerFetch });
    assert(invalidMethodResponse.status === 422 && (await invalidMethodResponse.json()).code === 'INVALID_PAYMENT_METHOD' && providerCalls.length === invalidMethodProviderCalls, 'unknown payment method was silently converted to PIX');

    const providerCallsBeforeWrongCredentialMode = providerCalls.length;
    const providerOrderCreatesBeforeWrongCredentialMode = providerOrderCreates;
    const beforeWrongModeCheckouts = await admin.from('billing_checkout_sessions').select('id', { count: 'exact', head: true }).eq('company_id', ownerA.companyId);
    Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-local-only-must-not-run-in-test');
    const wrongCredentialMode = await handleBillingCheckoutRequest(checkoutRequest(ownerA.jwt, ownerA.companyId), { adminClient: admin, providerFetch });
    assert(wrongCredentialMode.status === 409 && (await wrongCredentialMode.json()).code === 'MERCADO_PAGO_CREDENTIAL_ENVIRONMENT_UNVERIFIED', 'production identity was accepted in test environment');
    const afterWrongModeCheckouts = await admin.from('billing_checkout_sessions').select('id', { count: 'exact', head: true }).eq('company_id', ownerA.companyId);
    assert(providerCalls.length === providerCallsBeforeWrongCredentialMode + 1 && providerOrderCreates === providerOrderCreatesBeforeWrongCredentialMode && beforeWrongModeCheckouts.count === afterWrongModeCheckouts.count, 'credential mode mismatch passed identity verification or persisted a checkout');
    Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-local-only-test-token');

    const forbiddenSettlement = await ownerA.client.rpc('settle_billing_webhook_event', {
      p_event_id: crypto.randomUUID(), p_processing_token: 'not-a-settlement-token',
      p_provider_payment_id: 'not-a-payment', p_provider_order_id: null,
      p_external_reference: null, p_provider_status: null,
      p_normalized_status: 'approved', p_provider_amount_minor: 1,
      p_provider_currency: 'BRL', p_evidence: {}, p_paid_at: null,
    });
    assert(Boolean(forbiddenSettlement.error), 'authenticated company user could call the server-only billing settlement RPC');

    const unauthenticated = await handleBillingCheckoutRequest(new Request('http://127.0.0.1/functions/v1/billing-checkout', { method: 'POST', body: '{}' }), { adminClient: admin, providerFetch });
    assert(unauthenticated.status === 401, 'billing checkout accepted a missing JWT');

    const [checkoutResponse, concurrentCheckoutResponse] = await Promise.all([
      handleBillingCheckoutRequest(checkoutRequest(ownerA.jwt, ownerA.companyId), { adminClient: admin, providerFetch }),
      handleBillingCheckoutRequest(checkoutRequest(ownerA.jwt, ownerA.companyId), { adminClient: admin, providerFetch }),
    ]);
    const [checkoutBody, concurrentCheckoutBody] = await Promise.all([checkoutResponse.json(), concurrentCheckoutResponse.json()]);
    assert(checkoutResponse.status === 200 && checkoutBody.code === 'OK' && checkoutBody.pix?.qr_code === 'local-pix', `test checkout did not complete through the real local handler (http=${checkoutResponse.status}, code=${String(checkoutBody.code || 'none')})`);
    assert(concurrentCheckoutResponse.status === 200 && concurrentCheckoutBody.checkout?.id === checkoutBody.checkout?.id && providerOrderCreates === 1, 'concurrent checkout created more than one provider order or local intent');
    assert(checkoutBody.checkout?.amount_minor === 12500 && checkoutBody.checkout?.status === 'pending', 'checkout amount or state did not come from the plan catalog');
    const checkoutProviderCalls = providerCalls.filter((call) => call.method === 'POST');
    assert(checkoutProviderCalls.length >= 1 && checkoutProviderCalls.every((call) => call.idempotency === `f7-order-${checkoutBody.checkout.id}`), 'concurrent checkout did not reuse a stable provider idempotency key');

    const noTokenBefore = providerCalls.length;
    Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', '');
    const blockedNoToken = await handleBillingCheckoutRequest(checkoutRequest(ownerB.jwt, ownerB.companyId), { adminClient: admin, providerFetch });
    assert(blockedNoToken.status === 409 && (await blockedNoToken.json()).code === 'MERCADO_PAGO_NOT_CONFIGURED', 'missing payment credentials did not fail closed');
    assert(providerCalls.length === noTokenBefore, 'checkout contacted the provider without a configured credential');
    Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-local-only-test-token');

    const checkoutId = String(checkoutBody.checkout.id);
    const persistedPayment = await admin.from('billing_payments').select('id,status,metadata').eq('provider_payment_id', paymentId).maybeSingle();
    assert(!persistedPayment.error && Boolean(persistedPayment.data?.id), `checkout provider payment was not persisted (db_code=${persistedPayment.error?.code || 'none'})`);
    const eventId = `billing-local-e2e-event-${testMarker}`;
    createdWebhookEvents.push(eventId);
    const requestId = `billing-local-e2e-request-${testMarker}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = await makeSignature(webhookSecret, orderId, requestId, timestamp);
    const providerCallsBeforeModeMismatch = providerCalls.length;
    const liveModeMismatch = await handleBillingWebhookRequest(new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${orderId}`, {
      method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${digest}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: `billing-local-e2e-mode-${testMarker}`, type: 'order', live_mode: true, data: { id: orderId } }),
    }), { adminClient: admin, providerFetch });
    assert(liveModeMismatch.status === 409 && (await liveModeMismatch.json()).code === 'WEBHOOK_MODE_MISMATCH' && providerCalls.length === providerCallsBeforeModeMismatch, 'live webhook entered local test processing');
    const webhookRequest = () => new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${orderId}`, {
      method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${digest}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: eventId, type: 'order', live_mode: false, data: { id: orderId } }),
    });
    orderToReturn = approvedOrder(checkoutId, orderId, paymentId, 125);
    const capturedOperationalLogs: string[] = [];
    const previousConsoleError = console.error;
    console.error = (...values: unknown[]) => capturedOperationalLogs.push(values.map(String).join(' '));
    let transient: Response;
    try { transient = await handleBillingWebhookRequest(webhookRequest(), { adminClient: admin, providerFetch }); }
    finally { console.error = previousConsoleError; }
    assert(transient.status === 502 && (await transient.json()).code === 'ORDER_LOOKUP_FAILED', 'provider lookup failure did not return a retryable response');
    const capturedLogText = capturedOperationalLogs.join('\n');
    assert(!capturedLogText.includes(orderId) && !capturedLogText.includes(requestId) && !capturedLogText.includes('synthetic_transient_failure'), 'billing logs retained transaction identifiers or provider-controlled messages');
    const failedEvent = await admin.from('billing_webhook_events').select('status,processed,metadata').eq('provider_event_id', eventId).single();
    assert(!failedEvent.error && failedEvent.data.status === 'failed' && failedEvent.data.processed === false && !failedEvent.data.metadata.processing_token, 'transient provider failure did not release the local retry lease');
    const approved = await handleBillingWebhookRequest(webhookRequest(), { adminClient: admin, providerFetch });
    const approvedBody = await approved.json();
    assert(approved.status === 200 && approvedBody.code === 'OK' && approvedBody.status === 'approved', `sandbox payment webhook result differed (http=${approved.status}, code=${String(approvedBody.code || 'none')}, status=${String(approvedBody.status || 'none')})`);
    const billingState = await admin.from('company_subscriptions').select('plan,status').eq('company_id', ownerA.companyId).single();
    assert(!billingState.error && billingState.data.plan === 'pro' && billingState.data.status === 'active', 'valid payment did not activate the matching company plan');

    const providerCallsBeforeDuplicate = providerCalls.length;
    const duplicate = await handleBillingWebhookRequest(webhookRequest(), { adminClient: admin, providerFetch });
    assert(duplicate.status === 200 && (await duplicate.json()).duplicate === true && providerCalls.length === providerCallsBeforeDuplicate, 'duplicate webhook caused a second provider lookup or activation');

    const alternateEventId = `billing-local-e2e-alternate-event-${testMarker}`;
    createdWebhookEvents.push(alternateEventId);
    const auditBeforeAlternateDuplicate = await localSql(`select count(*) from public.audit_logs where company_id='${ownerA.companyId}' and action='billing.subscription_activated'`);
    const alternateRequestId = `billing-local-e2e-alternate-request-${testMarker}`;
    const alternateDigest = await makeSignature(webhookSecret, orderId, alternateRequestId, timestamp);
    const alternateEvent = await handleBillingWebhookRequest(new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${orderId}`, {
      method: 'POST', headers: { 'x-request-id': alternateRequestId, 'x-signature': `ts=${timestamp},v1=${alternateDigest}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: alternateEventId, type: 'order', live_mode: false, data: { id: orderId } }),
    }), { adminClient: admin, providerFetch });
    const alternateBody = await alternateEvent.json();
    const auditAfterAlternateDuplicate = await localSql(`select count(*) from public.audit_logs where company_id='${ownerA.companyId}' and action='billing.subscription_activated'`);
    assert(alternateEvent.status === 200 && alternateBody.duplicate === true && auditBeforeAlternateDuplicate === auditAfterAlternateDuplicate, 'a distinct notification for an already approved payment repeated the activation side effect');

    const incompleteEventId = `billing-local-e2e-incomplete-${testMarker}`;
    createdWebhookEvents.push(incompleteEventId);
    const incompleteRequestId = `billing-local-e2e-incomplete-request-${testMarker}`;
    const incompleteDigest = await makeSignature(webhookSecret, orderId, incompleteRequestId, timestamp);
    orderToReturn = approvedOrder(checkoutId, orderId, '', 125);
    const incompleteResponse = await handleBillingWebhookRequest(new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${orderId}`, {
      method: 'POST', headers: { 'x-request-id': incompleteRequestId, 'x-signature': `ts=${timestamp},v1=${incompleteDigest}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: incompleteEventId, type: 'order', live_mode: false, data: { id: orderId } }),
    }), { adminClient: admin, providerFetch });
    const incompleteEventState = await admin.from('billing_webhook_events').select('status,processed,metadata').eq('provider_event_id', incompleteEventId).single();
    assert(incompleteResponse.status === 502 && (await incompleteResponse.json()).code === 'PROVIDER_RESPONSE_INCOMPLETE', 'incomplete provider payment was sent to settlement');
    assert(!incompleteEventState.error && incompleteEventState.data.status === 'failed' && !incompleteEventState.data.processed && !incompleteEventState.data.metadata.processing_token, 'incomplete provider response left a stuck webhook lease');

    const invalidRequest = new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${orderId}`, {
      method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${'00'.repeat(32)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'billing-local-e2e-invalid-event', type: 'order', live_mode: false, data: { id: orderId } }),
    });
    const invalidSignature = await handleBillingWebhookRequest(invalidRequest, { adminClient: admin, providerFetch });
    assert(invalidSignature.status === 401 && (await invalidSignature.json()).code === 'INVALID_WEBHOOK_SIGNATURE', 'invalid webhook signature was accepted');

    const ownerBCheckout = await handleBillingCheckoutRequest(checkoutRequest(ownerB.jwt, ownerB.companyId), { adminClient: admin, providerFetch });
    const ownerBCheckoutBody = await ownerBCheckout.json();
    assert(ownerBCheckout.status === 200, 'second fictitious company could not create the local checkout fixture');
    const secondId = String(ownerBCheckoutBody.checkout.id);
    const badOrderId = secondOrderId;
    const badEventRequestId = `billing-local-e2e-request-b-${testMarker}`;
    const badEventId = `billing-local-e2e-event-b-${testMarker}`;
    createdWebhookEvents.push(badEventId);
    const badTimestamp = String(Math.floor(Date.now() / 1000));
    const badDigest = await makeSignature(webhookSecret, badOrderId, badEventRequestId, badTimestamp);
    failNextLookup = false;
    orderToReturn = approvedOrder(secondId, badOrderId, secondPaymentId, 1);
    const badWebhookRequest = () => new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${badOrderId}`, {
      method: 'POST', headers: { 'x-request-id': badEventRequestId, 'x-signature': `ts=${badTimestamp},v1=${badDigest}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: badEventId, type: 'order', live_mode: false, data: { id: badOrderId } }),
    });
    let markLookupStarted!: () => void;
    let releaseLookup!: (response: Response) => void;
    const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
    const lookupResponse = new Promise<Response>((resolve) => { releaseLookup = resolve; });
    providerLookupGate = { started: markLookupStarted, result: lookupResponse };
    const firstWebhookAttempt = handleBillingWebhookRequest(badWebhookRequest(), { adminClient: admin, providerFetch });
    await lookupStarted;
    const providerCallCountDuringLease = providerCalls.length;
    const overlappingWebhookAttempt = await handleBillingWebhookRequest(badWebhookRequest(), { adminClient: admin, providerFetch });
    assert(overlappingWebhookAttempt.status === 503 && (await overlappingWebhookAttempt.json()).code === 'WEBHOOK_PROCESSING' && providerCalls.length === providerCallCountDuringLease, 'concurrent webhook bypassed the processing lease or repeated the provider lookup');
    releaseLookup(new Response(JSON.stringify(orderToReturn), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const mismatchedAmount = await firstWebhookAttempt;
    assert(mismatchedAmount.status === 422 && (await mismatchedAmount.json()).code === 'PAYMENT_AMOUNT_MISMATCH', 'amount mismatch did not fail closed');
    const ownerBSubscription = await admin.from('company_subscriptions').select('plan,status').eq('company_id', ownerB.companyId).single();
    assert(!ownerBSubscription.error && ownerBSubscription.data.status === 'trial' && ownerBSubscription.data.plan === 'free', 'mismatched amount activated a subscription');

    const checkoutCounts = await admin.from('billing_checkout_sessions').select('id', { count: 'exact', head: true }).in('company_id', [ownerA.companyId, ownerB.companyId]);
    const paymentCount = await admin.from('billing_payments').select('id', { count: 'exact', head: true }).in('company_id', [ownerA.companyId, ownerB.companyId]);
    const eventCount = await admin.from('billing_webhook_events').select('id', { count: 'exact', head: true }).in('provider_event_id', [eventId, badEventId]);
    assert(checkoutCounts.count === 2 && paymentCount.count === 2 && eventCount.count === 2, 'isolated billing fixture persistence was incomplete');
  } finally {
    if (createdWebhookEvents.length) {
      const ids = createdWebhookEvents.map((id) => `'${id.replaceAll("'", "''")}'`).join(',');
      await localSql(`delete from public.billing_webhook_events where provider_event_id in (${ids})`).catch(() => '');
    }
    if (createdCompanies.length) await localSql(`delete from public.companies where id in (${createdCompanies.map((id) => `'${id}'`).join(',')})`).catch(() => '');
    for (const userId of createdUsers) await admin.auth.admin.deleteUser(userId);
    if (priorProPrice !== null) {
      const priceValue = priorProPrice === 'NULL' ? 'null' : priorProPrice;
      await localSql(`update public.plans set price_minor=${priceValue} where code='pro'`).catch(() => '');
    }
    for (const [key, value] of previousEnv) Deno.env.set(key, value || '');
  }
});
