const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mapVerifiedCreditStatus(normalizedStatus, activationEligible) {
  if (activationEligible) return 'approved';
  if (['refunded', 'charged_back'].includes(String(normalizedStatus || '').toLowerCase())) return 'refunded';
  if (['rejected', 'cancelled'].includes(String(normalizedStatus || '').toLowerCase())) return String(normalizedStatus).toLowerCase();
  return 'pending';
}

/**
 * Resolve a verified provider payment against persisted product records.
 * Plan checkout records are checked first so the plan-only production schema
 * never needs AI Credits tables or RPCs. The AI settlement RPC is the
 * authoritative persisted-record check for credit purchases and performs the
 * financial settlement atomically.
 */
export async function resolveVerifiedBillingPurchase({
  externalReference,
  findPlanCheckout,
  settleAICreditPurchase,
}) {
  const reference = typeof externalReference === 'string' ? externalReference.trim() : '';

  let planLookup;
  try {
    planLookup = await findPlanCheckout(reference);
  } catch {
    return { kind: 'retryable', reason: 'PLAN_REFERENCE_LOOKUP_FAILED' };
  }
  if (planLookup?.error) return { kind: 'retryable', reason: 'PLAN_REFERENCE_LOOKUP_FAILED' };
  if (planLookup?.data?.provider === 'mercado_pago') {
    return { kind: 'plan', checkoutId: planLookup.data.id };
  }
  // AI Credits settlement takes a UUID and resolves that ID against its own
  // persisted purchase session. Do not infer the product type from UUID shape.
  if (!UUID.test(reference)) return { kind: 'pending', reason: 'PURCHASE_REFERENCE_UNKNOWN' };

  let creditSettlement;
  try {
    creditSettlement = await settleAICreditPurchase(reference);
  } catch {
    return { kind: 'retryable', reason: 'AI_CREDIT_SETTLEMENT_RETRYABLE' };
  }
  if (creditSettlement?.error) {
    return {
      kind: 'retryable',
      reason: ['PGRST202', '42883', '42P01'].includes(String(creditSettlement.error.code || ''))
        ? 'AI_CREDITS_SCHEMA_UNAVAILABLE'
        : 'AI_CREDIT_SETTLEMENT_RETRYABLE',
    };
  }

  const result = creditSettlement?.data;
  if (result?.code === 'AI_CREDIT_PURCHASE_NOT_FOUND') {
    return { kind: 'pending', reason: 'PURCHASE_REFERENCE_UNKNOWN' };
  }
  if (result?.code !== 'OK') {
    return { kind: 'retryable', reason: 'AI_CREDIT_SETTLEMENT_INCONSISTENT' };
  }
  return { kind: 'ai_credits', settlement: result };
}

/** Release the event lease without marking it processed after a retryable or
 * unknown settlement. The provider can redeliver it and operators can inspect
 * the persisted reason; no financial event is silently discarded. */
export async function releaseBillingWebhookForRetry(updateEvent, reason) {
  try {
    return await updateEvent({
      status: 'received',
      processed: false,
      processed_at: null,
      error_message: reason,
    });
  } catch {
    return false;
  }
}
