const ASSISTANT_FEATURES = ['ai', 'ai_sales'];

const FALLBACK_PLAN_FEATURES = {
  ai: ['premium'],
  ai_sales: ['pro', 'business', 'premium'],
};

function isFeatureEnabled(feature, planCode, planFeatures, overrides) {
  const override = overrides.find((row) => row.feature === feature);
  if (typeof override?.enabled === 'boolean') return override.enabled;

  const configured = planFeatures.find((row) => row.feature === feature);
  if (typeof configured?.enabled === 'boolean') return configured.enabled;

  return (FALLBACK_PLAN_FEATURES[feature] || []).includes(planCode);
}

function subscriptionAllowsFeatures(subscription, now) {
  if (!subscription) return false;
  if (['trial', 'expired', 'cancelled', 'suspended', 'past_due'].includes(subscription.status)) return false;
  if (subscription.status === 'active' && subscription.current_period_end) {
    const end = Date.parse(subscription.current_period_end);
    if (!Number.isFinite(end) || end <= now) return false;
  }
  return true;
}

/**
 * @param {{
 *   subscription?: { plan?: string; status?: string; current_period_end?: string | null } | null,
 *   planCode?: string,
 *   planActive?: boolean,
 *   planFeatures?: Array<{ feature: string; enabled: boolean }>,
 *   overrides?: Array<{ feature: string; enabled: boolean }>,
 *   assistantSettings?: { mode?: string; automatic_reply_enabled?: boolean } | null,
 *   provider?: { enabled?: boolean; configured?: boolean; maintenance?: boolean },
 *   now?: number,
 * }} [options]
 */
export function getCompanyAiOverview({
  subscription,
  planCode = 'free',
  planActive = true,
  planFeatures = [],
  overrides = [],
  assistantSettings = null,
  provider = {},
  now = Date.now(),
} = {}) {
  const includedFeatures = planActive ? ASSISTANT_FEATURES.filter((feature) => {
    const configured = planFeatures.find((row) => row.feature === feature);
    return typeof configured?.enabled === 'boolean'
      ? configured.enabled
      : (FALLBACK_PLAN_FEATURES[feature] || []).includes(planCode);
  }) : [];
  const subscriptionActive = subscriptionAllowsFeatures(subscription, now);
  const effectiveFeatures = planActive && subscriptionActive
    ? ASSISTANT_FEATURES.filter((feature) => isFeatureEnabled(feature, planCode, planFeatures, overrides))
    : [];
  const assistantMode = assistantSettings?.mode || null;
  const providerReady = provider.enabled === true
    && provider.configured === true
    && provider.maintenance !== true;

  let state = 'not_entitled';
  if (effectiveFeatures.length > 0) {
    if (!assistantSettings) state = 'pending_configuration';
    else if (provider.maintenance === true) state = 'maintenance';
    else if (provider.enabled !== true) state = 'provider_disabled';
    else if (provider.configured !== true) state = 'provider_unconfigured';
    else if (assistantMode === 'assisted') state = 'assisted_ready';
    else if (assistantMode === 'automatic' || assistantSettings.automatic_reply_enabled === true) state = 'automatic_blocked';
    else state = 'manual';
  }

  return {
    included_features: includedFeatures,
    effective_features: effectiveFeatures,
    subscription_active: subscriptionActive,
    assistant_configured: Boolean(assistantSettings),
    assistant_mode: assistantMode,
    automatic_reply_configured: assistantSettings?.automatic_reply_enabled === true,
    provider_ready: providerReady,
    state,
  };
}
