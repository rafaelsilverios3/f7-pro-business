import { admin, auth, json } from './core.ts';

const encoder = new TextEncoder();
function hex(bytes: Uint8Array) { return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(''); }
async function sign(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const service = admin();
    const jwt = auth(req);
    let jwtRole = '';
    try { jwtRole = JSON.parse(atob(jwt.split('.')[1])).role || ''; } catch { return json({ error: 'AUTH_REQUIRED' }, 401); }
    const isService = jwtRole === 'service_role';
    let actorId: string | null = null;
    if (!isService) {
      const identity = await service.auth.getUser(jwt);
      if (identity.error || !identity.data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
      actorId = identity.data.user.id;
      const adminRow = await service.from('platform_admins').select('role,status,expires_at')
        .eq('user_id', actorId).eq('status', 'active').maybeSingle();
      if (adminRow.error) throw adminRow.error;
      if (!adminRow.data || !['owner', 'admin'].includes(adminRow.data.role)
        || (adminRow.data.expires_at && Date.parse(adminRow.data.expires_at) <= Date.now())) {
        return json({ error: 'PLATFORM_ADMIN_REQUIRED' }, 403);
      }
    }
    const endpoint = Deno.env.get('F7_FOOD_LICENSE_SYNC_URL');
    const secret = Deno.env.get('F7_COMMERCE_SYNC_SECRET');
    if (!endpoint || !secret || secret.length < 32) return json({ error: 'FOOD_SYNC_NOT_CONFIGURED' }, 503);
    const input = await req.json().catch(() => ({}));
    const requestedId = typeof input.outbox_id === 'string' ? input.outbox_id : null;
    if (input.action === 'requeue' && requestedId && !isService) {
      const before = await service.from('product_license_delivery_outbox').select('id,status,attempts').eq('id', requestedId).maybeSingle();
      if (before.error) throw before.error;
      if (!before.data) return json({ error: 'OUTBOX_EVENT_NOT_FOUND' }, 404);
      if (!['blocked', 'retry'].includes(before.data.status)) return json({ error: 'OUTBOX_EVENT_NOT_REQUEUEABLE' }, 409);
      const reset = await service.from('product_license_delivery_outbox').update({ status: 'retry', attempts: 0, next_attempt_at: new Date().toISOString(), lease_until: null, last_error: null, updated_at: new Date().toISOString() }).eq('id', requestedId);
      if (reset.error) throw reset.error;
      const audit = await service.from('platform_admin_audit_logs').insert({ admin_user_id: actorId, action: 'product_license_delivery.requeued', entity: 'product_license_delivery_outbox', entity_id: requestedId, before_data: before.data, after_data: { status: 'retry', attempts: 0 }, reason: 'Administrative retry of Food license delivery' });
      if (audit.error) throw audit.error;
      return json({ id: requestedId, status: 'retry' });
    }
    const { data: rows, error } = await service.rpc('product_license_delivery_claim', {
      p_outbox_id: requestedId,
    });
    if (error) throw error;
    const results = [];
    for (const row of rows || []) {
      const now = Date.now();
      const timestamp = String(now);
      const rawBody = JSON.stringify(row.event_payload);
      let response: Response | null = null;
      let failure = 'NETWORK_ERROR';
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-f7-timestamp': timestamp,
            'x-f7-event-id': String(row.event_payload.event_id),
            'x-f7-signature': `v1=${await sign(secret, timestamp, rawBody)}`,
          },
          body: rawBody,
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) failure = `FOOD_HTTP_${response.status}`;
      } catch (error) {
        failure = error instanceof Error ? error.name.slice(0, 80) : 'NETWORK_ERROR';
      }
      const attempts = Number(row.attempts || 0);
      let body: Record<string, unknown> = {};
      if (response?.ok) body = await response.json().catch(() => ({}));
      const delivered = response?.ok && (body.status === 'applied' || body.status === 'duplicate');
      const result = delivered ? 'delivered' : (attempts >= 12 ? 'blocked' : 'retry');
      const errorCode = response?.ok ? String(body.error || 'FOOD_ACK_INVALID').slice(0, 120) : failure;
      const recorded = await service.rpc('product_license_delivery_record_result', {
        p_outbox_id: row.id,
        p_attempt_number: attempts,
        p_result: result,
        p_http_status: response?.status ?? null,
        p_error_code: delivered ? null : errorCode,
        p_remote_license_id: typeof body.license_id === 'string' ? body.license_id : null,
      });
      if (recorded.error) throw recorded.error;
      results.push({ id: row.id, status: result, attempts, ...(delivered ? {} : { error: errorCode }) });
    }
    return json({ processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PRODUCT_LICENSE_DISPATCH_FAILED';
    return json({ error: message.slice(0, 120) }, 500);
  }
});
