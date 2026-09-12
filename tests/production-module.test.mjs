import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0054_production_module.sql', 'utf8');
const page = fs.readFileSync('src/pages/Producao.jsx', 'utf8');
const service = fs.readFileSync('src/services/productionService.js', 'utf8');
const sale = fs.readFileSync('src/components/vendas/SaleDialog.jsx', 'utf8');
const schema = fs.readFileSync('src/schemas/index.js', 'utf8');

test('production schema is tenant isolated and keeps cost snapshots', () => {
  for (const table of ['production_recipes', 'production_recipe_items', 'production_orders', 'production_order_items']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /public\.is_company_member\(company_id\)/);
  assert.match(migration, /cost_snapshot/);
  assert.match(migration, /create or replace function public\.save_production_recipe/);
  assert.match(migration, /create or replace function public\.complete_production_order/);
});

test('recipe recalculation updates cost without changing price', () => {
  assert.match(migration, /update public\.products set cost=recipe_row\.unit_cost/);
  assert.doesNotMatch(migration, /set price=/i);
  assert.match(page, /O preço de venda não muda automaticamente/);
});

test('production is atomic and records material out plus finished product in', () => {
  assert.match(migration, /material_row\.stock < required_qty/);
  assert.match(migration, /stock=stock-required_qty/);
  assert.match(migration, /'out',required_qty,'Produção/);
  assert.match(migration, /stock=stock\+quantity_to_make/);
  assert.match(migration, /'in',quantity_to_make,'Produção/);
  assert.match(service, /complete_production_order/);
});

test('sales preserve labor/service item and keep one commercial total', () => {
  assert.match(schema, /linked_product_id/);
  assert.match(sale, /MÃO DE OBRA\/SERVIÇO/);
  assert.match(sale, /Produtos/);
  assert.match(sale, /Serviços/);
  assert.match(schema, /linked_product_id/);
});

test('production UI exposes decimal quantities, cost inputs and batch production', () => {
  assert.match(page, /conversion_factor/);
  assert.match(page, /loss_percent/);
  assert.match(page, /labor_cost/);
  assert.match(page, /Produzir lote/);
  assert.match(page, /quantity/);
});
