import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0021_product_catalog.sql', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');
const pdv = fs.readFileSync('src/pages/PDV.jsx', 'utf8');

test('catalog migration creates rich product, image, attribute and variant structures', () => {
  assert.match(migration, /add column if not exists subcategory/i);
  assert.match(migration, /create table if not exists public\.product_images/i);
  assert.match(migration, /create table if not exists public\.product_variants/i);
  assert.match(migration, /create table if not exists public\.product_attributes/i);
  assert.match(migration, /product-catalog/);
});

test('catalog storage and rows are isolated by company', () => {
  assert.match(migration, /is_company_member\(company_id\)/i);
  assert.match(migration, /foldername\(name\)\)\[1\]::uuid/i);
  assert.match(migration, /current_company_role/);
});

test('permissions expose catalog view and management separately', () => {
  assert.match(permissions, /catalog\.view/);
  assert.match(permissions, /catalog\.manage/);
});

test('PDV renders available variants and sends variant id', () => {
  assert.match(pdv, /listProductVariants/);
  assert.match(pdv, /variant_id/);
  assert.match(pdv, /variant\.stock/);
});
