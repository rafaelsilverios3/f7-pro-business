import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMoneyInput, moneyOr } from '../src/lib/money.js';

const productsService = fs.readFileSync('src/services/productsService.js', 'utf8');
const productsPage = fs.readFileSync('src/pages/Produtos.jsx', 'utf8');
const productDialog = fs.readFileSync('src/components/produtos/ProductDialog.jsx', 'utf8');
const saleDialog = fs.readFileSync('src/components/vendas/SaleDialog.jsx', 'utf8');
const business = fs.readFileSync('src/lib/business.js', 'utf8');
const productionPage = fs.readFileSync('src/pages/Producao.jsx', 'utf8');
const reconcile = fs.readFileSync('supabase/migrations/0074_catalog_production_reconcile.sql', 'utf8');

test('product price edits use one canonical numeric payload and preserve zero', () => {
  assert.match(productsService, /Number\.isFinite\(parsed\)/);
  assert.match(productsService, /price: 'sale_price'/);
  assert.match(productDialog, /normalizeProductForm/);
  assert.match(productDialog, /await onSave\(normalizeProductForm\(form, fixedItemType, defaultItemType\)\)/);
  assert.match(productDialog, /if \(!form\.name\.trim\(\) \|\| saving\)/);
});

test('referenced products are archived instead of breaking historical foreign keys', () => {
  assert.match(productsService, /no DELETE grant/);
  assert.match(productsService, /archived: true/);
  assert.match(productsService, /active: false/);
  assert.match(productsPage, /productsService\.remove/);
  assert.match(productsPage, /p\.active !== false/);
});

test('catalog and production hide archived items while keeping raw materials available', () => {
  assert.match(saleDialog, /product\.active !== false/);
  assert.match(productionPage, /item\.active !== false/);
  assert.match(reconcile, /item_type in \('product','material','service'\)/);
});

test('Base44 sales do not require or decrement stock for services', () => {
  assert.match(business, /item_type === 'service'\) continue/);
  assert.match(business, /prod && prod\.item_type !== 'service'/);
});

test('sale failures remain visible and keep the dialog open for correction', () => {
  assert.match(saleDialog, /setError\(cause\?\.message/);
  assert.match(saleDialog, /role="alert"/);
  assert.match(saleDialog, /Nenhum lançamento foi criado/);
});

test('Brazilian monetary input is parsed without losing separators or invalid values', () => {
  assert.equal(parseMoneyInput('1.234,56'), 1234.56);
  assert.equal(parseMoneyInput('R$ 1.234,56'), 1234.56);
  assert.equal(parseMoneyInput('1.234'), 1234);
  assert.equal(parseMoneyInput('1.234,foo'), null);
  assert.equal(parseMoneyInput(''), null);
  assert.equal(moneyOr('not-a-number', 0), 0);
});

test('catalog and material forms validate localized prices before persistence', () => {
  assert.match(productDialog, /parseMoneyInput\(value\) == null/);
  assert.match(productDialog, /inputMode="decimal"/);
  assert.match(productsService, /price: monetaryField\(data\.price/);
  assert.match(productionPage, /parseMoneyInput\(material\.cost_price\) == null/);
  assert.match(productionPage, /Salvar e adicionar/);
});
