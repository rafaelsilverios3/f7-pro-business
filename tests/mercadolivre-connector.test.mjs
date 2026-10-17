import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20261015233622_mercado_livre_connector_foundation.sql');
const entitlementMigration = read('supabase/migrations/0085_tenant_commercial_access_hardening.sql');
const api = read('supabase/functions/mercadolivre-api/index.ts');
const processor = read('supabase/functions/_shared/mercadolivreNotificationProcessor.ts');
const tokenHelper = read('supabase/functions/_shared/mercadolivreTokens.ts');
const callback = read('supabase/functions/mercadolivre-callback/index.ts');
const webhook = read('supabase/functions/mercadolivre-webhook/index.ts');
const webhookPayload = read('supabase/functions/_shared/mercadolivreWebhook.ts');
const connect = read('supabase/functions/mercadolivre-connect/index.ts');
const ui = read('src/components/commerce/MercadoLivreConnector.jsx');
const service = read('src/services/mercadoLivreService.js');

test('Mercado Livre tables keep OAuth secrets private and tenant business reads RLS scoped', () => {
  for (const table of ['meli_connections', 'meli_oauth_states', 'meli_listing_links', 'meli_orders', 'meli_webhook_events', 'meli_sync_runs']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /revoke all on public\.meli_connections, public\.meli_oauth_states,[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.meli_listing_links, public\.meli_orders, public\.meli_sync_runs\s+to authenticated/);
  assert.match(migration, /current_company_role\(company_id\) in \('admin','gestor','comercial','vendedor'\)/);
  assert.doesNotMatch(migration, /grant all on public\.meli_/i);
});

test('OAuth state is hashed, one use, short lived, and private RPCs are service-role only', () => {
  assert.match(connect, /sha256\(state\)/);
  assert.match(connect, /10 \* 60_000/);
  assert.match(callback, /meli_consume_oauth_state/);
  assert.match(migration, /state\.consumed_at is null/);
  assert.match(migration, /state\.expires_at > clock_timestamp\(\)/);
  assert.match(migration, /revoke all on function public\.meli_consume_oauth_state\(text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.meli_consume_oauth_state\(text\) to service_role/);
});

test('refresh rotation uses a tenant scoped lease and marks ambiguous refreshes for reauthorization', () => {
  assert.match(migration, /meli_claim_token_refresh\(p_company_id uuid, p_connection_id uuid, p_lease_id uuid\)/);
  assert.match(migration, /and connection\.id = p_connection_id/);
  assert.match(migration, /meli_claim_token_refresh\(uuid, uuid, uuid\)/);
  assert.match(migration, /refresh_lease_id = p_lease_id/);
  assert.match(migration, /refresh_lease_until is null or connection\.refresh_lease_until < clock_timestamp\(\)/);
  assert.match(migration, /token_version = connection\.token_version \+ 1/);
  assert.match(migration, /status = 'reauth_required'/);
  assert.match(tokenHelper, /meli_claim_token_refresh/);
  assert.match(tokenHelper, /meli_complete_token_refresh/);
  assert.match(tokenHelper, /meli_fail_token_refresh/);
  assert.match(tokenHelper, /p_connection_id: connection\.id/);
  assert.match(api, /accessMercadoLivreToken/);
});

test('catalog snapshots reject seller IDs that do not match the authorized connection', () => {
  assert.match(processor, /assertSellerOwnedItem\(item, sellerId\)/);
  assert.match(api, /persistMeliListing\(sb, companyId, connection\.id, String\(connection\.seller_id\), item\.data\)/);
  assert.match(service, /MELI_LISTING_SELLER_MISMATCH/);
  assert.match(service, /MELI_VARIATIONS_UNSUPPORTED/);
});

test('changing a connected seller immediately clears the previous seller data and reloads the selected account', () => {
  assert.match(ui, /setListings\(\[\]\); setOrders\(\[\]\); setHistory\(\[\]\); setProducts\(\[\]\);[\s\S]*?refresh\(\);/);
});

test('API validates active company membership, role, and centralized plan entitlement server-side', () => {
  assert.match(api, /authorizeMarketplace\(req, companyId/);
  const access = read('supabase/functions/_shared/mercadolivreAccess.ts');
  assert.match(access, /from\('company_users'\)/);
  assert.match(access, /member\?\.active !== true/);
  assert.match(access, /MANAGER_ROLES/);
  assert.match(access, /company_has_feature_internal/);
  assert.match(access, /marketplace_integrations/);
  assert.match(access, /entitlement\.unavailable.*ENTITLEMENT_CHECK_FAILED/);
  assert.match(entitlementMigration, /subscription_status in \('expired',\s*'cancelled',\s*'suspended',\s*'past_due'\)/);
  assert.match(entitlementMigration, /plan_features/);
  assert.match(entitlementMigration, /company_feature_overrides/);
  assert.match(callback, /checkMarketplaceEntitlement\(sb, companyId\)/);
  assert.match(webhook, /checkMarketplaceEntitlement\(sb, String\(match\.company_id\)\)/);
  assert.doesNotMatch(access, /service_role.*browser/i);
  assert.match(api, /eq\('company_id', companyId\)/);
});

test('catalog and order sync use seller scoped official API routes and do not create F7 sales', () => {
  assert.match(api, /\/users\/\$\{encodeURIComponent\(connection\.seller_id\)\}\/items\/search\?\$\{query\.toString\(\)\}/);
  assert.match(api, /new URLSearchParams\(\{ search_type: 'scan', limit: '20' \}\)/);
  assert.match(api, /\/orders\/search\?/);
  assert.match(api, /from\('meli_orders'\)\.upsert/);
  assert.doesNotMatch(api, /from\('sales'\)\.(insert|upsert)/);
  assert.doesNotMatch(api, /from\('stock_movements'\)\.(insert|upsert)/);
  assert.doesNotMatch(api, /from\('financial_entries'\)\.(insert|upsert)/);
});

test('stock and price pushes require manager permission, explicit confirmation, mapped product and idempotency key', () => {
  assert.match(api, /const managerActions = \['disconnect', 'map_listing', 'push_product'\]/);
  assert.match(api, /action === 'push_product' && body\?\.confirm !== true/);
  assert.match(api, /action === 'push_product' \|\| key !== undefined/);
  assert.match(api, /MELI_LISTING_PRODUCT_NOT_MAPPED/);
  assert.match(api, /MELI_STOCK_MUST_BE_INTEGER/);
  assert.match(api, /method: 'PUT', body: JSON\.stringify\(payload\)/);
  assert.match(api, /remoteListing\.data\.variations\.length > 0/);
  assert.match(api, /assertSellerOwnedItem\(remoteListing\.data, String\(connection\.seller_id\)\)/);
  assert.match(ui, /window\.confirm\(/);
  assert.match(ui, /idempotency_key: crypto\.randomUUID\(\)/);
});

test('webhook validates official source IP, app/seller/topic, provider event ID, and queues only safe pointers', () => {
  assert.match(webhook, /boundedNotificationPayload/);
  assert.match(webhookPayload, /MAX_NOTIFICATION_BYTES = 32_768/);
  assert.match(webhookPayload, /reader.read()/);
  assert.match(webhook, /cf-connecting-ip/);
  assert.match(webhook, /isOfficialMercadoLivreWebhookIp/);
  assert.match(webhook, /application_id/);
  assert.match(webhook, /eq\('seller_id', sellerId\)/);
  assert.match(webhook, /providerId\)\) return json\(\{ code: 'ACCEPTED', accepted: false \}\)/);
  assert.doesNotMatch(webhook, /const minute =|sent\) \|\| ''/);
  assert.match(webhook, /deduplicated: true/);
  assert.match(webhook, /safeResourcePath/);
  assert.match(webhook, /meli_enqueue_notification/);
  assert.doesNotMatch(webhook, /from\('meli_orders'\)\.(insert|upsert)/);
});

test('connector configuration messaging reports only an aggregate incomplete state', () => {
  assert.match(ui, /configuração necessária.*incompleta no servidor.*não informa quais itens estão ausentes/i);
  assert.doesNotMatch(ui, /O backend confirmou que o aplicativo OAuth e a chave de criptografia/i);
  assert.match(service, /A configuração necessária para conectar o Mercado Livre está incompleta no servidor/);
});

test('notification claims are isolated by company and connection with bounded retry count', () => {
  const workerMigration = read('supabase/migrations/20261017012312_mercado_livre_notification_worker.sql');
  assert.match(workerMigration, /meli_claim_notification_batch/);
  assert.match(workerMigration, /event\.company_id = p_company_id/);
  assert.match(workerMigration, /event\.connection_id = p_connection_id/);
  assert.match(workerMigration, /event\.attempts < 6/);
  assert.match(api, /p_connection_id: connection\.id, p_limit: 10/);
});

test('catalog pagination resumes using server-stored scan cursor and orders use official page offsets', () => {
  assert.match(migration, /catalog_scroll_id text/);
  assert.match(api, /query\.set\('scroll_id', connection\.catalog_scroll_id\)/);
  assert.match(api, /catalog_scroll_id: nextScrollId/);
  assert.match(api, /offset: String\(offset\)/);
  assert.match(api, /next_offset: hasMore \? offset \+ orders\.length : null/);
  assert.match(api, /action === 'list_history'/);
});

test('frontend calls real functions and exposes no direct token persistence', () => {
  assert.match(ui, /mercadoLivreAction\(companyId, 'status'\)/);
  assert.match(ui, /startMercadoLivreConnection\(company\.id\)/);
  assert.doesNotMatch(ui, /access_token|refresh_token|client_secret/i);
  assert.doesNotMatch(ui, /mock|fixture|simulat/i);
});

test('Edge Function JWT modes preserve public callback/webhook and authenticated management handlers', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.mercadolivre-connect\]\s+verify_jwt = true/);
  assert.match(config, /\[functions\.mercadolivre-api\]\s+verify_jwt = true/);
  assert.match(config, /\[functions\.mercadolivre-callback\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.mercadolivre-webhook\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.mercadolivre-notification-worker\]\s+verify_jwt = true/);
});
