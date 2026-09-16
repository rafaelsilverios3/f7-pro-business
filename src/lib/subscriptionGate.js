/**
 * Resolve the UI gate from the same subscription and feature matrix used by
 * the server-side entitlement checks. A missing or failed subscription read
 * must never fall through to the protected module.
 */
export function resolveSubscriptionGate({ subscription = null, loading = false, error = null, requirement = null, canUse = () => false } = {}) {
  if (loading) return { state: 'loading' };
  if (error) return { state: 'error' };
  if (!requirement) return { state: 'unprotected' };
  if (!subscription || subscription.status !== 'active') return { state: 'blocked', reason: 'subscription_unavailable' };
  return canUse(subscription.plan, requirement[2])
    ? { state: 'allowed' }
    : { state: 'blocked', reason: 'feature_not_entitled' };
}
