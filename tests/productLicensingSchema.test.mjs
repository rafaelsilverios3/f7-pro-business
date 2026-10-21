import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261022100000_f7_product_catalog_and_licenses.sql', import.meta.url), 'utf8');

test('product licenses are scoped by company and product without replacing legacy subscriptions', () => {
  assert.match(migration, /unique\s*\(company_id,\s*product_key\)/i);
  assert.match(migration, /create table if not exists public\.company_product_licenses/i);
  assert.doesNotMatch(migration, /alter table public\.company_subscriptions/i);
  assert.doesNotMatch(migration, /update public\.company_subscriptions/i);
  assert.doesNotMatch(migration, /create or replace function public\.company_has_feature/i);
});

test('catalog keeps unconfigured product prices nullable and does not seed invented offers', () => {
  assert.match(migration, /price_minor bigint check \(price_minor is null or price_minor >= 0\)/i);
  assert.match(migration, /insert into public\.product_catalog/i);
  assert.doesNotMatch(migration, /insert into public\.product_offers/i);
});

test('cross-system linkage requires both proofs and cannot be written by client roles', () => {
  assert.match(migration, /pro_verified_at is not null and food_verified_at is not null and verified_at is not null/i);
  assert.match(migration, /revoke all on public\.product_catalog[\s\S]*?product_tenant_link_challenges from public, anon, authenticated/i);
  assert.match(migration, /No client policies or grants are defined for cross-system proof challenges/i);
});
