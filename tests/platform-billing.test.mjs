import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const migration = fs.readFileSync('supabase/migrations/0064_platform_billing_foundation.sql', 'utf8');
const checkout = fs.readFileSync('supabase/functions/billing-checkout/index.ts', 'utf8');
const webhook = fs.readFileSync('supabase/functions/billing-webhook/index.ts', 'utf8');
const plans = fs.readFileSync('supabase/functions/billing-plans/index.ts', 'utf8');
const service = fs.readFileSync('src/services/billingService.js', 'utf8');
const page = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const site = fs.readFileSync('src/pages/PublicSite.jsx', 'utf8');
const scrollToTop = fs.readFileSync('src/components/ScrollToTop.jsx', 'utf8');
const subscriptionPage = fs.readFileSync('src/pages/SubscriptionBilling.jsx', 'utf8');
const planService = fs.readFileSync('src/services/planService.js', 'utf8');
const featureGate = fs.readFileSync('src/services/featureGate.js', 'utf8');
const commercialMigration = fs.readFileSync('supabase/migrations/0065_platform_plan_catalog.sql', 'utf8');
const trialMigration = fs.readFileSync('supabase/migrations/0066_trial_lifecycle.sql', 'utf8');
const trialGateMigration = fs.readFileSync('supabase/migrations/0067_trial_gate_fail_closed.sql', 'utf8');
const ordersMigration = fs.readFileSync('supabase/migrations/0068_billing_orders_support.sql', 'utf8');
const intelligenceEdge = fs.readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8');
const supplierEdge = fs.readFileSync('supabase/functions/supplier-intelligence/index.ts', 'utf8');
const automationEdge = fs.readFileSync('supabase/functions/automation-worker/index.ts', 'utf8');
const billingHealth = fs.readFileSync('supabase/functions/billing-health/index.ts', 'utf8');
const radarService = fs.readFileSync('src/services/opportunityRadarService.js', 'utf8');
const subscriptionService = fs.readFileSync('src/services/subscriptionService.js', 'utf8');
const supabaseConfig = fs.readFileSync('supabase/config.toml', 'utf8');

test('billing foundation separates plans, subscriptions, payments, checkouts and webhook events', () => {
  for (const table of ['plans', 'plan_features', 'billing_customers', 'billing_payments', 'billing_checkout_sessions', 'billing_webhook_events']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /company_subscriptions/);
  assert.match(migration, /unique\(provider, provider_payment_id\)/);
});

test('plans are backend-controlled and never require fictitious prices', () => {
  assert.match(migration, /price_minor bigint/);
  assert.match(site, /Preço a definir/);
  assert.match(checkout, /PLAN_PRICE_NOT_CONFIGURED/);
  assert.match(plans, /eq\('active', true\)/);
  const plansSection = site.match(/function PlansSection\([\s\S]*?\nfunction Flow/)?.[0] || '';
  assert.doesNotMatch(plansSection, /R\$\s*\d/);
});

test('checkout resolves amount from the active plan and keeps provider secrets server-side', () => {
  assert.match(checkout, /eq\('code', planCode\)\.eq\('active', true\)/);
  assert.match(checkout, /MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(checkout, /X-Idempotency-Key/);
  assert.match(checkout, /v1\/orders/);
  assert.match(checkout, /processing_mode: 'automatic'/);
  assert.match(checkout, /payment_method: \{ id: 'pix', type: 'bank_transfer' \}/);
  assert.doesNotMatch(service + page, /MERCADO_PAGO_ACCESS_TOKEN|WEBHOOK_SECRET/);
});

test('PIX exposes provider evidence and payment activation only comes from webhook', () => {
  assert.match(checkout, /qr_code/);
  assert.match(checkout, /qr_code_base64/);
  assert.match(page, /webhook do Mercado Pago/);
  assert.match(webhook, /validateSignature/);
  assert.match(webhook, /MERCADO_PAGO_WEBHOOK_SECRET/);
  assert.match(webhook, /billing_webhook_events/);
  assert.match(webhook, /duplicate/);
  assert.match(webhook, /status === 'approved'/);
  assert.match(webhook, /type === 'order'/);
  assert.match(webhook, /v1\/orders/);
  assert.match(webhook, /provider_order_id/);
  assert.match(webhook, /billing_period/);
  assert.doesNotMatch(webhook, /30 \* 86_400_000/);
});

test('Mercado Pago reaches billing-webhook without Supabase JWT while HMAC remains mandatory', () => {
  assert.match(supabaseConfig, /\[functions\.billing-webhook\][\s\S]*verify_jwt\s*=\s*false/);
  assert.doesNotMatch(supabaseConfig, /\[functions\.(billing-checkout|billing-health)\][\s\S]*verify_jwt\s*=\s*false/);
  assert.match(webhook, /req\.headers\.get\('x-signature'\)/);
  assert.match(webhook, /req\.headers\.get\('x-request-id'\)/);
  assert.match(webhook, /MERCADO_PAGO_WEBHOOK_SECRET/);
  assert.match(webhook, /INVALID_WEBHOOK_SIGNATURE.*401/);
  assert.match(webhook, /crypto\.subtle\.sign\('HMAC'/);
  assert.match(webhook, /searchParams\.get\('data\.id'\)/);
  assert.match(webhook, /data_id_origin/);
  assert.match(webhook, /requestId \? `request-id:\$\{requestId\};` : ''/);
  assert.match(webhook, /constantTimeEqual/);
  assert.match(webhook, /received_digest_length/);
  assert.match(webhook, /v1\/orders/);
});

test('billing webhook validates Mercado Pago timestamps in Unix seconds and fails closed', () => {
  assert.match(webhook, /WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 10 \* 60/);
  assert.match(webhook, /Math\.floor\(Date\.now\(\) \/ 1000\)/);
  assert.match(webhook, /const tsSeconds = Number\(value\)/);
  assert.doesNotMatch(webhook, /Math\.abs\(Date\.now\(\) - Number\(ts\)\)/);

  const helperStart = webhook.indexOf('const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS =');
  const helperEnd = webhook.indexOf('const resolveDataId', helperStart);
  const helperSource = helperStart >= 0 && helperEnd > helperStart
    ? webhook.slice(helperStart, helperEnd).trim().replace(/\(value: string, nowSeconds =/, '(value, nowSeconds =')
    : null;
  assert.ok(helperSource, 'timestamp helper must remain isolated and testable');
  const context = {};
  vm.runInNewContext(`${helperSource}; this.validate = isWebhookTimestampValid;`, context);
  const now = 1_789_309_220;
  assert.equal(context.validate(String(now), now), true, 'current seconds timestamp is valid');
  assert.equal(context.validate(String(now - 601), now), false, 'old timestamp is rejected');
  assert.equal(context.validate(String(now + 601), now), false, 'future timestamp is rejected');
  assert.equal(context.validate('not-a-number', now), false, 'non-numeric timestamp is rejected');
  assert.equal(context.validate(String(now), now + 0.5), true, 'seconds remain seconds throughout comparison');
});

test('Orders API normalizer requires accredited evidence and keeps legacy payment semantics separate', () => {
  assert.match(webhook, /normalizeLegacyPaymentStatus/);
  assert.match(webhook, /normalizeOrdersPaymentStatus/);
  assert.match(webhook, /provider_order_status_detail/);
  assert.match(webhook, /provider_transaction_status_detail/);
  assert.match(webhook, /trial_used: true/);
  assert.match(webhook, /legacyEventNeedsReconciliation/);

  const helperSource = webhook.match(/const normalizeOrdersPaymentStatus[\s\S]*?\nconst periodEnd/)?.[0].replace(/\nconst periodEnd[\s\S]*$/, '');
  assert.ok(helperSource, 'Orders normalizer must remain isolated and testable');
  const context = {};
  vm.runInNewContext(`${helperSource}; this.normalize = normalizeOrdersPaymentStatus;`, context);
  const normalize = context.normalize;
  const expectNormalized = (input, expected) => assert.deepEqual(JSON.parse(JSON.stringify(normalize(input))), expected);
  expectNormalized({ orderStatus: 'processed', orderStatusDetail: 'accredited', transactionStatus: 'processed', transactionStatusDetail: 'accredited' }, { status: 'approved', activationEligible: true, reason: null });
  expectNormalized({ orderStatus: 'action_required', orderStatusDetail: 'waiting_payment' }, { status: 'pending', activationEligible: false, reason: 'waiting_payment' });
  expectNormalized({ orderStatus: 'processing', orderStatusDetail: 'in_process' }, { status: 'pending', activationEligible: false, reason: 'in_process' });
  expectNormalized({ orderStatus: 'created', orderStatusDetail: 'created' }, { status: 'pending', activationEligible: false, reason: 'created' });
  expectNormalized({ orderStatus: 'processed', orderStatusDetail: 'partially_refunded', transactionStatus: 'processed', transactionStatusDetail: 'partially_refunded' }, { status: 'refunded', activationEligible: false, reason: 'partial_refund' });
  expectNormalized({ orderStatus: 'processed', orderStatusDetail: 'accredited', transactionStatus: 'processing', transactionStatusDetail: 'in_process' }, { status: 'pending', activationEligible: false, reason: 'transaction_status_mismatch' });
  expectNormalized({ orderStatus: 'processed', orderStatusDetail: 'unknown' }, { status: 'pending', activationEligible: false, reason: 'order_status_detail_unverified' });
  expectNormalized({ orderStatus: 'failed', orderStatusDetail: 'failed' }, { status: 'rejected', activationEligible: false, reason: 'failed' });
  expectNormalized({ orderStatus: 'expired', orderStatusDetail: 'expired' }, { status: 'rejected', activationEligible: false, reason: 'expired' });
  expectNormalized({ orderStatus: 'canceled', orderStatusDetail: 'canceled' }, { status: 'cancelled', activationEligible: false, reason: 'cancelled' });
  expectNormalized({ orderStatus: 'refunded', orderStatusDetail: 'refunded' }, { status: 'refunded', activationEligible: false, reason: 'refunded' });
});

test('Orders activation is tenant, checkout, money and idempotency safe', () => {
  for (const marker of ['providerAmountMinor', 'providerCurrency', 'companyMismatch', 'referenceMismatch', 'orderMismatch', 'PLAN_REFERENCE_MISMATCH', 'PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_CURRENCY_MISMATCH', 'duplicate: true']) assert.match(webhook, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(webhook, /checkout\.provider_order_id !== resourceId/);
  assert.match(webhook, /checkout\.company_id !== local\.company_id/);
  assert.match(webhook, /externalReference !== String\(checkout\.id\)/);
  assert.match(webhook, /normalized\.activationEligible/);
});

test('Orders PIX test contract uses the official deterministic payer without exposing secrets', () => {
  assert.match(checkout, /test_user_br@testuser\.com/);
  assert.match(checkout, /first_name: 'APRO'/);
  assert.match(checkout, /BILLING_PROVIDER_REQUEST_FAILED/);
  assert.match(checkout, /provider_code/);
  assert.match(checkout, /provider_causes/);
  assert.doesNotMatch(checkout, /console\.error\([^\n]*(?:token|Authorization|qr_code)/i);
  assert.match(ordersMigration, /provider_order_id/);
  assert.match(ordersMigration, /error_message/);
});

test('billing authorization and tenant ownership are checked server-side', () => {
  assert.match(checkout, /company_users/);
  assert.match(checkout, /\['admin', 'gestor'\]/);
  assert.match(checkout, /AUTH_REQUIRED.*401/);
  assert.match(checkout, /company_id/);
  assert.match(webhook, /billing_payments/);
  assert.match(webhook, /eq\('company_id', local\.company_id\)/);
});

test('public plans and authenticated checkout routes are wired without changing Smart Atendimento', () => {
  assert.match(app, /'\/planos': 'plans'/);
  assert.match(app, /path="\/checkout"/);
  assert.match(app, /returnTo=.*location\.pathname/);
  assert.match(site, /PlansSection/);
  assert.match(site, /Assinar/);
});

test('landing hero separates trial and plan discovery CTAs', () => {
  const hero = site.match(/function Hero\(\) \{[\s\S]*?\nfunction Segments/)?.[0];
  const cta = site.match(/function Cta\(\) \{[\s\S]*?\nfunction Home/)?.[0];
  assert.ok(hero, 'landing hero must remain identifiable');
  assert.ok(cta, 'landing final CTA must remain identifiable');
  assert.match(hero, /Começar grátis por 24h/);
  assert.match(hero, /trialPath/);
  assert.match(hero, /to="\/#planos"/);
  assert.match(hero, /Ver planos/);
  assert.doesNotMatch(hero, /Acessar plataforma|Conhecer o F7 PRO BUSINESS/);
  assert.match(cta, /Começar grátis por 24h/);
  assert.match(cta, /to="\/#planos"/);
  assert.doesNotMatch(cta, /Acessar plataforma/);
  assert.match(site, /<a href=\{appUrl\}[^>]*>Entrar<\/a>/);
  assert.match(site, /<Link to="\/pro-business"[^>]*>Conhecer a F7<\/Link>/);
  const header = site.match(/function Header\(\) \{[\s\S]*?\nfunction DashboardMockup/)?.[0];
  assert.ok(header, 'landing header must remain identifiable');
  assert.match(header, /bg-\[#0b1b35\][^>]*>Entrar<\/a>/);
  assert.doesNotMatch(header, /Começar grátis/);
  assert.match(site, /id="planos"/);
  assert.match(scrollToTop, /scrollIntoView\(\{ behavior: "smooth" \}\)/);
});

test('landing hero uses the office notebook background and overlays the F7 CTAs', () => {
  const hero = site.match(/function Hero\(\) \{[\s\S]*?\nfunction Segments/)?.[0];
  assert.ok(hero, 'landing hero must remain identifiable');
  assert.match(hero, /hero-office-notebook\.png/);
  assert.match(hero, /linear-gradient\(90deg/);
  assert.doesNotMatch(hero, /DashboardMockup/);
  assert.match(hero, /Começar grátis por 24h/);
  assert.match(hero, /Ver planos/);
});

test('commercial funnel preserves plan intent through account and first-company onboarding', () => {
  assert.match(site, /register\?returnTo=/);
  assert.match(site, /checkout\?plan/);
  assert.match(page, /Criar empresa e continuar/);
  assert.match(page, /onboarding\?returnTo=/);
  assert.match(app, /'\/cadastro'/);
  assert.match(fs.readFileSync('src/pages/Onboarding.jsx', 'utf8'), /safeReturnTo/);
});

test('public site exposes responsible intelligence, trial duration, FAQ and SEO metadata', () => {
  assert.match(site, /Teste gratuito de 24 horas/);
  assert.match(site, /Intelligence/);
  assert.match(site, /Decisões comerciais importantes continuam/);
  assert.match(site, /Perguntas frequentes/);
  assert.match(site, /og:title/);
  assert.match(site, /canonical/);
  assert.match(site, /SoftwareApplication/);
});

test('subscription screen is tenant-scoped and exposes only platform billing history', () => {
  assert.match(app, /path="\/assinatura"/);
  assert.match(subscriptionPage, /company_subscriptions/);
  assert.match(subscriptionPage, /billing_payments/);
  assert.match(subscriptionPage, /eq\('company_id', company\.id\)/);
  assert.doesNotMatch(subscriptionPage, /financial_entries|salesRepository|financeRepository/);
  assert.match(subscriptionPage, /Dados financeiros operacionais da empresa não são usados/);
});

test('commercial gates match the configured plan positioning', () => {
  for (const feature of ['ai_sales', 'opportunity_radar', 'supplier_intelligence', 'external_product_intelligence']) assert.match(planService, new RegExp(`${feature}:`));
  assert.match(planService, /automations: 'business'/);
  assert.match(planService, /ai_sales: 'pro'/);
  assert.match(planService, /supplier_intelligence: 'premium'/);
  assert.match(featureGate, /disponível no plano/);
});

test('official commercial catalog keeps prices and Business highlight server-side', () => {
  for (const [code, minor] of [['free', '0'], ['pro', '6990'], ['business', '14990'], ['premium', '29990']]) {
    assert.match(commercialMigration, new RegExp(`when '${code}' then ${minor}`));
  }
  assert.match(commercialMigration, /highlighted = code = 'business'/);
  assert.match(site, /Mais escolhido/);
  assert.match(page, /Preço a definir|money\(plan\.price_minor/);
  assert.match(subscriptionPage, /Preço:/);
});

test('premium modules fail closed server-side during trial or on an insufficient plan', () => {
  assert.match(intelligenceEdge, /company_has_feature.*intelligence/);
  assert.match(intelligenceEdge, /external_product_intelligence/);
  assert.match(supplierEdge, /company_has_feature.*supplier_intelligence/);
  assert.match(automationEdge, /company_has_feature.*automations/);
  for (const source of [intelligenceEdge, supplierEdge, automationEdge]) assert.match(source, /FEATURE_NOT_AVAILABLE/);
});

test('trial starts once for 24 hours, expires server-side and preserves data', () => {
  assert.match(trialMigration, /trial_started_at/);
  assert.match(trialMigration, /trial_used boolean/);
  assert.match(trialMigration, /interval '24 hours'/);
  assert.match(trialMigration, /sync_company_trial/);
  assert.match(trialMigration, /status = 'expired'/);
  assert.match(trialMigration, /company_has_feature/);
  assert.match(trialMigration, /status in \('trial','active','past_due','cancelled','suspended','expired'\)/);
});

test('active trial cannot be entitled by overrides or plan features', () => {
  assert.match(trialGateMigration, /if subscription_status = 'trial' then return false; end if/);
  assert.match(trialGateMigration, /company_feature_overrides/);
  assert.match(trialGateMigration, /company_has_feature/);
});

test('checkout reuses open intent and webhook validates money before activation', () => {
  assert.match(checkout, /billing_checkout_sessions.*select/);
  assert.match(checkout, /in\('status', \['created', 'pending'\]\)/);
  assert.match(checkout, /reused: true/);
  assert.match(webhook, /PAYMENT_AMOUNT_MISMATCH/);
  assert.match(webhook, /transaction_amount/);
  assert.match(webhook, /currency_id/);
  assert.match(webhook, /PAYMENT_REFERENCE_MISMATCH/);
});

test('billing health never returns provider secrets and radar is gated server-side', () => {
  assert.match(billingHealth, /access_token_configured/);
  assert.match(billingHealth, /users\/me/);
  assert.match(billingHealth, /environment_confirmed/);
  assert.match(billingHealth, /credential_environment/);
  assert.match(billingHealth, /MERCADO_PAGO_ENVIRONMENT/);
  assert.match(billingHealth, /configured_environment/);
  assert.match(billingHealth, /pix_allowed/);
  assert.match(checkout, /MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED/);
  assert.match(checkout, /PRODUCTION_PAYMENTS_DISABLED/);
  assert.match(checkout, /MERCADO_PAGO_ENVIRONMENT_NOT_CONFIGURED/);
  assert.doesNotMatch(billingHealth, /isTestUser\s*\)/);
  assert.doesNotMatch(billingHealth, /MERCADO_PAGO_ACCESS_TOKEN[^\n]*(?:return|json)/);
  assert.match(radarService, /company_has_feature/);
  assert.match(radarService, /FEATURE_NOT_AVAILABLE/);
  assert.match(subscriptionService, /trial_ends_at/);
});

test('production billing is server-controlled and fail-closed without creating an order', () => {
  assert.match(checkout, /const productionPaymentsEnabled = .*MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED/);
  assert.match(checkout, /environment === 'production' && !productionPaymentsEnabled/);
  assert.match(checkout, /code: 'PRODUCTION_PAYMENTS_DISABLED'/);
  const guardIndex = checkout.indexOf("code: 'PRODUCTION_PAYMENTS_DISABLED'");
  const fetchIndex = checkout.indexOf("fetch(providerUrl");
  assert.ok(guardIndex >= 0 && guardIndex < fetchIndex, 'production gate must run before POST /v1/orders');
  assert.match(checkout, /const isTest = environment === 'test'/);
  assert.doesNotMatch(checkout, /import\.meta\.env|localStorage.*MERCADO_PAGO|window\..*MERCADO_PAGO/);
});

test('billing health reports production readiness without enabling payments by default', () => {
  for (const field of ['configured_environment', 'provider_reachable', 'credentials_configured', 'webhook_secret_configured', 'payments_enabled', 'production_payments_enabled']) {
    assert.match(billingHealth, new RegExp(`${field}:`));
  }
  assert.match(billingHealth, /productionReady/);
  assert.match(billingHealth, /const environmentConfirmed = configuredEnvironment === 'test' \? sandboxAllowed : productionReady/);
  assert.match(billingHealth, /configuredEnvironment === 'test' \? sandboxAllowed : productionReady && productionPaymentsEnabled/);
  assert.doesNotMatch(billingHealth, /return[^\n]*MERCADO_PAGO_ACCESS_TOKEN/);
  assert.doesNotMatch(billingHealth, /return[^\n]*MERCADO_PAGO_WEBHOOK_SECRET/);
});
