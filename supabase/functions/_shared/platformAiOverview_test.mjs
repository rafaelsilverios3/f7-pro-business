import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompanyAiOverview } from './platformAiOverview.js';

const activePro = { plan: 'pro', status: 'active', current_period_end: '2027-01-01T00:00:00.000Z' };

test('reports plan inclusion separately from missing company assistant configuration', () => {
  const result = getCompanyAiOverview({ subscription: activePro, planCode: 'pro', assistantSettings: null, now: Date.parse('2026-10-19T00:00:00Z') });
  assert.deepEqual(result.included_features, ['ai_sales']);
  assert.deepEqual(result.effective_features, ['ai_sales']);
  assert.equal(result.state, 'pending_configuration');
  assert.equal(result.assistant_configured, false);
});

test('an inactive or expired subscription does not become available through a plan feature or override', () => {
  const result = getCompanyAiOverview({
    subscription: { ...activePro, status: 'past_due' },
    planCode: 'pro',
    planFeatures: [{ feature: 'ai_sales', enabled: true }],
    overrides: [{ feature: 'ai_sales', enabled: true }],
    assistantSettings: { mode: 'assisted' },
    provider: { enabled: true, configured: true },
  });
  assert.deepEqual(result.effective_features, []);
  assert.equal(result.state, 'not_entitled');
});

test('an inactive plan does not appear included or operational even when old feature rows remain enabled', () => {
  const result = getCompanyAiOverview({
    subscription: activePro,
    planCode: 'pro',
    planActive: false,
    planFeatures: [{ feature: 'ai_sales', enabled: true }],
    assistantSettings: { mode: 'assisted' },
    provider: { enabled: true, configured: true },
  });
  assert.deepEqual(result.included_features, []);
  assert.deepEqual(result.effective_features, []);
  assert.equal(result.state, 'not_entitled');
});

test('an explicit feature override is reflected without changing the commercial plan catalog', () => {
  const result = getCompanyAiOverview({
    subscription: activePro,
    planCode: 'pro',
    planFeatures: [{ feature: 'ai_sales', enabled: false }],
    overrides: [{ feature: 'ai_sales', enabled: true }],
    assistantSettings: { mode: 'assisted' },
    provider: { enabled: true, configured: true },
  });
  assert.deepEqual(result.included_features, []);
  assert.deepEqual(result.effective_features, ['ai_sales']);
  assert.equal(result.state, 'assisted_ready');
});

test('manual setup, provider maintenance, and automatic reply remain distinct states', () => {
  const base = { subscription: activePro, planCode: 'pro', planFeatures: [{ feature: 'ai_sales', enabled: true }] };
  assert.equal(getCompanyAiOverview({ ...base, assistantSettings: { mode: 'manual' }, provider: { enabled: true, configured: true } }).state, 'manual');
  assert.equal(getCompanyAiOverview({ ...base, assistantSettings: { mode: 'assisted' }, provider: { enabled: true, configured: true, maintenance: true } }).state, 'maintenance');
  assert.equal(getCompanyAiOverview({ ...base, assistantSettings: { mode: 'automatic', automatic_reply_enabled: true }, provider: { enabled: true, configured: true } }).state, 'automatic_blocked');
});
