import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const layout = fs.readFileSync('src/components/layout/Layout.jsx', 'utf8');
const subscriptions = fs.readFileSync('src/services/subscriptionService.js', 'utf8');

test('subscription header reuses the tenant subscription and exposes plans without checkout', () => {
  assert.match(layout, /function SubscriptionSummary/);
  assert.match(layout, /subscription\?\.plan/);
  assert.match(layout, /trialActive\(subscription\)/);
  assert.match(layout, /trialExpired\(subscription\)/);
  assert.match(layout, /trialHoursRemaining\(subscription\)/);
  assert.match(layout, /<Link to="\/planos"/);
  assert.doesNotMatch(layout, /SubscriptionSummary[\s\S]*checkout/);
  assert.match(layout, /<SubscriptionSummary subscription=\{subscription\} loading=\{subscriptionLoading\}/);
  assert.match(subscriptions, /rpc\('get_current_subscription'/);
});

test('subscription header keeps neutral states instead of inventing a plan', () => {
  assert.match(layout, /Sem plano ativo/);
  assert.match(layout, /Teste grátis/);
  assert.match(layout, /Teste encerrado/);
  assert.match(layout, /Carregando plano atual/);
});
