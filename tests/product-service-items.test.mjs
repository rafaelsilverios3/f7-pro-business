import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0053_product_service_items.sql', 'utf8');
const productDialog = fs.readFileSync('src/components/produtos/ProductDialog.jsx', 'utf8');
const productsPage = fs.readFileSync('src/pages/Produtos.jsx', 'utf8');
const saleDialog = fs.readFileSync('src/components/vendas/SaleDialog.jsx', 'utf8');
const quoteDialog = fs.readFileSync('src/components/orcamentos/QuoteDialog.jsx', 'utf8');
const pdv = fs.readFileSync('src/pages/PDV.jsx', 'utf8');
const schema = fs.readFileSync('src/schemas/index.js', 'utf8');

test('catalog distinguishes products and services with backwards compatible defaults', () => {
  assert.match(migration, /add column if not exists item_type text not null default 'product'/);
  assert.match(migration, /item_type in \('product','service'\)/);
  assert.match(migration, /duration_minutes integer/);
  assert.match(schema, /item_type: z\.enum\(\['product', 'service'\]\)/);
  assert.match(productDialog, /Produto/);
  assert.match(productDialog, /Serviço/);
});

test('service catalog UI hides inventory controls and keeps price, cost and commission', () => {
  assert.match(productDialog, /const isProduct = itemType === 'product'/);
  assert.match(productDialog, /const isService = itemType === 'service'/);
  assert.match(productDialog, /!isService && <div[\s\S]*?Estoque inicial/);
  assert.match(productDialog, /fixedItemType \? defaultItemType/);
  assert.match(productDialog, /Duração estimada/);
  assert.match(productDialog, /Comissão %/);
  assert.match(productsPage, /Total de \{tab === .*'serviços'.*\}/);
  assert.match(productsPage, /p\.item_type === 'service' \? '—'/);
  assert.match(productsPage, /tab !== 'material'/);
});

test('mixed sale and quote preserve item type and show separated subtotals', () => {
  for (const source of [saleDialog, quoteDialog]) {
    assert.match(source, /item_type: p\.item_type \|\| 'product'/);
    assert.match(source, /Adicionar produto ou serviço/);
    assert.match(source, /item_type === 'service'/);
  }
});

test('sale dialog preserves the exact entered price until submit normalization', () => {
  assert.match(saleDialog, /const setPrice = .*\{ \.\.\.i, price \}/);
  assert.match(saleDialog, /const normalizedItems = items\.map/);
  assert.match(saleDialog, /price: moneyOr\(item\.price\)/);
  assert.match(saleDialog, /normalizedTotal <= 0/);
});

test('PDV allows services without stock validation', () => {
  assert.match(pdv, /product\.item_type === 'service'/);
  assert.match(pdv, /service \? null/);
  assert.match(pdv, /!service && stock <= 0/);
  assert.match(pdv, /entry\.item_type === 'service'/);
});

test('sale backend skips service inventory and restores only products on cancellation', () => {
  assert.match(migration, /item->>'item_type' = 'product'/);
  assert.match(migration, /coalesce\(item->>'item_type','product'\) = 'product'/);
  assert.match(migration, /insert into public\.financial_entries/);
  assert.match(migration, /insert into public\.commissions/);
});
