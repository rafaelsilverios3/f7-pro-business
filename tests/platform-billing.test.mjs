import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0064_platform_billing_foundation.sql', 'utf8');
const checkout = fs.readFileSync('supabase/functions/billing-checkout/index.ts', 'utf8');
const webhook = fs.readFileSync('supabase/functions/billing-webhook/index.ts', 'utf8');
const plans = fs.readFileSync('supabase/functions/billing-plans/index.ts', 'utf8');
const service = fs.readFileSync('src/services/billingService.js', 'utf8');
const page = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const site = fs.readFileSync('src/pages/PublicSite.jsx', 'utf8');
const subscriptionPage = fs.readFileSync('src/pages/SubscriptionBilling.jsx', 'utf8');

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
  assert.doesNotMatch(site, /R\$\s*\d/);
});

test('checkout resolves amount from the active plan and keeps provider secrets server-side', () => {
  assert.match(checkout, /eq\('code', planCode\)\.eq\('active', true\)/);
  assert.match(checkout, /MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(checkout, /X-Idempotency-Key/);
  assert.match(checkout, /transaction_amount/);
  assert.doesNotMatch(service + page, /MERCADO_PAGO_ACCESS_TOKEN|WEBHOOK_SECRET/);
});

test('PIX exposes provider evidence and payment activation only comes from webhook', () => {
  assert.match(checkout, /qr_code/);
  assert.match(checkout, /qr_code_base64/);
  assert.match(page, /webhook do Mercado Pago/);
  assert.match(webhook, /validSignature/);
  assert.match(webhook, /MERCADO_PAGO_WEBHOOK_SECRET/);
  assert.match(webhook, /billing_webhook_events/);
  assert.match(webhook, /duplicate/);
  assert.match(webhook, /status === 'approved'/);
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

test('subscription screen is tenant-scoped and exposes only platform billing history', () => {
  assert.match(app, /path="\/assinatura"/);
  assert.match(subscriptionPage, /company_subscriptions/);
  assert.match(subscriptionPage, /billing_payments/);
  assert.match(subscriptionPage, /eq\('company_id', company\.id\)/);
  assert.doesNotMatch(subscriptionPage, /financial_entries|salesRepository|financeRepository/);
  assert.match(subscriptionPage, /Dados financeiros operacionais da empresa não são usados/);
});
