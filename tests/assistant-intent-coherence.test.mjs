import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

const result = await build({ entryPoints: [path.resolve('supabase/functions/_shared/assistantIntent.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
const intent = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('orchestrator and decision engine use one canonical intent taxonomy with legacy mapping', () => {
  for (const value of ['parts', 'compatibility', 'product', 'price', 'stock', 'quote', 'customer', 'crm', 'supplier', 'opportunity', 'market_research', 'general_support']) assert.ok(intent.ASSISTANT_INTENTS.includes(value));
  assert.equal(intent.normalizeAssistantIntent('pricing_analysis'), 'price');
  assert.equal(intent.normalizeAssistantIntent('part_research'), 'parts');
  assert.equal(intent.detectAssistantIntent('qual o preço da peça'), 'price');
  assert.equal(intent.detectAssistantIntent('qual o PN do filtro'), 'parts');
});
