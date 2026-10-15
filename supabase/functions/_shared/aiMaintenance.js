const ACTIVE_VALUES = new Set(['true']);

/**
 * Maintenance mode is intentionally scoped to AI Edge Functions. An absent
 * setting preserves the current service behavior; malformed values fail closed
 * for these endpoints only.
 */
export function resolveAIMaintenanceMode(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { state: 'inactive', configured: false };
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'false') return { state: 'inactive', configured: true };
  if (ACTIVE_VALUES.has(normalized)) return { state: 'active', configured: true };
  return { state: 'invalid', configured: true };
}

export function aiMaintenanceResponse(value, corsHeaders = {}) {
  const mode = resolveAIMaintenanceMode(value);
  if (mode.state === 'inactive') return null;

  const invalid = mode.state === 'invalid';
  const headers = new Headers(corsHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('retry-after', '60');

  return new Response(JSON.stringify({
    code: invalid ? 'AI_MAINTENANCE_CONFIGURATION_INVALID' : 'AI_MAINTENANCE',
    message: 'Este serviço de inteligência está temporariamente indisponível. Tente novamente em alguns minutos.',
  }), { status: 503, headers });
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'UNKNOWN';
}

/** Log only stable diagnostic codes; never serialize a database/provider error. */
export function reportAIObservabilityFailure(operation, error, logger = console.error) {
  const allowedOperations = new Set(['run_start', 'run_finalize', 'run_event', 'run_stage']);
  const safeOperation = allowedOperations.has(operation) ? operation : 'run_stage';
  try {
    logger(JSON.stringify({ event: 'ai_observability_write_failed', operation: safeOperation, error_code: safeErrorCode(error) }));
  } catch {
    // Diagnostic logging is best-effort and must never change the business result.
  }
}
