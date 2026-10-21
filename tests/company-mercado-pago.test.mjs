import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261022090000_company_mercado_pago_connect.sql', import.meta.url), 'utf8');
const oauthFixMigration = await readFile(new URL('../supabase/migrations/20261021120000_company_mp_oauth_state_rpc.sql', import.meta.url), 'utf8');
const shared = await readFile(new URL('../supabase/functions/_shared/mercadoPagoCompany.ts', import.meta.url), 'utf8');
const connect = await readFile(new URL('../supabase/functions/mercado-pago-company-connect/index.ts', import.meta.url), 'utf8');
const payments = await readFile(new URL('../supabase/functions/mercado-pago-company-payments/index.ts', import.meta.url), 'utf8');
const webhook = await readFile(new URL('../supabase/functions/mercado-pago-company-webhook/index.ts', import.meta.url), 'utf8');
const status = await readFile(new URL('../supabase/functions/mercado-pago-company-status/index.ts', import.meta.url), 'utf8');
const bankPanel = await readFile(new URL('../src/components/finance/BankAccountsPanel.jsx', import.meta.url), 'utf8');
const billingDialog = await readFile(new URL('../src/components/vendas/QuoteBillingDialog.jsx', import.meta.url), 'utf8');
const salesPage = await readFile(new URL('../src/pages/Vendas.jsx', import.meta.url), 'utf8');

test('company OAuth uses explicit authorization, one-use state, PKCE S256, and server-only credentials', () => {
  assert.match(shared, /response_type["']?, ["']code["']/);
  assert.match(shared, /code_challenge_method["']?, ["']S256["']/);
  assert.match(shared, /code_challenge/);
  assert.match(migration, /pkce_verifier text not null/);
  assert.match(migration, /company_mp_consume_oauth_state/);
  assert.match(oauthFixMigration, /company_mp_create_oauth_state/);
  assert.match(oauthFixMigration, /current_company_role\(p_company\) not in \('admin','gestor','financeiro'\)/);
  assert.match(connect, /access\.sb\.rpc\([\s\S]*?company_mp_create_oauth_state/);
  assert.doesNotMatch(connect, /from\(["']company_mp_oauth_states["']\)\.insert/);
  assert.match(migration, /consumed_at is null and s\.expires_at>now\(\)/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /grant execute on function public\.company_mp_save_connection[^;]*to service_role/);
  assert.doesNotMatch(bankPanel, /access_token|refresh_token|client_secret/i);
});

test('company ownership and tenant scope are enforced for payment and ledger records', () => {
  assert.match(migration, /current_company_role\(company_id\) in \('admin','gestor','financeiro','comercial','vendedor'\)/);
  assert.match(migration, /foreign key\(company_id,sale_id\) references public\.sales\(company_id,id\)/);
  assert.match(migration, /foreign key\(company_id,financial_entry_id\) references public\.financial_entries\(company_id,id\)/);
  assert.match(migration, /sales_company_id_id_uidx/);
  assert.match(migration, /company_mp_payments_one_open_attempt/);
  assert.match(migration, /company_mp_create_payment_attempt/);
  assert.match(migration, /entry\.received_amount<>0/);
  assert.match(migration, /MP_PAYMENT_PENDING_PREVENTS_SALE_CANCEL/);
  assert.match(migration, /MP_PENDING_PAYMENT_PREVENTS_DISCONNECT/);
});

test('online payments use the tenant OAuth token, exact billed value and provider idempotency', () => {
  assert.match(payments, /company_mp_get_payment_server/);
  assert.match(payments, /external_reference: payment\.id/);
  assert.match(payments, /X-Idempotency-Key/);
  assert.match(payments, /record\.seller_id/);
  assert.match(payments, /MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED/);
  assert.match(payments, /sale\?\.status !== ["']completed["']/);
  assert.match(payments, /sale\.total\) !== Number\(payment\.amount\)/);
  assert.match(payments, /safeHttpsMercadoPago/);
  assert.ok(payments.indexOf('payer = await customerForSale') < payments.indexOf('company_mp_create_payment_attempt'), 'payer must validate before the financial intent is created');
  assert.doesNotMatch(payments, /billing_.*access_token|MERCADO_PAGO_ACCESS_TOKEN/);
});

test('webhook confirmation validates HMAC and authoritative provider details before idempotent settlement', () => {
  assert.match(webhook, /x-signature/);
  assert.match(shared, /request-id:/);
  assert.match(shared, /crypto\.subtle\.importKey\([\s\S]*?["']HMAC["']/);
  assert.match(webhook, /verifyWebhookSignature/);
  assert.match(webhook, /\/v1\/payments\//);
  assert.match(webhook, /collector_id/);
  assert.match(webhook, /transaction_amount/);
  assert.match(webhook, /company_mp_apply_provider_status/);
  assert.match(migration, /on conflict\(provider_event_key\) do nothing/);
  assert.match(migration, /mp-payment:'\|\|payment\.id::text/);
  assert.match(migration, /mp-refund:'\|\|p_event_key/);
  assert.match(migration, /company_mp_webhook_events\(provider_event_key,payment_id,company_id\)[\s\S]*?on conflict\(provider_event_key\) do nothing/);
});

test('status is available to permitted sales roles and browser returns never settle a payment', () => {
  assert.match(status, /companyAccess\(req, companyId, ["']sales["']\)/);
  assert.match(status, /access\.sb\.from\(["']company_mp_connections["']\)/);
  assert.match(billingDialog, /A cobrança só será solicitada ao Mercado Pago quando você confirmar o faturamento/);
  assert.match(billingDialog, /await onFinalized\(targetSale, true\)/);
  assert.match(salesPage, /onFinalized=\{async \(sale, keepDialog = false\)/);
  assert.match(billingDialog, /refreshPayment\(/);
  assert.match(migration, /if status_value='approved' and previous_status<>'approved' then/);
});
