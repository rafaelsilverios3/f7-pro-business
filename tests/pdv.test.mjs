import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/PDV.jsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0019_pdv.sql', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');

test('PDV uses the transactional sales service and supports keyboard shortcuts', () => {
  assert.match(page, /salesService\.finalize/);
  assert.match(page, /event\.key === 'F10'/);
  assert.match(page, /Estoque insuficiente/);
});

test('PDV calculates discount and change', () => {
  assert.match(page, /discountType === 'percent'/);
  assert.match(page, /const change =/);
  assert.match(page, /payment === 'Dinheiro'/);
});

test('PDV permission is limited to commercial roles', () => {
  const matrix = permissions.match(/export const ROLE_PERMISSIONS = \{([\s\S]*?)\n\};/)[1];
  const roleLine = (role) => matrix.match(new RegExp(`\\n  ${role}: \\[(.*?)\\n`))?.[1] || '';
  assert.match(roleLine('comercial'), /pdv\.use/);
  assert.match(roleLine('vendedor'), /pdv\.use/);
  assert.doesNotMatch(roleLine('financeiro'), /pdv\.use/);
  assert.doesNotMatch(roleLine('estoque'), /pdv\.use/);
  assert.doesNotMatch(roleLine('atendimento'), /pdv\.use/);
});

test('0019 adds barcode and validates stock and product pricing in the database transaction', () => {
  assert.match(migration, /add column if not exists barcode text/i);
  assert.match(migration, /idx_products_company_barcode/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /product_row\.price/i);
  assert.match(migration, /product_row\.cost/i);
  assert.match(migration, /sale\.finalized\.pdv/i);
});
