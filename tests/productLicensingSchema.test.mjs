import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261022100000_f7_product_catalog_and_licenses.sql', import.meta.url), 'utf8');

test('commercial accounts are independent from app tenants and licenses are product scoped', () => {
  assert.match(migration, /create table if not exists public\.commercial_accounts/i);
  assert.match(migration, /commercial_account_id uuid not null references public\.commercial_accounts/i);
  assert.match(migration, /unique\s*\(commercial_account_id,\s*product_key\)/i);
  assert.match(migration, /pro_company_id uuid references public\.companies\(id\)/i);
  assert.match(migration, /food_company_id uuid/i);
  assert.doesNotMatch(migration, /company_product_licenses/);
  assert.doesNotMatch(migration, /alter table public\.company_subscriptions/i);
  assert.doesNotMatch(migration, /update public\.company_subscriptions/i);
  assert.doesNotMatch(migration, /create or replace function public\.company_has_feature/i);
});

test('catalog keeps unconfigured product prices nullable and does not seed invented offers', () => {
  assert.match(migration, /price_minor bigint check \(price_minor is null or price_minor >= 0\)/i);
  assert.match(migration, /insert into public\.product_catalog/i);
  const offerWriter = migration.indexOf('create or replace function public.product_platform_admin_set_offer');
  assert.ok(offerWriter > 0);
  assert.doesNotMatch(migration.slice(0, offerWriter), /insert into public\.product_offers/i);
});

test('cross-system linkage requires both proofs and cannot be written by client roles', () => {
  assert.match(migration, /pro_verified_at is not null and food_verified_at is not null and verified_at is not null/i);
  assert.match(migration, /product_tenant_link_challenges[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /backend-only/i);
});

test('checkout is separate, idempotent, and product subscriptions require trusted webhook confirmation', () => {
  assert.match(migration, /product_checkout_sessions/);
  assert.match(migration, /unique\(commercial_account_id,idempotency_key\)/i);
  assert.match(migration, /product_checkout_webhook_events/);
  assert.match(migration, /confirm_product_checkout_payment/);
  assert.match(migration, /request\.jwt\.claim\.role',true\)<>\x27service_role\x27/i);
  assert.match(migration, /live_charges_enabled boolean not null default false/i);
});
