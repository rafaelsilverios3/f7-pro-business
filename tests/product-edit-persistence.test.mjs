import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/services/productsService.js', 'utf8');
const repository = fs.readFileSync('src/data/repositoryFactory.js', 'utf8');
const provider = fs.readFileSync('src/data/providers/supabaseProvider.js', 'utf8');
const dialog = fs.readFileSync('src/components/produtos/ProductDialog.jsx', 'utf8');
const page = fs.readFileSync('src/pages/Produtos.jsx', 'utf8');
const productSchemaSql = [
  fs.readFileSync('supabase/migrations/0001_initial_schema.sql', 'utf8'),
  fs.readFileSync('supabase/migrations/0021_product_catalog.sql', 'utf8'),
].join('\n');

test('product updates use an explicit canonical payload and preserve zero values', () => {
  for (const field of ['name', 'sku', 'barcode', 'category', 'description', 'material', 'color', 'size', 'model', 'weight', 'stock']) assert.match(service, new RegExp(`['"]?${field}['"]?`));
  for (const field of ['cost', 'price', 'minimum_stock', 'commission_rate']) assert.match(service, new RegExp(field));
  assert.match(service, /value === '' \|\| value == null/);
  assert.doesNotMatch(service, /value \|\| fallback/);
  assert.doesNotMatch(service, /textFields = \[[^\]]*['"]category['"]/);
  assert.match(service, /payload\.subcategory = data\.category/);
  assert.doesNotMatch(provider, /Product: \[[^\]]*['"]category['"]/);
});

test('product update regression preserves price, description and zero stock without category', () => {
  const payload = { company_id: 'company-1', name: 'Produto', category: 'Filtros', subcategory: '', price: 120, description: 'teste', stock: 0, commission_rate: 5 };
  const fields = ['company_id', 'name', 'subcategory', 'price', 'description', 'stock', 'commission_rate'];
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'category'), true);
  assert.deepEqual(Object.keys(payload).filter((key) => fields.includes(key)).sort(), fields.slice().sort());
  assert.equal(payload.stock, 0);
  assert.equal(payload.price, 120);
  assert.equal(payload.description, 'teste');
});

test('product update allowlist matches real products columns and excludes category', () => {
  const match = provider.match(/Product: \[([^\]]+)\]/);
  assert.ok(match, 'Product provider allowlist must exist');
  const allowedColumns = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, column]) => column);
  const expectedColumns = ['company_id', 'name', 'sku', 'barcode', 'subcategory', 'brand', 'description', 'short_description', 'full_description', 'material', 'color', 'size', 'model', 'weight', 'dimensions', 'tags', 'keywords', 'featured', 'unit', 'commission_rate', 'cost', 'price', 'stock', 'minimum_stock', 'active'];
  assert.deepEqual(allowedColumns, expectedColumns);
  assert.equal(allowedColumns.includes('category'), false);
  for (const column of expectedColumns) assert.match(productSchemaSql, new RegExp(`\\b${column}\\b`));
});

test('product update is tenant scoped and records only stock differences', () => {
  assert.match(repository, /entity\(entityName\)\.update\(current\.id, \{ \.\.\.safeData, company_id: companyId \}\)/);
  assert.match(provider, /query = query\.eq\('company_id', payload\.company_id\)/);
  assert.match(service, /Number\(payload\.stock\) !== Number\(current\.stock\)/);
  assert.match(service, /type: 'adjust'/);
  assert.match(service, /quantity: Number\(payload\.stock\) - Number\(current\.stock/);
});

test('product dialog keeps the modal open on save errors and prevents duplicate saves', () => {
  assert.match(dialog, /Não foi possível salvar as alterações do produto/);
  assert.match(dialog, /migration 0021 do catálogo de produtos/);
  assert.match(dialog, /Você não tem permissão para alterar produtos/);
  assert.match(dialog, /Salvando\.\.\./);
  assert.match(dialog, /disabled=\{saving\}/);
  assert.match(dialog, /await onSave/);
  assert.match(dialog, /onClose\(\)/);
  assert.match(page, /await load\(\)/);
});
