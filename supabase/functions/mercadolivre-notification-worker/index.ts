import { admin, corsHeaders, json } from '../_shared/core.ts';
import { meliNotificationProcessingEnabled } from '../_shared/schedulerPolicy.js';
import { accessMercadoLivreToken } from '../_shared/mercadolivreTokens.ts';
import { processClaimedMeliNotifications, type MeliNotificationConnection } from '../_shared/mercadolivreNotificationProcessor.ts';
import { MELI_NOTIFICATION_MAX_BATCH } from '../_shared/mercadolivreQueuePolicy.js';
import { waitUntilEdgeTask } from '../_shared/edgeRuntime.ts';
import { hasInternalServiceAuthorization } from '../_shared/mercadolivreWorkerAuth.ts';

export async function handleMercadoLivreNotificationWorker(req: Request, dependencies: {
  adminClient?: ReturnType<typeof import('../_shared/core.ts').admin>;
  resolveToken?: (companyId: string, connection: MeliNotificationConnection) => Promise<string>;
} = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!hasInternalServiceAuthorization(req, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')) return json({ code: 'FORBIDDEN' }, 403);
  if (!meliNotificationProcessingEnabled({ F7_MELI_QUEUE_PROCESSING_ENABLED: Deno.env.get('F7_MELI_QUEUE_PROCESSING_ENABLED') })) {
    return json({ code: 'MELI_QUEUE_PROCESSING_DISABLED', status: 'disabled' }, 200);
  }
  const length = Number(req.headers.get('content-length') || '0');
  if (length > 2048) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413);
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ code: 'INVALID_PAYLOAD' }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return json({ code: 'INVALID_PAYLOAD' }, 400); }
  if (body.company_id !== undefined || body.connection_id !== undefined) {
    // Only internal callers are accepted. Optional tenant scoping exists for
    // operator recovery through the authenticated management API, not here.
    return json({ code: 'INVALID_PAYLOAD' }, 400);
  }
  const requestedLimit = body.limit === undefined ? 10 : Number(body.limit);
  const remainingBatches = body.remaining_batches === undefined ? 0 : Number(body.remaining_batches);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MELI_NOTIFICATION_MAX_BATCH) {
    return json({ code: 'INVALID_PAYLOAD' }, 400);
  }
  if (!Number.isSafeInteger(remainingBatches) || remainingBatches < 0 || remainingBatches > 2) return json({ code: 'INVALID_PAYLOAD' }, 400);

  const sb = dependencies.adminClient || admin();
  const claimToken = crypto.randomUUID();
  const { data: events, error: claimError } = await sb.rpc('meli_claim_notification_batch', {
    p_claim_token: claimToken, p_limit: requestedLimit, p_company_id: null, p_connection_id: null,
  });
  if (claimError) return json({ code: 'MELI_NOTIFICATION_QUEUE_UNAVAILABLE' }, 503);

  const result = await processClaimedMeliNotifications(sb, events || [], {
    loadConnection: async (companyId, connectionId) => {
      const { data, error } = await sb.from('meli_connections').select('*')
        .eq('company_id', companyId).eq('id', connectionId).maybeSingle();
      if (error) throw new Error('MELI_CONNECTION_LOOKUP_FAILED');
      return data as MeliNotificationConnection | null;
    },
    resolveToken: dependencies.resolveToken || ((companyId, connection) => accessMercadoLivreToken(sb, companyId, connection)),
    settle: async (event, outcome, errorCode) => {
      const { data, error } = await sb.rpc('meli_finish_notification_event', {
        p_company_id: event.company_id, p_event_id: event.id, p_claim_token: claimToken,
        p_outcome: outcome, p_error_code: errorCode,
      });
      if (error) return false;
      return data === true;
    },
  });
  if (result.claimed === requestedLimit && remainingBatches > 0) {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (url && serviceKey) {
      const nextBatch = fetch(`${url}/functions/v1/mercadolivre-notification-worker`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: requestedLimit, remaining_batches: remainingBatches - 1, trigger: 'drain' }),
      }).then(() => undefined).catch(() => undefined);
      waitUntilEdgeTask(nextBatch);
    }
  }
  // Per-event attempt records are the audit trail; do not create a global log
  // row that could expose cross-tenant operational metadata.
  return json({ code: 'OK', ...result });
}

if (import.meta.main) Deno.serve((req) => handleMercadoLivreNotificationWorker(req));
