import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { handleBillingCheckoutRequest } from './index.ts';
import { handleBillingWebhookRequest } from '../billing-webhook/index.ts';
import { handleBillingSubscriptionManageRequest } from '../billing-subscription-manage/index.ts';

const baseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const dbContainer = Deno.env.get('E2E_DB_CONTAINER') || '';
const local = baseUrl ? new URL(baseUrl) : null;
if (!local || !['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || !anonKey || !serviceKey || !dbContainer || !dbContainer.startsWith('supabase_db_')) {
  throw new Error('Recurring billing E2E requires an explicitly configured local-only Supabase stack.');
}

const admin = createClient(baseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const previousEnv = new Map(['MERCADO_PAGO_ENVIRONMENT', 'MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET', 'APP_URL', 'APP_ORIGIN'].map((key) => [key, Deno.env.get(key)]));
const createdUsers: string[] = [];
const createdCompanies: string[] = [];
const createdEvents: string[] = [];
let previousPrice: string | null = null;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function localSql(sql: string) {
  const result = await new Deno.Command('docker', { args: ['exec', dbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', sql], stdout: 'piped', stderr: 'piped' }).output();
  if (result.code !== 0) throw new Error('Local recurring billing database assertion failed.');
  return new TextDecoder().decode(result.stdout).trim();
}
async function makeOwner() {
  const nonce = crypto.randomUUID(); const email = `recurring-${nonce}@example.invalid`; const password = `${crypto.randomUUID()}!Aa9`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Local recurring billing Auth fixture creation failed.');
  createdUsers.push(created.data.user.id);
  const client = createClient(baseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error || !session.data.session) throw new Error('Local recurring billing Auth session failed.');
  const company = await client.rpc('create_company_with_owner', { company_name: `Recurring E2E ${nonce.slice(0, 8)}` });
  if (company.error || !company.data?.id) throw new Error('Local recurring billing company fixture failed.');
  createdCompanies.push(company.data.id);
  return { companyId: company.data.id as string, jwt: session.data.session.access_token };
}
async function sign(secret: string, dataId: string, requestId: string, timestamp: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:${dataId};request-id:${requestId};ts:${timestamp};`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function webhookRequest(secret: string, type: string, resourceId: string, eventId: string) {
  const requestId = crypto.randomUUID(); const timestamp = String(Math.floor(Date.now() / 1000));
  return sign(secret, resourceId, requestId, timestamp).then((digest) => new Request(`http://127.0.0.1/functions/v1/billing-webhook?data.id=${encodeURIComponent(resourceId)}`, {
    method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${digest}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: eventId, type, live_mode: false, data: { id: resourceId } }),
  }));
}

Deno.test('Billing recurring: tokenização, autorização, renovação, idempotência, inadimplência e cancelamento', async () => {
  const secret = 'local-recurring-webhook-secret';
  Deno.env.set('MERCADO_PAGO_ENVIRONMENT', 'test');
  Deno.env.set('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED', 'false');
  Deno.env.set('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-local-only-recurring-test-token');
  Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', secret);
  Deno.env.set('APP_ORIGIN', 'http://127.0.0.1:54321');
  Deno.env.set('APP_URL', 'http://127.0.0.1:54321/checkout');
  let owner: Awaited<ReturnType<typeof makeOwner>> | undefined;
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const providerSubscriptionId = `local-sub-${nonce}`;
  let invoiceId = `local-invoice-${nonce}`;
  let paymentId = `local-payment-${nonce}`;
  let subscriptionStatus = 'authorized';
  let invoicePaymentId = paymentId;
  let invoicePaymentStatus = 'approved';
  let providerPaymentStatus = 'approved';
  let providerPostCount = 0;
  const submittedTokens: string[] = [];
  const calls: string[] = [];
  const providerFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(`${init?.method || 'GET'} ${url.pathname}`);
    if (url.origin === 'https://api.mercadolibre.com' && url.pathname === '/users/me') {
      return Response.json({ id: 987654321, site_id: 'MLB', tags: ['test_user'] });
    }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('unexpected provider host');
    if (url.pathname === '/preapproval' && init?.method === 'POST') {
      providerPostCount += 1;
      const payload = JSON.parse(String(init.body || '{}'));
      submittedTokens.push(String(payload.card_token_id || ''));
      assert(payload.auto_recurring?.transaction_amount === 125 && payload.auto_recurring?.frequency === 1 && payload.auto_recurring?.frequency_type === 'months', 'recurring request did not use the immutable monthly plan amount');
      assert(payload.external_reference && payload.status === 'authorized', 'provider subscription request missing checkout reference or authorized status');
      return new Response(JSON.stringify({ id: providerSubscriptionId, status: 'authorized', init_point: 'https://www.mercadopago.com.br/subscriptions/checkout/local' }), { status: 201 });
    }
    if (url.pathname === `/preapproval/${providerSubscriptionId}`) return new Response(JSON.stringify({ id: providerSubscriptionId, status: subscriptionStatus, external_reference: currentCheckoutId }), { status: 200 });
    if (url.pathname === `/authorized_payments/${invoiceId}`) return new Response(JSON.stringify({
      id: invoiceId, preapproval_id: providerSubscriptionId, external_reference: currentCheckoutId,
      currency_id: 'BRL', transaction_amount: '125.00', last_modified: new Date().toISOString(),
      status: 'scheduled', summarized: invoicePaymentStatus, payment: { id: invoicePaymentId, status: invoicePaymentStatus },
    }), { status: 200 });
    if (url.pathname === `/v1/payments/${invoicePaymentId}`) return new Response(JSON.stringify({
      id: invoicePaymentId, status: providerPaymentStatus, transaction_amount: 125, currency_id: 'BRL', date_approved: new Date().toISOString(),
    }), { status: 200 });
    throw new Error('unexpected local provider operation');
  };
  let currentCheckoutId = '';
  const token = `fake-card-token-${nonce}`;
  try {
    previousPrice = await localSql("select coalesce(price_minor::text,'NULL') from public.plans where code='pro'");
    await localSql("update public.plans set price_minor=12500,currency='BRL',billing_period='month',active=true where code='pro'");
    owner = await makeOwner();
    const checkout = await handleBillingCheckoutRequest(new Request('http://127.0.0.1/functions/v1/billing-checkout', {
      method: 'POST', headers: { Authorization: `Bearer ${owner.jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: owner.companyId, plan_code: 'pro', method: 'card', billing_model: 'recurring', billing_period: 'month', card_payment: { token, payment_method_id: 'visa', installments: 1, payer: { email: 'test@example.invalid', identification: { type: 'CPF', number: '12345678909' } } } }),
    }), { adminClient: admin, providerFetch });
    const checkoutBody = await checkout.json();
    assert(checkout.status === 200 && checkoutBody.code === 'OK' && checkoutBody.subscription?.id, `card subscription checkout failed (http=${checkout.status}, code=${checkoutBody.code})`);
    assert(providerPostCount === 1 && submittedTokens[0] === token, 'provider did not receive the single-use token exactly once');
    assert(checkoutBody.subscription.init_point.startsWith('https://www.mercadopago.com.br/'), 'hosted subscription authorization URL missing');
    currentCheckoutId = String(checkoutBody.checkout.id);
    const persisted = await admin.from('billing_subscriptions').select('id,status,provider_subscription_id,metadata').eq('company_id', owner.companyId).single();
    assert(!persisted.error && persisted.data.provider_subscription_id === providerSubscriptionId && persisted.data.status === 'authorized', 'provider subscription reference was not persisted');
    assert(!JSON.stringify(persisted.data).includes(token), 'one-use card token was persisted');
    const initialCompany = await admin.from('company_subscriptions').select('status,plan').eq('company_id', owner.companyId).single();
    assert(!initialCompany.error && initialCompany.data.status === 'trial' && initialCompany.data.plan === 'free', 'subscription authorization activated access before a confirmed payment');

    const preapprovalEventId = `recurring-preapproval-${nonce}`; createdEvents.push(preapprovalEventId);
    const preapproval = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_preapproval', providerSubscriptionId, preapprovalEventId), { adminClient: admin, providerFetch });
    assert(preapproval.status === 200 && (await preapproval.json()).status === 'authorized', 'subscription authorization webhook was not settled');
    const stillTrial = await admin.from('company_subscriptions').select('status').eq('company_id', owner.companyId).single();
    assert(stillTrial.data?.status === 'trial', 'preapproval alone granted paid access');

    const invoiceEventId = `recurring-invoice-${nonce}`; createdEvents.push(invoiceEventId);
    const paidInvoice = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_authorized_payment', invoiceId, invoiceEventId), { adminClient: admin, providerFetch });
    const paidBody = await paidInvoice.json();
    assert(paidInvoice.status === 200 && paidBody.status === 'approved', 'confirmed recurring invoice was not settled');
    const activeCompany = await admin.from('company_subscriptions').select('status,plan,current_period_end').eq('company_id', owner.companyId).single();
    assert(!activeCompany.error && activeCompany.data.status === 'active' && activeCompany.data.plan === 'pro' && Boolean(activeCompany.data.current_period_end), 'confirmed invoice did not activate one company subscription period');
    const beforeDuplicate = activeCompany.data.current_period_end;
    const auditCountBefore = await localSql(`select count(*) from public.audit_logs where company_id='${owner.companyId}' and action='billing.recurring_payment_settled'`);
    const duplicateEventId = `recurring-invoice-duplicate-${nonce}`; createdEvents.push(duplicateEventId);
    const duplicateInvoice = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_authorized_payment', invoiceId, duplicateEventId), { adminClient: admin, providerFetch });
    assert(duplicateInvoice.status === 200 && (await duplicateInvoice.json()).duplicate === true, 'same payment under a second event id was not idempotent');
    const afterDuplicate = await admin.from('company_subscriptions').select('current_period_end').eq('company_id', owner.companyId).single();
    const auditCountAfter = await localSql(`select count(*) from public.audit_logs where company_id='${owner.companyId}' and action='billing.recurring_payment_settled'`);
    assert(afterDuplicate.data?.current_period_end === beforeDuplicate && auditCountAfter === auditCountBefore, 'duplicate invoice extended the period or duplicated the audit event');

    const failedInvoiceId = `local-invoice-failed-${nonce}`; const failedPaymentId = `local-payment-failed-${nonce}`;
    const originalFetch = providerFetch;
    const delinquencyFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === `/authorized_payments/${failedInvoiceId}`) return new Response(JSON.stringify({ id: failedInvoiceId, preapproval_id: providerSubscriptionId, external_reference: currentCheckoutId, currency_id: 'BRL', transaction_amount: '125.00', payment: { id: failedPaymentId, status: 'rejected' } }), { status: 200 });
      if (url.pathname === `/v1/payments/${failedPaymentId}`) return new Response(JSON.stringify({ id: failedPaymentId, status: 'rejected', transaction_amount: 125, currency_id: 'BRL' }), { status: 200 });
      return originalFetch(input, init);
    };
    const failedEventId = `recurring-failed-invoice-${nonce}`; createdEvents.push(failedEventId);
    const failedInvoice = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_authorized_payment', failedInvoiceId, failedEventId), { adminClient: admin, providerFetch: delinquencyFetch });
    assert(failedInvoice.status === 200 && (await failedInvoice.json()).status === 'rejected', 'rejected recurring invoice was not represented');
    const pastDue = await admin.from('company_subscriptions').select('status').eq('company_id', owner.companyId).single();
    assert(pastDue.data?.status === 'past_due', 'rejected recurring invoice did not restrict the subscription as past_due');

    invoiceId = `local-invoice-reactivated-${nonce}`;
    paymentId = `local-payment-reactivated-${nonce}`;
    invoicePaymentId = paymentId;
    invoicePaymentStatus = 'approved';
    providerPaymentStatus = 'approved';
    const recoveryEventId = `recurring-recovery-${nonce}`; createdEvents.push(recoveryEventId);
    const recoveredInvoice = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_authorized_payment', invoiceId, recoveryEventId), { adminClient: admin, providerFetch });
    assert(recoveredInvoice.status === 200 && (await recoveredInvoice.json()).status === 'approved', 'successful retry did not settle after delinquency');
    const reactivated = await admin.from('company_subscriptions').select('status,plan').eq('company_id', owner.companyId).single();
    assert(reactivated.data?.status === 'active' && reactivated.data.plan === 'pro', 'confirmed renewal did not reactivate a past-due tenant');

    const localSubscription = await admin.from('billing_subscriptions').select('id,status').eq('company_id', owner.companyId).single();
    assert(!localSubscription.error && localSubscription.data.status === 'authorized', 'recurring subscription was not in a manageable state');
    const manage = async (action: 'pause' | 'resume' | 'cancel', providerStatus: string) => handleBillingSubscriptionManageRequest(new Request('http://127.0.0.1/functions/v1/billing-subscription-manage', {
      method: 'POST', headers: { Authorization: `Bearer ${owner!.jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: owner!.companyId, subscription_id: localSubscription.data.id, action }),
    }), { adminClient: admin, providerFetch: async (input, init) => {
      const url = new URL(String(input));
      assert(url.pathname === `/preapproval/${providerSubscriptionId}` && init?.method === 'PUT', 'subscription control used an unexpected provider endpoint');
      assert(JSON.parse(String(init?.body || '{}')).status === providerStatus, 'subscription control sent an unexpected provider status');
      return new Response(JSON.stringify({ id: providerSubscriptionId, status: providerStatus }), { status: 200 });
    } });
    const paused = await manage('pause', 'paused');
    assert(paused.status === 200 && (await paused.json()).status === 'paused', 'subscription pause was not persisted');
    const resumed = await manage('resume', 'authorized');
    assert(resumed.status === 200 && (await resumed.json()).status === 'authorized', 'subscription resumption was not persisted');
    const managedCancellation = await manage('cancel', 'canceled');
    assert(managedCancellation.status === 200 && (await managedCancellation.json()).status === 'cancelled', 'subscription cancellation action was not persisted');

    subscriptionStatus = 'cancelled';
    const cancelEventId = `recurring-cancel-${nonce}`; createdEvents.push(cancelEventId);
    const canceled = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_preapproval', providerSubscriptionId, cancelEventId), { adminClient: admin, providerFetch });
    assert(canceled.status === 200 && (await canceled.json()).status === 'cancelled', 'provider cancellation event was not recorded');
    const canceledSubscription = await admin.from('company_subscriptions').select('status').eq('company_id', owner.companyId).single();
    assert(canceledSubscription.data?.status === 'active', 'cancellation webhook did not preserve the prepaid period');
    const duplicateCancellation = await handleBillingSubscriptionManageRequest(new Request('http://127.0.0.1/functions/v1/billing-subscription-manage', {
      method: 'POST', headers: { Authorization: `Bearer ${owner.jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: owner.companyId, subscription_id: localSubscription.data.id, action: 'cancel' }),
    }), { adminClient: admin, providerFetch: async () => { throw new Error('idempotent cancellation must not call provider'); } });
    assert(duplicateCancellation.status === 200 && (await duplicateCancellation.json()).duplicate === true, 'duplicate cancellation was not idempotent');

    const lateInvoiceId = `local-invoice-late-${nonce}`; const latePaymentId = `local-payment-late-${nonce}`;
    const lateFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === `/authorized_payments/${lateInvoiceId}`) return new Response(JSON.stringify({ id: lateInvoiceId, preapproval_id: providerSubscriptionId, external_reference: currentCheckoutId, currency_id: 'BRL', transaction_amount: '125.00', payment: { id: latePaymentId, status: 'approved' } }), { status: 200 });
      if (url.pathname === `/v1/payments/${latePaymentId}`) return new Response(JSON.stringify({ id: latePaymentId, status: 'approved', transaction_amount: 125, currency_id: 'BRL' }), { status: 200 });
      return originalFetch(input, init);
    };
    const lateEventId = `recurring-late-payment-${nonce}`; createdEvents.push(lateEventId);
    const latePaid = await handleBillingWebhookRequest(await webhookRequest(secret, 'subscription_authorized_payment', lateInvoiceId, lateEventId), { adminClient: admin, providerFetch: lateFetch });
    const lateBody = await latePaid.json();
    assert(latePaid.status === 200 && lateBody.status === 'approved' && lateBody.access_granted === false, `late payment after cancellation did not return the safe result (http=${latePaid.status}, code=${String(lateBody.code)}, status=${String(lateBody.status)}, access=${String(lateBody.access_granted)})`);
    const stillCancelled = await admin.from('company_subscriptions').select('status,current_period_end').eq('company_id', owner.companyId).single();
    assert(stillCancelled.data?.status === 'active' && new Date(stillCancelled.data.current_period_end).getTime() > Date.now(), 'late invoice changed prepaid access or reactivated billing');
    const storedLatePayment = await admin.from('billing_payments').select('status').eq('provider_payment_id', latePaymentId).single();
    assert(storedLatePayment.data?.status === 'approved', 'paid-but-not-reinstated invoice was not retained for reconciliation');

    const tokenText = (await localSql(`select coalesce(string_agg(coalesce(metadata::text,''),' '),'') from public.billing_subscriptions where company_id='${owner.companyId}'`));
    assert(!tokenText.includes(token), 'card token appeared in persisted subscription metadata');
    assert(calls.every((call) => !call.includes('/v1/orders')), 'recurring card flow unexpectedly entered one-time orders API');
  } finally {
    if (createdEvents.length) await localSql(`delete from public.billing_webhook_events where provider_event_id in (${createdEvents.map((event) => `'${event.replaceAll("'", "''")}'`).join(',')})`).catch(() => '');
    if (createdCompanies.length) await localSql(`delete from public.companies where id in (${createdCompanies.map((id) => `'${id}'`).join(',')})`).catch(() => '');
    for (const userId of createdUsers) await admin.auth.admin.deleteUser(userId);
    if (previousPrice !== null) await localSql(`update public.plans set price_minor=${previousPrice === 'NULL' ? 'null' : previousPrice} where code='pro'`).catch(() => '');
    for (const [key, value] of previousEnv) Deno.env.set(key, value || '');
  }
});
