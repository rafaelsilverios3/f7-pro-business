export const MELI_NOTIFICATION_MAX_ATTEMPTS = 6;
export const MELI_NOTIFICATION_MAX_BATCH = 20;
export const MELI_NOTIFICATION_MAX_CONCURRENCY = 4;

const permanentFailure = new Set([
  'MELI_RESOURCE_NOT_FOUND', 'MELI_TOKEN_REJECTED', 'MELI_SCOPE_OR_ACCESS_DENIED',
  'MELI_REQUEST_REJECTED', 'MELI_REFRESH_REAUTH_REQUIRED', 'MELI_REFRESH_IDENTITY_MISMATCH',
  'MELI_TOKEN_DECRYPT_FAILED', 'MELI_TOKEN_KEY_INVALID', 'MELI_CONNECTOR_NOT_CONFIGURED',
  'MELI_CONNECTION_NOT_CONNECTED', 'MELI_CONNECTION_MISMATCH', 'MELI_EVENT_TENANT_MISMATCH',
  'MELI_ITEM_ID_INVALID', 'MELI_ORDER_ID_INVALID', 'MELI_LISTING_SELLER_MISMATCH',
  'MELI_NOTIFICATION_RESOURCE_INVALID', 'MELI_PATH_INVALID',
]);

export function safeMeliErrorCode(error) {
  const value = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return /^MELI_[A-Z0-9_]{1,72}$/.test(value) ? value : 'MELI_NOTIFICATION_FAILED';
}

export function classifyMeliNotificationFailure(error, attempts) {
  const code = safeMeliErrorCode(error);
  const permanent = permanentFailure.has(code);
  return {
    code,
    outcome: permanent || Number(attempts) >= MELI_NOTIFICATION_MAX_ATTEMPTS ? 'dead_letter' : 'retry',
  };
}

export function notificationRetryDelayMs(attempts) {
  const count = Math.max(1, Math.min(MELI_NOTIFICATION_MAX_ATTEMPTS, Math.trunc(Number(attempts) || 1)));
  return Math.min(60 * 60_000, 30_000 * (2 ** (count - 1)));
}

export function groupMeliNotificationEvents(events) {
  const groups = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.company_id !== 'string' || typeof event.connection_id !== 'string') continue;
    const key = `${event.company_id}:${event.connection_id}`;
    if (!groups.has(key)) groups.set(key, { companyId: event.company_id, connectionId: event.connection_id, events: [] });
    groups.get(key).events.push(event);
  }
  return [...groups.values()];
}

async function runLimited(items, concurrency, callback) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { await callback(items[index]); } catch { /* isolate item failures */ }
    }
  });
  await Promise.allSettled(workers);
}

/** Injected I/O makes queue behavior regression-testable without provider calls. */
export async function processMeliNotificationBatch(events, dependencies) {
  const groups = groupMeliNotificationEvents(events);
  const totals = { claimed: Array.isArray(events) ? events.length : 0, processed: 0, retried: 0, dead_letter: 0, unavailable: 0, settlement_failures: 0 };
  await runLimited(groups, dependencies.groupConcurrency || 2, async (group) => {
    let connection = null;
    let connectionLookupError = false;
    try { connection = await dependencies.loadConnection(group.companyId, group.connectionId); }
    catch { connectionLookupError = true; }
    if (connectionLookupError) {
      await runLimited(group.events, MELI_NOTIFICATION_MAX_CONCURRENCY, async (event) => {
        try {
          const disposition = classifyMeliNotificationFailure('MELI_CONNECTION_LOOKUP_FAILED', event.attempts);
          const saved = await dependencies.settle(event, disposition.outcome, disposition.code);
          if (saved) totals[disposition.outcome === 'retry' ? 'retried' : 'dead_letter'] += 1; else totals.settlement_failures += 1;
        } catch { totals.settlement_failures += 1; }
      });
      return;
    }
    if (!connection || connection.company_id !== group.companyId || connection.id !== group.connectionId || connection.status !== 'connected') {
      await runLimited(group.events, MELI_NOTIFICATION_MAX_CONCURRENCY, async (event) => {
        try {
          const saved = await dependencies.settle(event, 'dead_letter', 'MELI_CONNECTION_NOT_CONNECTED');
          if (saved) totals.dead_letter += 1; else totals.settlement_failures += 1;
        } catch { totals.settlement_failures += 1; }
      });
      return;
    }

    let token;
    try { token = await dependencies.resolveToken(group.companyId, connection); }
    catch (error) {
      await runLimited(group.events, MELI_NOTIFICATION_MAX_CONCURRENCY, async (event) => {
        try {
          const disposition = classifyMeliNotificationFailure(error, event.attempts);
          const saved = await dependencies.settle(event, disposition.outcome, disposition.code);
          if (saved) totals[disposition.outcome === 'retry' ? 'retried' : 'dead_letter'] += 1; else totals.settlement_failures += 1;
        } catch { totals.settlement_failures += 1; }
      });
      return;
    }

    await runLimited(group.events, dependencies.eventConcurrency || MELI_NOTIFICATION_MAX_CONCURRENCY, async (event) => {
      if (event.company_id !== connection.company_id || event.connection_id !== connection.id) {
        try {
          const saved = await dependencies.settle(event, 'dead_letter', 'MELI_EVENT_TENANT_MISMATCH');
          if (saved) totals.dead_letter += 1; else totals.settlement_failures += 1;
        } catch { totals.settlement_failures += 1; }
        return;
      }
      try {
        await dependencies.processEvent(event, connection, token);
        const saved = await dependencies.settle(event, 'processed', null);
        if (saved) totals.processed += 1; else totals.settlement_failures += 1;
      } catch (error) {
        const disposition = classifyMeliNotificationFailure(error, event.attempts);
        try {
          const saved = await dependencies.settle(event, disposition.outcome, disposition.code);
          if (saved) totals[disposition.outcome === 'retry' ? 'retried' : 'dead_letter'] += 1;
          else totals.settlement_failures += 1;
        } catch { totals.settlement_failures += 1; }
      }
    });
  });
  totals.unavailable = totals.settlement_failures;
  return totals;
}
