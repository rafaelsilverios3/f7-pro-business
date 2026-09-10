import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const assistant = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const outboxMigration = fs.readFileSync('supabase/migrations/0047_ai_source_disclosure_whatsapp_outbox.sql', 'utf8');

async function loadPolicy() {
  const result = await build({ entryPoints: [path.resolve('supabase/functions/_shared/assistantCapabilities.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const policy = await loadPolicy();

test('disabled price and stock capabilities remove corresponding product fields', () => {
  const product = { id: 'p', name: 'Produto', price: 99, stock: 4 };
  const filtered = policy.filterProductForAssistant(product, { allow_product_lookup: true, allow_price_lookup: false, allow_stock_lookup: false });
  assert.equal(filtered.price, undefined);
  assert.equal(filtered.stock, undefined);
  assert.equal(filtered.name, 'Produto');
});

test('disabled tools are blocked by the central capability policy', () => {
  const tools = ['ProductTool', 'PricingTool', 'StockTool', 'CustomerTool', 'QuoteTool', 'OfficialSourceTool'].map((name) => ({ name }));
  const allowed = policy.filterToolsByCapabilities(tools, { allow_product_lookup: false, allow_price_lookup: false, allow_stock_lookup: false, allow_customer_lookup: false, allow_quote_draft: false, allow_official_sources: false });
  assert.deepEqual(allowed, []);
});

test('external provenance is internal by default and disclosed only by explicit policy', () => {
  const sources = [{ type: 'public_web', domain: 'example.com' }];
  assert.deepEqual(policy.filterSourcesForCustomer(sources, { allow_official_sources: true, allow_external_source_disclosure: false }), []);
  assert.deepEqual(policy.filterSourcesForCustomer(sources, { allow_official_sources: true, allow_external_source_disclosure: true }), sources);
  assert.match(assistant, /SOURCE_DISCLOSURE_POLICY/);
  assert.match(outboxMigration, /allow_external_source_disclosure boolean not null default false/);
});

test('outbox is company-scoped and server-only', () => {
  assert.match(outboxMigration, /unique\(company_id, client_request_id\)/);
  assert.match(outboxMigration, /alter table public\.whatsapp_outbox enable row level security/);
  assert.match(outboxMigration, /revoke all on public\.whatsapp_outbox from anon, authenticated/);
  assert.match(outboxMigration, /grant select, insert, update on public\.whatsapp_outbox to service_role/);
  for (const state of ['pending', 'sending', 'retryable', 'delivery_unknown', 'provider_accepted', 'sent', 'failed']) assert.match(outboxMigration, new RegExp(state));
  assert.match(outboxMigration, /lease_expires_at timestamptz/);
  assert.match(outboxMigration, /provider_call_started_at timestamptz/);
});
