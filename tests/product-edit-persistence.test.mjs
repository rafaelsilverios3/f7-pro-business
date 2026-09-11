import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/services/productsService.js', 'utf8');
const repository = fs.readFileSync('src/data/repositoryFactory.js', 'utf8');
const provider = fs.readFileSync('src/data/providers/supabaseProvider.js', 'utf8');
const dialog = fs.readFileSync('src/components/produtos/ProductDialog.jsx', 'utf8');
const page = fs.readFileSync('src/pages/Produtos.jsx', 'utf8');

test('product updates use an explicit canonical payload and preserve zero values', () => {
  for (const field of ['name', 'sku', 'barcode', 'category', 'description', 'material', 'color', 'size', 'model', 'weight', 'stock']) assert.match(service, new RegExp(`['"]?${field}['"]?`));
  for (const field of ['cost', 'price', 'minimum_stock', 'commission_rate']) assert.match(service, new RegExp(field));
  assert.match(service, /value === '' \|\| value == null/);
  assert.doesNotMatch(service, /value \|\| fallback/);
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
