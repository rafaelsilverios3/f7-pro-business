import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/services/executiveIntelligenceService.js', 'utf8');
const component = fs.readFileSync('src/components/dashboard/ExecutiveIntelligenceSummary.jsx', 'utf8');
const dashboard = fs.readFileSync('src/pages/Dashboard.jsx', 'utf8');
const edge = fs.readFileSync('supabase/functions/intelligence-query/index.ts', 'utf8');

test('executive context reuses dashboard metrics and keeps bounded factual signals', () => {
  assert.match(service, /buildExecutiveIntelligenceContext/);
  for (const field of ['sales', 'customers', 'products', 'stock', 'finance', 'opportunities', 'signals']) assert.match(service, new RegExp(`\\b${field}\\b`));
  assert.match(service, /MAX_SIGNALS = 12/);
  assert.match(service, /MAX_ITEMS = 3/);
  assert.doesNotMatch(service, /email|phone|cpf|cnpj|credential/i);
});

test('summary is factual-first, has evidence and fails closed without data', () => {
  assert.match(service, /hasExecutiveEvidence/);
  assert.match(service, /Ainda não há dados suficientes/);
  assert.match(service, /evidence_type/);
  assert.match(service, /fallback_used/);
  assert.match(service, /Não infere causas|não infere causas/);
});

test('dashboard summary is asynchronous, period-aware and entitlement-aware', () => {
  assert.match(dashboard, /generateExecutiveSummary/);
  assert.match(dashboard, /canUseFeature\(subscription\?\.plan/);
  assert.match(dashboard, /executiveSummaryRequest/);
  assert.match(component, /F7 Intelligence — Resumo Executivo/);
  assert.match(component, /Atualizar análise/);
  assert.match(component, /Aprofundar análise/);
});

test('server executive operation reuses membership, gate, strict output and tenant-safe context', () => {
  assert.match(edge, /operation === 'executive_summary'/);
  assert.match(edge, /eq\('company_id', companyId\)\.eq\('user_id', userData\.user\.id\)/);
  assert.match(edge, /company_has_feature.*intelligence/);
  assert.match(edge, /sanitizeExecutiveContext\(body\?\.executive_context, companyId\)/);
  assert.match(edge, /EXECUTIVE_RESPONSE_FORMAT/);
  assert.match(edge, /json_schema/);
  assert.match(edge, /modelRouter\.generateStructured\('openai_compatible', \{ operation: 'executive_summary'/);
  assert.match(edge, /FunctionModelProvider\('openai_compatible'/);
  assert.match(edge, /company_id: authorizedCompanyId/);
  assert.doesNotMatch(edge, /conductWebResearch\(.*executive/);
});

test('executive observability distinguishes request, generation and fallback stages', () => {
  for (const stage of ['EXECUTIVE_SUMMARY_REQUESTED', 'EXECUTIVE_CONTEXT_READY', 'EXECUTIVE_GENERATION_STARTED', 'EXECUTIVE_GENERATION_COMPLETED', 'EXECUTIVE_FALLBACK_USED', 'EXECUTIVE_SUMMARY_FAILED']) assert.match(edge, new RegExp(stage));
});
