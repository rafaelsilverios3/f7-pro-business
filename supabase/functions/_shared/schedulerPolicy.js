const enabled = (value) => String(value || '').trim().toLowerCase() === 'true';

/**
 * Scheduled work is inert by default. The master switch must be explicitly
 * enabled before either automation dispatch or Mercado Livre recovery can run.
 */
export function schedulerPolicy(env) {
  const masterEnabled = enabled(env?.F7_SCHEDULER_ENABLED);
  return {
    enabled: masterEnabled,
    automations: masterEnabled && enabled(env?.F7_AUTOMATION_SCHEDULER_ENABLED),
    meliRecovery: masterEnabled && enabled(env?.F7_MELI_QUEUE_RECOVERY_ENABLED),
  };
}

export function meliNotificationProcessingEnabled(env) {
  return enabled(env?.F7_MELI_QUEUE_PROCESSING_ENABLED);
}
