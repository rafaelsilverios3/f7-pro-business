import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0085_tenant_commercial_access_hardening.sql', 'utf8');
const saleMigration = fs.readFileSync('supabase/migrations/0053_product_service_items.sql', 'utf8');
const purchaseMigration = fs.readFileSync('supabase/migrations/0003_transactional_flows.sql', 'utf8');
const productionMigration = fs.readFileSync('supabase/migrations/0054_production_module.sql', 'utf8');
const draftMigration = fs.readFileSync('supabase/migrations/0086_ai_sales_draft_rpc.sql', 'utf8');
const serviceLedgerMigration = fs.readFileSync('supabase/migrations/0087_service_role_commercial_ledger_write_boundary.sql', 'utf8');
const activeSubscriptionGateMigration = fs.readFileSync('supabase/migrations/20261020022410_platform_entitlement_requires_active_subscription.sql', 'utf8');

test('browser entitlement RPC preserves PostgREST argument names and requires active company membership', () => {
  assert.match(migration, /company_has_feature\(target_company uuid, feature text\)/i);
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_company_member\(target_company\)/i);
  assert.match(migration, /revoke all on function public\.company_has_feature\(uuid, text\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.company_has_feature\(uuid, text\) to authenticated, service_role/i);
  assert.match(migration, /auth\.role\(\) = 'service_role'[\s\S]*?company_has_feature_internal/i);
});

test('internal entitlement lookup is executable only by service_role', () => {
  assert.match(migration, /create or replace function public\.company_has_feature_internal\(target_company uuid, feature text\)/i);
  assert.match(migration, /revoke all on function public\.company_has_feature_internal\(uuid, text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.company_has_feature_internal\(uuid, text\) to service_role/i);
});

test('pending subscription states and inactive plan catalog entries fail closed before overrides or fallbacks', () => {
  assert.match(activeSubscriptionGateMigration, /subscription_found and subscription_status is distinct from 'active'[\s\S]*?return false/i);
  assert.match(activeSubscriptionGateMigration, /select p\.active into plan_is_active[\s\S]*?plan_is_active is distinct from true[\s\S]*?return false/i);
  assert.ok(activeSubscriptionGateMigration.indexOf('plan_is_active is distinct from true') < activeSubscriptionGateMigration.indexOf('from public.company_feature_overrides'));
  assert.match(activeSubscriptionGateMigration, /o\.feature = lower\(trim\(\$2\)\)/i);
  assert.match(activeSubscriptionGateMigration, /pf\.feature = lower\(trim\(\$2\)\)/i);
  assert.match(activeSubscriptionGateMigration, /missing row uses the Free fallback/i);
  assert.match(activeSubscriptionGateMigration, /security definer[\s\S]*?set search_path = pg_catalog, public, pg_temp/i);
});

test('service-role Edge Functions use the restricted resolver after their own authorization checks', () => {
  for (const path of [
    'supabase/functions/ai-assistant/index.ts',
    'supabase/functions/ai-sales-assistant/index.ts',
    'supabase/functions/assistant-suggest/index.ts',
    'supabase/functions/automation-worker/index.ts',
    'supabase/functions/intelligence-query/index.ts',
    'supabase/functions/supplier-intelligence/index.ts',
    'supabase/functions/whatsapp-send/index.ts',
  ]) {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /company_has_feature_internal/, `${path} should use the internal resolver`);
    assert.match(source, /company_users|authorized\(/, `${path} must retain authorization checks`);
  }
  for (const path of ['supabase/functions/whatsapp-connect/index.ts', 'supabase/functions/whatsapp-test/index.ts']) {
    assert.match(fs.readFileSync(path, 'utf8'), /viewer\.rpc\('company_has_feature'/, `${path} should retain user-scoped lookup`);
  }
});

test('commercial ledgers allow tenant-scoped reads but deny browser-side transactional writes', () => {
  for (const table of ['sales', 'sale_items', 'stock_movements']) {
    assert.match(migration, new RegExp(`drop policy if exists company_isolation on public\\.%I`, 'i'));
    assert.match(migration, new RegExp(`revoke insert, update, delete on public\\.%I from anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant select on public\\.%I to authenticated`, 'i'));
    assert.ok(['sales', 'sale_items', 'stock_movements'].includes(table));
  }
  assert.match(migration, /create policy tenant_member_select on public\.%I for select to authenticated using \(public\.is_company_member\(company_id\)\)/i);
});

test('non-row table privileges are removed from public relations and migration-owner defaults', () => {
  assert.match(migration, /revoke truncate, trigger, references, maintain on all tables in schema public\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /alter default privileges for role %I revoke truncate, trigger, references, maintain on tables/i);
  assert.match(migration, /alter default privileges for role %I in schema public revoke truncate, trigger, references, maintain on tables from public, anon, authenticated, service_role/i);
  assert.match(migration, /current_user[\s\S]*?alter default privileges[\s\S]*?current_user/i);
  assert.match(migration, /has_table_privilege\('authenticated', relation\.oid, 'TRUNCATE'\)/i);
  assert.match(migration, /has_table_privilege\('authenticated', relation\.oid, 'TRIGGER'\)/i);
  assert.match(migration, /has_table_privilege\('authenticated', relation\.oid, 'REFERENCES'\)/i);
  assert.match(migration, /has_table_privilege\('authenticated', relation\.oid, 'MAINTAIN'\)/i);
  assert.match(migration, /has_table_privilege\('service_role', relation\.oid, 'TRUNCATE'\)/i);
  assert.match(migration, /supabase_admin/i);
  assert.doesNotMatch(migration, /alter default privileges for role %I[\s\S]*?default_owner\.rolname/i);
  assert.doesNotMatch(migration, /grant\s+(?:all|truncate|trigger)[^;]*\bto\s+(?:public|anon|authenticated|service_role)/i);
});

test('customer CRUD follows server-side roles instead of frontend-only permissions', () => {
  assert.match(migration, /create policy customers_select[\s\S]*?current_company_role\(company_id\) in \('admin', 'gestor', 'comercial', 'vendedor', 'atendimento'\)/i);
  assert.match(migration, /create policy customers_insert[\s\S]*?current_company_role\(company_id\) in \('admin', 'gestor', 'comercial', 'vendedor', 'atendimento'\)/i);
  assert.match(migration, /create policy customers_update[\s\S]*?current_company_role\(company_id\) in \('admin', 'gestor', 'comercial'\)/i);
  assert.match(migration, /create policy customers_delete[\s\S]*?current_company_role\(company_id\) in \('admin', 'gestor', 'comercial'\)/i);
});

test('stock and sales writes stay behind role-checked RPCs', () => {
  assert.match(migration, /alter function public\.finalize_sale\(jsonb\) security definer/i);
  assert.match(migration, /alter function public\.finalize_sale_financial\(jsonb\) security definer/i);
  assert.match(migration, /alter function public\.cancel_sale\(uuid\) security definer/i);
  assert.match(saleMigration, /current_company_role\(company\) not in \('admin','gestor','comercial','vendedor'\)/i);
  assert.match(saleMigration, /current_company_role\(result\.company_id\) not in \('admin','gestor','comercial','vendedor'\)/i);
  assert.match(migration, /current_company_role\(purchase_row\.company_id\) not in \('admin', 'gestor', 'estoque'\)/i);
  assert.match(migration, /current_company_role\(product_row\.company_id\) not in \('admin', 'gestor', 'estoque'\)/i);
  assert.match(migration, /grant execute on function public\.adjust_inventory\(uuid, numeric, text\) to authenticated/i);
  assert.match(purchaseMigration, /where id = target_purchase and is_company_member\(company_id\)/i);
  assert.match(productionMigration, /current_company_role\(company_uuid\) not in \('admin','gestor','estoque'\)/i);
  assert.match(migration, /alter function public\.complete_production_order\(jsonb\) security definer/i);
});

test('inventory adjustments use an atomic server-side RPC for Supabase', () => {
  const service = fs.readFileSync('src/services/inventoryService.js', 'utf8');
  const products = fs.readFileSync('src/services/productsService.js', 'utf8');
  assert.match(service, /rpc\('adjust_inventory'/);
  assert.match(products, /rpc\('adjust_inventory'/);
  assert.match(migration, /update public\.products set stock = target_stock[\s\S]*?insert into public\.stock_movements/i);
});

test('service role keeps commercial ledger reads but loses direct write grants', () => {
  assert.match(serviceLedgerMigration, /revoke insert, update, delete on table\s+public\.sales,\s+public\.sale_items,\s+public\.stock_movements\s+from service_role/i);
  assert.doesNotMatch(serviceLedgerMigration, /revoke\s+select/i);
  assert.match(serviceLedgerMigration, /conceptual rollback/i);
});

test('AI Sales draft RPC is tenant-checked, confirmation-gated and idempotent', () => {
  assert.match(draftMigration, /security definer/i);
  assert.match(draftMigration, /set search_path = pg_catalog, public, pg_temp/i);
  assert.match(draftMigration, /auth\.uid\(\) is null/i);
  assert.match(draftMigration, /is_company_member\(company\)/i);
  assert.match(draftMigration, /current_company_role\(company\) not in/i);
  assert.match(draftMigration, /company_has_feature\(company, 'ai_sales'\)/i);
  assert.match(draftMigration, /confirmed boolean := coalesce/i);
  assert.match(draftMigration, /pg_advisory_xact_lock/i);
  assert.match(draftMigration, /where id = product_id and company_id = company and active\s+for update/i);
  assert.match(draftMigration, /product_row\.stock < quantity/i);
  assert.match(draftMigration, /insert into public\.sales[\s\S]*?'draft'/i);
  assert.doesNotMatch(draftMigration, /insert into public\.(sale_items|stock_movements)/i);
  assert.match(draftMigration, /revoke all on function public\.create_draft_sale\(jsonb\) from public, anon, service_role/i);
  assert.match(draftMigration, /grant execute on function public\.create_draft_sale\(jsonb\) to authenticated/i);
});

test('sales and inventory clients use transactional RPCs; Edge Functions do not directly mutate ledgers', () => {
  assert.match(fs.readFileSync('src/services/salesService.js', 'utf8'), /rpc\('finalize_sale_financial'/);
  assert.match(fs.readFileSync('src/services/salesService.js', 'utf8'), /rpc\('cancel_sale'/);
  assert.match(fs.readFileSync('src/services/inventoryService.js', 'utf8'), /rpc\('adjust_inventory'/);
  assert.match(fs.readFileSync('src/services/purchasesService.js', 'utf8'), /rpc\('receive_purchase'/);
  assert.match(fs.readFileSync('src/services/productionService.js', 'utf8'), /rpc\('complete_production_order'/);
  for (const table of ['sales', 'sale_items', 'stock_movements']) {
    const directMutation = new RegExp(`from\\(['\"]${table}['\"]\\)\\.(insert|update|upsert|delete)`);
    for (const file of fs.readdirSync('supabase/functions', { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const entry = `supabase/functions/${file.name}/index.ts`;
      if (fs.existsSync(entry)) assert.doesNotMatch(fs.readFileSync(entry, 'utf8'), directMutation, `${entry} must not directly mutate ${table}`);
    }
  }
});
