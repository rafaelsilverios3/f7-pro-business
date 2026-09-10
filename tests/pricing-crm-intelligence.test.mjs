import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPricingRecommendation } from '../src/lib/pricing.js';
import { buildCrmIntelligence, CRM_INTELLIGENCE_POLICY } from '../src/lib/crmIntelligence.js';

test('pricing uses configured costs, separates margin and markup, and never changes price automatically', () => {
  const result = buildPricingRecommendation({ purchaseCost: 100, freight: 10, taxPct: 5, commissionPct: 3 }, 180);
  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.notEqual(result.margin, result.markup);
  assert.equal(result.assumptions.length, 0);
  assert.equal(result.policy.automatic_price_change_allowed, false);
  assert.equal(result.policy.automatic_tax_estimation_allowed, false);
});

test('pricing does not invent missing purchase cost', () => {
  const result = buildPricingRecommendation({ taxPct: 5 }, 100);
  assert.equal(result.status, 'NEEDS_CONFIGURATION');
  assert.deepEqual(result.missing_components, ['purchaseCost']);
});

test('CRM identifies company-scoped lead, inactivity, recurrence and upsell context', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const customers = [{ id: 'lead', company_id: 'a', status: 'lead' }, { id: 'repeat', company_id: 'a', status: 'active' }, { id: 'other', company_id: 'b', status: 'lead' }];
  const sales = [{ company_id: 'a', customer_id: 'repeat', status: 'completed', sale_date: '2026-01-01', items: [{ product_id: 'p1' }] }, { company_id: 'a', customer_id: 'repeat', status: 'completed', sale_date: '2026-02-01', items: [{ product_id: 'p2' }] }];
  const signals = buildCrmIntelligence({ companyId: 'a', customers, sales, now });
  assert.deepEqual(new Set(signals.map((item) => item.type)), new Set(['lead', 'inactive_customer', 'recurrence', 'upsell_context']));
  assert.ok(signals.every((item) => item.customer_id !== 'other'));
  assert.equal(CRM_INTELLIGENCE_POLICY.automatic_contact_allowed, false);
  assert.equal(CRM_INTELLIGENCE_POLICY.automatic_sale_allowed, false);
});

test('orchestrator selects pricing and CRM read tools', () => {
  const orchestrator = fs.readFileSync('supabase/functions/_shared/f7AIOrchestrator.ts', 'utf8');
  const tools = fs.readFileSync('supabase/functions/_shared/toolRegistry.ts', 'utf8');
  assert.match(orchestrator, /pricing_analysis/);
  assert.match(orchestrator, /crm_analysis/);
  assert.match(tools, /input\.intent === 'pricing_analysis'/);
  assert.match(tools, /input\.intent === 'crm_analysis'/);
});
