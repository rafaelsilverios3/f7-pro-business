import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0085_tenant_commercial_access_hardening.sql', 'utf8');
const saleMigration = fs.readFileSync('supabase/migrations/0053_product_service_items.sql', 'utf8');
const purchaseMigration = fs.readFileSync('supabase/migrations/0003_transactional_flows.sql', 'utf8');
const productionMigration = fs.readFileSync('supabase/migrations/0054_production_module.sql', 'utf8');

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
