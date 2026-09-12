import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const context = read('src/lib/moduleContext.js');
const radarPage = read('src/pages/OpportunityRadar.jsx');
const radarService = read('src/services/opportunityRadarService.js');
const foundation = read('src/services/opportunityFoundationService.js');
const intelligence = read('src/components/intelligence/IntelligenceConversation.jsx');
const salesPage = read('src/pages/AiSalesAssistant.jsx');
const salesService = read('src/services/aiSalesService.js');
const supplierPage = read('src/pages/SupplierIntelligence.jsx');
const supplierService = read('src/services/supplierIntelligenceService.js');
const intelligenceEdge = read('supabase/functions/intelligence-query/index.ts');
const salesEdge = read('supabase/functions/ai-sales-assistant/index.ts');
const supplierEdge = read('supabase/functions/supplier-intelligence/index.ts');
const detector = read('supabase/functions/_shared/radarDetector.ts');

test('module handoffs carry a bounded common context envelope', () => {
  for (const key of ['source_module', 'opportunity_id', 'product_id', 'customer_id', 'supplier_id', 'entity_type', 'entity_id', 'intent', 'evidence', 'return_path']) assert.match(context, new RegExp(key));
  assert.match(radarPage, /buildModuleContext/);
  assert.match(radarPage, /sourceModule: 'opportunity_radar'/);
  assert.match(intelligence, /routeContext/);
  assert.match(salesPage, /routeContext/);
  assert.match(supplierPage, /routeContext/);
});

test('external Intelligence opportunities use the shared foundation and deduplicate evidence', () => {
  assert.match(intelligence, /opportunityFoundationService\.create/);
  assert.match(intelligence, /dedup_key/);
  assert.match(foundation, /opportunities\.list\(companyId/);
  assert.match(foundation, /mergedEvidence/);
  assert.match(radarService, /radar_state: 'RESOLVIDA'/);
});

test('service and edge handoffs preserve context without widening tenant scope', () => {
  assert.match(salesService, /history, context/);
  assert.match(supplierService, /context: options\.context/);
  assert.match(intelligenceEdge, /sanitizeContext/);
  assert.match(salesEdge, /sanitizeContext/);
  assert.match(supplierEdge, /sanitizeContext/);
  for (const edge of [intelligenceEdge, salesEdge, supplierEdge]) assert.match(edge, /company_id/);
});

test('Radar hides snoozed signals and server detector resolves disappeared conditions', () => {
  assert.match(radarPage, /!item\.radar\?\.snoozed/);
  assert.match(radarService, /detectedKeys/);
  assert.match(detector, /customer:possible_repurchase/);
  assert.match(detector, /radar_state: 'RESOLVIDA'/);
});

test('prompt-injection boundaries and human confirmation remain explicit', () => {
  assert.match(intelligenceEdge, /external_untrusted/);
  assert.match(salesEdge, /tenant_data/);
  assert.match(salesEdge, /confirmed !== true/);
  assert.match(supplierPage, /aprovação humana/);
});
