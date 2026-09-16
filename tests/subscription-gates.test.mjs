import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FEATURE_REQUIREMENTS } from '../src/lib/subscriptionRequirements.js';
import { FEATURE_PLANS, canUseFeature } from '../src/services/planService.js';
import { resolveSubscriptionGate } from '../src/lib/subscriptionGate.js';

const requirement = (path) => FEATURE_REQUIREMENTS[path];
const gate = (subscription, path, options = {}) => resolveSubscriptionGate({ subscription, requirement: requirement(path), canUse: canUseFeature, ...options });

test('active PRO, BUSINESS and PREMIUM plans use the canonical UI entitlement matrix', () => {
  assert.equal(gate({ plan: 'pro', status: 'active' }, '/ai-sales').state, 'allowed');
  assert.equal(gate({ plan: 'pro', status: 'active' }, '/automacoes').state, 'blocked');
  assert.equal(gate({ plan: 'business', status: 'active' }, '/automacoes').state, 'allowed');
  assert.equal(gate({ plan: 'business', status: 'active' }, '/supplier-intelligence').state, 'blocked');
  assert.equal(gate({ plan: 'premium', status: 'active' }, '/supplier-intelligence').state, 'allowed');
});

test('trial and expired trial keep the existing lifecycle semantics', () => {
  const trial = { plan: 'free', status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z' };
  assert.equal(resolveSubscriptionGate({ subscription: trial, requirement: requirement('/ai-sales'), canUse: canUseFeature }).state, 'blocked');
  assert.match(fs.readFileSync('src/services/subscriptionService.js', 'utf8'), /TRIAL_ALLOWED_PATHS = \[[^\]]*'\/f7probusiness'/);
  assert.equal(gate({ plan: 'free', status: 'expired' }, '/ai-sales').reason, 'subscription_unavailable');
});

test('missing, inactive and cancelled subscriptions never bypass a protected route', () => {
  for (const subscription of [null, undefined, { plan: 'business', status: 'inactive' }, { plan: 'premium', status: 'cancelled' }]) {
    assert.equal(gate(subscription, '/marketing').state, 'blocked');
    assert.equal(gate(subscription, '/marketing').reason, 'subscription_unavailable');
  }
});

test('loading and API error are explicit gate states, not no-subscription fallbacks', () => {
  assert.equal(gate(null, '/intelligence', { loading: true }).state, 'loading');
  assert.equal(gate(null, '/intelligence', { error: new Error('RLS') }).state, 'error');
});

test('Marketing, Intelligence, Reports, Automations and Supplier Intelligence map to existing feature keys', () => {
  assert.deepEqual(requirement('/marketing'), ['BUSINESS', 'Marketing', 'advanced_reports']);
  assert.equal(requirement('/intelligence')[2], 'intelligence');
  assert.equal(requirement('/relatorios')[2], 'advanced_reports');
  assert.equal(requirement('/automacoes')[2], 'automations');
  assert.equal(requirement('/supplier-intelligence')[2], 'supplier_intelligence');
  assert.equal(FEATURE_PLANS.intelligence, 'free');
});

test('UI and server matrix agree for every protected requirement', () => {
  const expected = {
    intelligence: ['free', 'pro', 'business', 'premium'],
    ai_sales: ['pro', 'business', 'premium'],
    automations: ['business', 'premium'],
    atendimento: ['business', 'premium'],
    advanced_reports: ['business', 'premium'],
    opportunity_radar: ['business', 'premium'],
    supplier_intelligence: ['premium'],
  };
  for (const [path, [, , feature]] of Object.entries(FEATURE_REQUIREMENTS)) {
    if (!expected[feature]) continue;
    for (const plan of ['free', 'pro', 'business', 'premium']) {
      assert.equal(canUseFeature(plan, feature), expected[feature].includes(plan), `${path} ${plan}`);
    }
  }
});

test('company switch clears stale subscription and scopes the next read by company id', () => {
  const layout = fs.readFileSync('src/components/layout/Layout.jsx', 'utf8');
  const service = fs.readFileSync('src/services/subscriptionService.js', 'utf8');
  assert.match(layout, /setSubscription\(null\);\s*setSubscriptionError\(null\);\s*setSubscriptionLoading\(true\)/);
  assert.match(layout, /\}, \[company\?\.id, subscriptionRequestKey\]\)/);
  assert.match(service, /rpc\('get_current_subscription'/);
});

test('protected routes fail closed without the legacy active-only bypass', () => {
  const app = fs.readFileSync('src/App.jsx', 'utf8');
  assert.match(app, /resolveSubscriptionGate/);
  assert.doesNotMatch(app, /subscription\?\.status === 'active' && requirement/);
  assert.match(app, /state === 'error'/);
  assert.match(app, /state === 'blocked'/);
});
