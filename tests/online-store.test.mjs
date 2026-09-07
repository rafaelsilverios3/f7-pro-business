import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/0023_online_store.sql', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');

test('loja possui slug, isolamento e pedido público transacional', () => {
  assert.match(migration, /store_slug text/);
  assert.match(migration, /store_enabled boolean/);
  assert.match(migration, /create or replace function public\.get_public_storefront/);
  assert.match(migration, /create or replace function public\.create_public_store_order/);
  assert.match(migration, /origin text not null default 'loja_online'/);
});

test('função pública não seleciona custo, margem ou fornecedor', () => {
  const publicFunction = migration.split('create or replace function public.get_public_storefront')[1].split('revoke all on function')[0];
  assert.doesNotMatch(publicFunction, /p\.cost|cost_price|margin|supplier/i);
  assert.match(publicFunction, /short_description/);
  assert.match(publicFunction, /'category', null::text/);
  assert.doesNotMatch(publicFunction, /p\.category/);
  assert.match(publicFunction, /price/);
  assert.match(publicFunction, /stock/);
  assert.match(publicFunction, /jsonb_agg\([\s\S]*order by p\.featured desc, p\.name/);
  assert.match(publicFunction, /jsonb_agg\([\s\S]*order by i\.sort_order/);
  assert.match(publicFunction, /jsonb_agg\([\s\S]*order by v\.created_at/);
});

test('migration 0023 pode ser reexecutada sem duplicar constraints', () => {
  assert.match(migration, /drop constraint if exists store_orders_total_check/);
  assert.match(migration, /drop constraint if exists store_orders_status_check/);
  assert.match(migration, /product_id_text !~\*/);
  assert.match(migration, /quantity_text !~ '/);
  assert.match(migration, /variant_id_text !~\*/);
});

test('pedido público reinicia o estado de cada item', () => {
  assert.match(migration, /for input_item in select \* from jsonb_array_elements\(p_items\) loop\s+product_id_value := null; variant_id_value := null; qty := null; unit_price := null;/);
  assert.match(migration, /if variant_id_text is not null then variant_id_value := variant_id_text::uuid; end if;/);
});

test('permissões da loja são separadas por função', () => {
  assert.match(permissions, /store\.view/);
  assert.match(permissions, /store\.manage/);
  assert.match(permissions, /gestor:[^\n]+store\.manage/);
  assert.match(permissions, /comercial:[^\n]+store\.manage/);
  assert.match(permissions, /vendedor:[^\n]+store\.view/);
  assert.doesNotMatch(permissions, /financeiro:[^\n]+store\.manage/);
});
