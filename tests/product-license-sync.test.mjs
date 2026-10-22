import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261022110000_product_license_outbox_and_link_handshake.sql', import.meta.url), 'utf8');
const offerSnapshotMigration = readFileSync(new URL('../supabase/migrations/20261022120000_food_license_sync_offer_snapshot.sql', import.meta.url), 'utf8');
const dispatch = readFileSync(new URL('../supabase/functions/product-license-dispatch/index.ts', import.meta.url), 'utf8');
const link = readFileSync(new URL('../supabase/functions/product-tenant-link/index.ts', import.meta.url), 'utf8');
const checkout = readFileSync(new URL('../supabase/functions/product-checkout/index.ts', import.meta.url), 'utf8');
const webhook = readFileSync(new URL('../supabase/functions/product-checkout-webhook/index.ts', import.meta.url), 'utf8');

test('Food license delivery is durable, tenant-bound, concurrent-safe and service-only', () => {
  assert.match(migration, /product_license_delivery_outbox/);
  assert.match(migration, /product_license_delivery_claim/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /product_attach_verified_food_tenant/);
  assert.match(migration, /FOOD_TENANT_LINK_NOT_VERIFIED/);
  assert.match(dispatch, /F7_COMMERCE_SYNC_SECRET/);
  assert.match(dispatch, /F7_FOOD_LICENSE_SYNC_URL/);
  assert.match(dispatch, /x-f7-signature/);
  assert.match(dispatch, /product_license_delivery_record_result/);
  assert.match(dispatch, /attempts >= 12 \? 'blocked' : 'retry'/);
});

test('link codes are high entropy, expiring, and accepted only from signed Food server requests', () => {
  assert.match(link, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(link, /product_link_challenge_start/);
  assert.match(link, /product_link_challenge_accept/);
  assert.match(link, /constantTimeEqual/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /p_pro_company_id is null/);
  assert.match(migration, /product_tenant_link_account_verified_uidx/);
  assert.match(migration, /PRODUCT_LINK_CHALLENGE_ALREADY_USED/);
});

test('Food-only accounts remain valid and no legacy PRO subscription table is changed', () => {
  assert.doesNotMatch(migration, /company_subscriptions/);
  assert.doesNotMatch(migration, /billing_orders/);
  assert.match(migration, /commercial_accounts/);
  assert.match(migration, /product_key='f7_food'/);
});

test('checkout uses only a disabled-by-default sandbox path and keeps secrets server-side', () => {
  assert.match(migration, /test_checkout_enabled boolean not null default false/);
  assert.match(checkout, /prepare_product_checkout/);
  assert.match(checkout, /MP_TEST_ACCESS_TOKEN/);
  assert.match(checkout, /!\/\^TEST-/);
  assert.match(checkout, /sandbox_init_point/);
  assert.match(checkout, /live_charges_enabled/);
  assert.doesNotMatch(checkout, /checkout_url:\s*preference\.init_point/);
});

test('webhook requires Mercado Pago HMAC and an independent provider payment lookup', () => {
  assert.match(webhook, /MP_PRODUCT_WEBHOOK_SECRET/);
  assert.match(webhook, /x-signature/);
  assert.match(webhook, /x-request-id/);
  assert.match(webhook, /id:\$\{dataId\.toLowerCase\(\)\};request-id:\$\{requestId\};ts:\$\{ts\};/);
  assert.match(webhook, /api\.mercadopago\.com\/v1\/payments/);
  assert.match(webhook, /api\.mercadopago\.com\/checkout\/preferences/);
  assert.match(webhook, /transaction_amount/);
  assert.match(webhook, /external_reference/);
  assert.match(webhook, /confirm_product_test_checkout_payment/);
  assert.match(webhook, /reconcile_product_test_payment_status/);
});

test('Food delivery carries the central offer snapshot so Food can preserve its own catalog IDs', () => {
  assert.match(offerSnapshotMigration, /'offer_id',offer_row\.id/);
  assert.match(offerSnapshotMigration, /'plan_code',offer_row\.offer_code/);
  assert.match(offerSnapshotMigration, /'price_minor',offer_row\.price_minor/);
  assert.match(offerSnapshotMigration, /'trial_days',coalesce\(offer_row\.trial_days,0\)/);
  assert.match(dispatch, /product_license_delivery_record_result/);
  assert.match(readFileSync(new URL('../supabase/migrations/20261022130000_atomic_product_license_delivery_result.sql', import.meta.url), 'utf8'), /for update/);
});

test('checkout and commercial-link controls are present in authenticated journeys', () => {
  const page = readFileSync(new URL('../src/pages/ProductCheckout.jsx', import.meta.url), 'utf8');
  const adminUi = readFileSync(new URL('../src/components/platform-admin/ProductCommerceAdmin.jsx', import.meta.url), 'utf8');
  assert.match(page, /functions\.invoke\('product-checkout'/);
  assert.match(page, /functions\.invoke\('product-tenant-link'/);
  assert.match(page, /one_time_code/);
  assert.match(page, /productKey==='f7_food'/);
  assert.match(page, /checkoutCommand\.current\.idempotency_key/);
  assert.match(page, /pro_company_id: proCompanyId/);
  assert.match(page, /Você pode contratar e operar o F7 Food de forma independente/);
  assert.match(adminUi, /dispatchFoodLicenseSync/);
  assert.match(adminUi, /Tentar novamente/);
});
