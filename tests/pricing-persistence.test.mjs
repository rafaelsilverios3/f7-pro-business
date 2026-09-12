import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateMargin } from '../src/lib/pricing.js';

const rpc = fs.readFileSync('supabase/migrations/0052_pricing_cost_sync.sql', 'utf8');
const service = fs.readFileSync('src/services/pricingService.js', 'utf8');
const pricingPage = fs.readFileSync('src/pages/Precificacao.jsx', 'utf8');
const productsPage = fs.readFileSync('src/pages/Produtos.jsx', 'utf8');
const productDialog = fs.readFileSync('src/components/produtos/ProductDialog.jsx', 'utf8');

test('pricing RPC persists cost and price and returns the updated product', () => {
  assert.match(rpc, /update public\.products set cost = round\(applied_cost, 2\), price = round\(new_price, 2\)/);
  assert.match(rpc, /where id = product_row\.id and company_id = target_company returning \* into updated_row/);
  assert.match(rpc, /return updated_row/);
  assert.match(rpc, /product_row\.cost/);
});

test('pricing UI uses the persisted RPC row for both cost and price', () => {
  assert.match(service, /pricingData\?\.realCost/);
  assert.match(pricingPage, /const updated = await applyProductPrice/);
  assert.match(pricingPage, /setProducts\(\(current\) => current\.map/);
  assert.match(productsPage, /const updated = await applyProductPrice/);
  assert.match(productsPage, /return updated/);
  assert.match(productDialog, /updated\?\.price \?\? price/);
  assert.match(productDialog, /updated\?\.cost != null/);
});

test('simple margin is derived from persisted cost and price', () => {
  assert.ok(Math.abs(calculateMargin(120, 50) - 58.33333333333333) < 1e-10);
  assert.equal(calculateMargin(150, 60), 60);
  assert.equal(calculateMargin(0, 60), 0);
});

test('pricing RPC remains tenant scoped and does not change variant pricing', () => {
  assert.match(rpc, /company_id = target_company/);
  assert.doesNotMatch(rpc, /product_variants/);
  assert.match(service, /apply_product_price/);
});
