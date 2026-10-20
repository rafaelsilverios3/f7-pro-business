import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMaximumAICredits, evaluateAICreditConfirmation } from '../supabase/functions/_shared/aiCreditsPolicy.js';
import { dateTimeLocalToISOString, toDateTimeLocalValue } from '../src/lib/dateTimeLocal.js';

test('AI credit ceiling converts a versioned provider cost and rounds up conservatively', () => {
  // $0.001 provider cost, 1 USD = R$5.00, no extra markup, R$0.01 / credit.
  assert.deepEqual(calculateMaximumAICredits({
    provider_cost_microunits: 1_000,
    fx_brl_micros_per_currency_unit: 5_000_000,
    markup_bps: 10_000,
  }), { allowed: true, max_credits: 1 });
  // Any positive fractional credit rounds up, never down.
  assert.deepEqual(calculateMaximumAICredits({
    provider_cost_microunits: 1,
    fx_brl_micros_per_currency_unit: 5_000_000,
    markup_bps: 10_000,
  }), { allowed: true, max_credits: 1 });
});

test('credit pricing fails closed on missing, negative, unsafe, or excessive inputs', () => {
  for (const input of [
    {},
    { provider_cost_microunits: -1, fx_brl_micros_per_currency_unit: 5_000_000 },
    { provider_cost_microunits: 1, fx_brl_micros_per_currency_unit: 0 },
    { provider_cost_microunits: 1, fx_brl_micros_per_currency_unit: 5_000_000, markup_bps: 9_999 },
    { provider_cost_microunits: Number.MAX_SAFE_INTEGER + 1, fx_brl_micros_per_currency_unit: 5_000_000 },
  ]) assert.equal(calculateMaximumAICredits(input).allowed, false);
});

test('confirmation triggers at the first policy boundary: above 20 credits or above 10% of balance', () => {
  assert.equal(evaluateAICreditConfirmation({ max_credits: 20, monthly_balance: 200, extra_balance: 0 }).confirmation_required, false);
  assert.equal(evaluateAICreditConfirmation({ max_credits: 10, monthly_balance: 100, extra_balance: 0 }).confirmation_required, false);
  assert.equal(evaluateAICreditConfirmation({ max_credits: 11, monthly_balance: 100, extra_balance: 0 }).confirmation_required, true);
  assert.equal(evaluateAICreditConfirmation({ max_credits: 20, monthly_balance: 500, extra_balance: 0 }).confirmation_required, false);
  assert.equal(evaluateAICreditConfirmation({ max_credits: 21, monthly_balance: 500, extra_balance: 0 }).confirmation_required, true);
});

test('confirmation response reports only backend-derived ceiling and balance projection', () => {
  assert.deepEqual(evaluateAICreditConfirmation({ max_credits: 13, monthly_balance: 80, extra_balance: 40 }), {
    allowed: true,
    confirmation_required: true,
    max_credits: 13,
    balance: 120,
    minimum_balance_after: 107,
    confirmation_threshold: 12,
  });
  assert.deepEqual(evaluateAICreditConfirmation({ max_credits: 21, monthly_balance: 10, extra_balance: 5 }), {
    allowed: false, reason: 'AI_CREDITS_INSUFFICIENT', balance: 15,
  });
});

test('confirmation policy rejects client-controlled invalid balances and thresholds', () => {
  for (const input of [
    { max_credits: -1, monthly_balance: 20, extra_balance: 0 },
    { max_credits: 1, monthly_balance: 1.5, extra_balance: 0 },
    { max_credits: 1, monthly_balance: 1, extra_balance: 0, threshold_credits: -1 },
    { max_credits: 1, monthly_balance: 1, extra_balance: 0, balance_percent_bps: 10_001 },
  ]) assert.equal(evaluateAICreditConfirmation(input).allowed, false);
});

test('datetime-local serialization preserves the browser-local wall time and rejects invalid values', () => {
  const date = new Date('2026-10-19T16:30:00.000Z');
  const local = toDateTimeLocalValue(date);
  assert.equal(new Date(local).toISOString(), date.toISOString());
  assert.equal(dateTimeLocalToISOString(local), date.toISOString());
  assert.throws(() => dateTimeLocalToISOString(''), /AI_FINANCIAL_CONFIG_INVALID/);
});
