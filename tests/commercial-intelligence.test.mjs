import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCommercialIntelligenceReport } from '../src/lib/commercialIntelligence.js';

test('commercial intelligence preserves independent scores and company scope', () => {
  const report = buildCommercialIntelligenceReport({
    opportunity: { company_id: 'company-a', title: 'Produto X', opportunity_score: 81, channel_score: 62 },
    market: { company_id: 'company-a', trust_score: 74, opportunity_score: 81, trend: 'crescimento' },
    marketSignals: [{ source: 'Fonte A', source_type: 'official', confidence: 80 }],
    supplier: { company_id: 'company-a', supplier_id: 'supplier-a', supplier_score: 67, trust_score: 71, data_confidence: 75 },
  });
  assert.equal(report.company_id, 'company-a');
  assert.deepEqual(report.scores, { opportunity: 81, supplier: 67, trust: 71, channel: 62, product_confidence: null });
  assert.equal(report.policy.requires_human_approval, true);
});

test('commercial intelligence never authorizes purchase, publication or stock mutation', () => {
  const report = buildCommercialIntelligenceReport({ opportunity: { company_id: 'company-a' } });
  assert.equal(report.policy.automatic_purchase_allowed, false);
  assert.equal(report.policy.automatic_publish_allowed, false);
  assert.equal(report.policy.automatic_stock_change_allowed, false);
  assert.equal(report.status, 'INSUFFICIENT_DATA');
});

test('orchestrator selects read-only supplier, market and opportunity tools', () => {
  const orchestrator = fs.readFileSync('supabase/functions/_shared/f7AIOrchestrator.ts', 'utf8');
  const registry = fs.readFileSync('supabase/functions/_shared/toolRegistry.ts', 'utf8');
  for (const intent of ['supplier_research', 'market_research', 'opportunity_analysis']) assert.match(orchestrator, new RegExp(intent));
  for (const tool of ['SupplierResearchTool', 'MarketResearchTool', 'OpportunityTool']) assert.match(registry, new RegExp(tool));
  assert.match(registry, /readTool\('SupplierResearchTool'/);
});
