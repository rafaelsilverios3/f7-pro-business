import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapVerifiedCreditStatus,
  releaseBillingWebhookForRetry,
  resolveVerifiedBillingPurchase,
} from '../supabase/functions/_shared/billingPurchaseRouting.js';

const PLAN_REFERENCE = '11111111-1111-4111-8111-111111111111';
const CREDIT_REFERENCE = '22222222-2222-4222-8222-222222222222';

test('plan checkout UUID is classified by its persisted provider row and never calls AI Credits RPC', async () => {
  let creditRpcCalls = 0;
  const route = await resolveVerifiedBillingPurchase({
    externalReference: PLAN_REFERENCE,
    findPlanCheckout: async (id) => ({ data: { id, provider: 'mercado_pago' }, error: null }),
    settleAICreditPurchase: async () => { creditRpcCalls++; throw new Error('must not call optional AI Credits schema'); },
  });
  assert.deepEqual(route, { kind: 'plan', checkoutId: PLAN_REFERENCE });
  assert.equal(creditRpcCalls, 0);
});

test('credit-package UUID is classified by the persisted AI purchase settlement result', async () => {
  let receivedReference;
  const route = await resolveVerifiedBillingPurchase({
    externalReference: CREDIT_REFERENCE,
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async (id) => {
      receivedReference = id;
      return { data: { code: 'OK', status: 'approved', credited: true, duplicate: false }, error: null };
    },
  });
  assert.equal(receivedReference, CREDIT_REFERENCE);
  assert.deepEqual(route, { kind: 'ai_credits', settlement: { code: 'OK', status: 'approved', credited: true, duplicate: false } });
});

test('unknown UUID reference remains pending when neither product has a persisted record', async () => {
  const route = await resolveVerifiedBillingPurchase({
    externalReference: CREDIT_REFERENCE,
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async () => ({ data: { code: 'AI_CREDIT_PURCHASE_NOT_FOUND' }, error: null }),
  });
  assert.deepEqual(route, { kind: 'pending', reason: 'PURCHASE_REFERENCE_UNKNOWN' });
});

test('plan settles in a schema without AI Credits; unknown UUID fails closed if that schema is absent', async () => {
  const plan = await resolveVerifiedBillingPurchase({
    externalReference: PLAN_REFERENCE,
    findPlanCheckout: async (id) => ({ data: { id, provider: 'mercado_pago' }, error: null }),
    settleAICreditPurchase: async () => ({ error: { code: 'PGRST202' } }),
  });
  assert.equal(plan.kind, 'plan');

  const unknown = await resolveVerifiedBillingPurchase({
    externalReference: CREDIT_REFERENCE,
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async () => ({ error: { code: 'PGRST202' } }),
  });
  assert.deepEqual(unknown, { kind: 'retryable', reason: 'AI_CREDITS_SCHEMA_UNAVAILABLE' });
});

test('duplicate webhook settlement preserves the RPC idempotency result', async () => {
  let calls = 0;
  const resolve = () => resolveVerifiedBillingPurchase({
    externalReference: CREDIT_REFERENCE,
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async () => {
      calls++;
      return { data: { code: 'OK', status: 'approved', credited: calls === 1, duplicate: calls > 1 }, error: null };
    },
  });
  const first = await resolve();
  const duplicate = await resolve();
  assert.equal(first.settlement.credited, true);
  assert.equal(duplicate.settlement.credited, false);
  assert.equal(duplicate.settlement.duplicate, true);
  assert.equal(calls, 2);
});

test('pending, approved, and refunded provider outcomes map to bounded credit settlement states', () => {
  assert.equal(mapVerifiedCreditStatus('pending', false), 'pending');
  assert.equal(mapVerifiedCreditStatus('approved', true), 'approved');
  assert.equal(mapVerifiedCreditStatus('refunded', false), 'refunded');
  assert.equal(mapVerifiedCreditStatus('charged_back', false), 'refunded');
});

test('inconsistent settlement and RPC failure retain a retryable event without marking it processed', async () => {
  const inconsistent = await resolveVerifiedBillingPurchase({
    externalReference: CREDIT_REFERENCE,
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async () => ({ data: { code: 'AI_CREDIT_PURCHASE_AMOUNT_MISMATCH' }, error: null }),
  });
  assert.equal(inconsistent.kind, 'retryable');

  const failedRpc = await resolveVerifiedBillingPurchase({
    externalReference: CREDIT_REFERENCE,
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async () => ({ error: { code: '57014' } }),
  });
  assert.equal(failedRpc.kind, 'retryable');

  let eventUpdate;
  const released = await releaseBillingWebhookForRetry(async (update) => {
    eventUpdate = update;
    return true;
  }, failedRpc.reason);
  assert.equal(released, true);
  assert.equal(eventUpdate.status, 'received');
  assert.equal(eventUpdate.processed, false);
  assert.equal(eventUpdate.processed_at, null);
  assert.equal(eventUpdate.error_message, 'AI_CREDIT_SETTLEMENT_RETRYABLE');
});

test('non-UUID references are resolved from trusted plan rows first and otherwise remain pending', async () => {
  const plan = await resolveVerifiedBillingPurchase({
    externalReference: 'legacy-provider-reference',
    findPlanCheckout: async () => ({ data: { id: PLAN_REFERENCE, provider: 'mercado_pago' }, error: null }),
    settleAICreditPurchase: async () => { throw new Error('credit RPC accepts UUID references only'); },
  });
  assert.equal(plan.kind, 'plan');

  const unknown = await resolveVerifiedBillingPurchase({
    externalReference: 'unlinked-provider-reference',
    findPlanCheckout: async () => ({ data: null, error: null }),
    settleAICreditPurchase: async () => { throw new Error('must not call credit RPC for non-UUID reference'); },
  });
  assert.deepEqual(unknown, { kind: 'pending', reason: 'PURCHASE_REFERENCE_UNKNOWN' });
});

test('missing external reference can still resolve a plan through persisted provider order/payment links', async () => {
  const route = await resolveVerifiedBillingPurchase({
    externalReference: '',
    findPlanCheckout: async (reference) => {
      assert.equal(reference, '');
      // In the webhook this lookup closure searches the verified provider order
      // and payment IDs even when the external_reference field is absent.
      return { data: { id: PLAN_REFERENCE, provider: 'mercado_pago' }, error: null };
    },
    settleAICreditPurchase: async () => { throw new Error('empty reference must not reach AI settlement'); },
  });
  assert.equal(route.kind, 'plan');
  assert.equal(route.checkoutId, PLAN_REFERENCE);
});
