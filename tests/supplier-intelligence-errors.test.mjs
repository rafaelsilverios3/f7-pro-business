import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySupplierReservationFailure } from '../supabase/functions/_shared/supplierReservationFailure.js';
import { supplierResearchWarning, supplierSearchErrorMessage } from '../src/lib/supplierIntelligenceErrors.js';

test('maps the zero-budget reservation result to an explicit, safe code and HTTP 402', () => {
  assert.deepEqual(classifySupplierReservationFailure('ai_cost_budget_missing'), { code: 'AI_BUDGET_NOT_CONFIGURED', status: 402 });
  assert.match(supplierSearchErrorMessage({ code: 'AI_BUDGET_NOT_CONFIGURED' }), /não tem orçamento diário/i);
});

test('distinguishes budget exhaustion, permission denial, and research limit', () => {
  assert.equal(classifySupplierReservationFailure('daily_ai_cost_exceeded').code, 'AI_BUDGET_INSUFFICIENT');
  assert.equal(classifySupplierReservationFailure('daily_web_queries_exceeded').code, 'WEB_RESEARCH_LIMIT_REACHED');
  assert.match(supplierSearchErrorMessage({ code: 'EXTERNAL_RESEARCH_NOT_ALLOWED' }), /desativada/i);
  assert.match(supplierSearchErrorMessage({ code: 'WEB_RESEARCH_LIMIT_REACHED' }), /limite diário/i);
});

test('distinguishes missing tariff and provider failures from unexpected errors', () => {
  assert.equal(classifySupplierReservationFailure('rate_card_missing_or_ambiguous').code, 'WEB_RESEARCH_RATE_NOT_CONFIGURED');
  assert.match(supplierResearchWarning(['WEB_SEARCH_UNAVAILABLE']), /indisponível/i);
  assert.match(supplierResearchWarning(['WEB_SEARCH_AUTH_ERROR']), /autenticação/i);
  assert.match(supplierResearchWarning(['WEB_SEARCH_RATE_LIMITED']), /cota ou limite/i);
  assert.match(supplierSearchErrorMessage({ code: 'SOMETHING_UNEXPECTED' }), /inesperadamente/i);
});
