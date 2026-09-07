import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateChannelScore, CHANNEL_TYPES } from '../src/lib/channelScoring.js';
const migration = fs.readFileSync(new URL('../supabase/migrations/0027_sales_hub.sql', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
test('Channel Score exige métricas suficientes', () => { assert.equal(calculateChannelScore({ orders: 80 }), null); assert.equal(calculateChannelScore({ orders: 80, conversion: 60 }), 70); });
test('canais suportados não simulam integrações', () => { assert.ok(CHANNEL_TYPES.includes('marketplace')); assert.ok(CHANNEL_TYPES.includes('whatsapp')); assert.match(migration, /connected boolean not null default false/); });
test('produto por canal e métricas são isolados por empresa', () => { assert.match(migration, /product_channel_links/); assert.match(migration, /channel_metrics/); assert.match(migration, /current_company_role\(company_id\)/); });
test('migration usa somente FKs compostas e checks idempotentes', () => {
  assert.doesNotMatch(migration, /product_id uuid not null references public\.products\(id\)/);
  assert.doesNotMatch(migration, /channel_id uuid not null references public\.sales_channels\(id\)/);
  assert.doesNotMatch(migration, /product_id uuid references public\.products\(id\)/);
  assert.match(migration, /product_channel_links_company_product_fk/);
  assert.match(migration, /product_channel_links_company_channel_fk/);
  assert.match(migration, /channel_metrics_company_channel_fk/);
  assert.match(migration, /channel_metrics_company_product_fk/);
  assert.match(migration, /channel_metrics \(id uuid[^;]+channel_id uuid not null, product_id uuid,/);
  for (const constraint of [
    'channel_metrics_nonnegative_check',
    'product_channel_links_price_check',
    'product_channel_links_fee_rate_check',
    'channel_metrics_conversion_check',
    'channel_metrics_period_check',
    'sales_channels_connected_status_check'
  ]) {
    assert.match(migration, new RegExp(`drop constraint if exists ${constraint}`));
  }
  assert.match(migration, /visits,0\) >= 0/);
  assert.match(migration, /price is null or price >= 0/);
  assert.match(migration, /fee_rate is null or fee_rate between 0 and 100/);
  assert.match(migration, /conversion is null or conversion between 0 and 100/);
  assert.match(migration, /period_end >= period_start/);
  assert.match(migration, /connected and status = 'connected'/);
  assert.match(migration, /not connected and status <> 'connected'/);
});
test('permissões do Sales Hub são separadas', () => { assert.match(permissions, /sales_channels\.view/); assert.match(permissions, /sales_channels\.manage/); assert.match(permissions, /vendedor:[^\n]+sales_channels\.view/); });
