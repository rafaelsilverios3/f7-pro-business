import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveSubscriptionHeaderState } from '../src/lib/subscriptionHeaderState.js';

const now = Date.parse('2026-09-15T12:00:00.000Z');

test('active plans are rendered from the canonical subscription plan', () => {
  for (const plan of ['PRO', 'BUSINESS', 'PREMIUM']) {
    const state = resolveSubscriptionHeaderState({ status: 'active', plan }, { now });
    assert.equal(state.state, 'active');
    assert.equal(state.title, `Plano atual • ${plan}`);
    assert.equal(state.detail, 'Ativo');
  }
});

test('active and expired trials have explicit states', () => {
  const active = resolveSubscriptionHeaderState({ status: 'trial', trial_ends_at: '2026-09-16T12:00:00.000Z' }, { now });
  assert.equal(active.state, 'trial');
  assert.equal(active.title, 'Teste grátis');
  assert.equal(active.detail, '24h restantes');

  const expired = resolveSubscriptionHeaderState({ status: 'trial', trial_ends_at: '2026-09-15T11:59:00.000Z' }, { now });
  assert.equal(expired.state, 'expired');
  assert.equal(expired.title, 'Teste encerrado');
  assert.equal(expired.detail, 'Escolher plano');
});

test('missing subscription is distinct from loading and API error', () => {
  assert.equal(resolveSubscriptionHeaderState(null, { now }).title, 'Sem plano ativo');
  assert.equal(resolveSubscriptionHeaderState(null, { loading: true, now }).state, 'loading');
  const error = resolveSubscriptionHeaderState(null, { error: new Error('RLS'), now });
  assert.equal(error.state, 'error');
  assert.notEqual(error.title, 'Sem plano ativo');
});

test('non-active plans do not masquerade as active plans', () => {
  const pending = resolveSubscriptionHeaderState({ status: 'pending', plan: 'PREMIUM' }, { now });
  assert.equal(pending.state, 'pending');
  assert.equal(pending.title, 'Plano • PREMIUM');
  assert.equal(pending.detail, 'Pendente');
});

test('subscription loading is scoped to the selected company and clears stale state on switch', () => {
  const layout = fs.readFileSync('src/components/layout/Layout.jsx', 'utf8');
  const service = fs.readFileSync('src/services/subscriptionService.js', 'utf8');
  assert.match(layout, /setSubscription\(null\);\s*setSubscriptionError\(null\);\s*setSubscriptionLoading\(true\)/);
  assert.match(layout, /\}, \[company\?\.id, subscriptionRequestKey\]\)/);
  assert.match(service, /\.eq\('company_id', companyId\)/);
  assert.match(layout, /Plano indisponível/);
});
