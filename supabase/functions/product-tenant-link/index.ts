import { admin, auth, corsHeaders, hashToken, json } from './core.ts';

const encoder = new TextEncoder();
function hex(bytes: Uint8Array) { return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function fromHex(value: string) { return new Uint8Array(value.match(/.{2}/g)!.map((item) => Number.parseInt(item, 16))); }
function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function signature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const service = admin();
    const rawBody = await req.text();
    if (rawBody.length > 12_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
    const input = JSON.parse(rawBody || '{}');
    const action = String(input.action || '');
    if (action === 'accept_food_link') {
      const secret = Deno.env.get('F7_COMMERCE_SYNC_SECRET') || '';
      const timestamp = req.headers.get('x-f7-timestamp') || '';
      const supplied = req.headers.get('x-f7-signature') || '';
      const suppliedHex = supplied.replace(/^v1=/, '');
      const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
      if (secret.length < 32 || !/^\d{10,13}$/.test(timestamp) || Math.abs(Date.now() - timestampMs) > 5 * 60_000 || !/^[a-f0-9]{64}$/i.test(suppliedHex)) {
        return json({ error: 'UNAUTHORIZED' }, 401);
      }
      const expected = await signature(secret, timestamp, rawBody);
      if (!constantTimeEqual(expected, fromHex(suppliedHex))) return json({ error: 'UNAUTHORIZED' }, 401);
      const result = await service.rpc('product_link_challenge_accept', {
        p_proof_digest: input.proof_digest,
        p_food_company_id: input.food_company_id,
        p_food_user_id: input.food_user_id,
        p_food_proof_digest: input.food_proof_digest,
      });
      if (result.error) throw result.error;
      return json(result.data);
    }

    const jwt = auth(req);
    const identity = await service.auth.getUser(jwt);
    const actor = identity.data.user;
    if (identity.error || !actor) return json({ error: 'AUTH_REQUIRED' }, 401);
    if (action !== 'start') return json({ error: 'ACTION_NOT_FOUND' }, 404);
    const accountId = String(input.commercial_account_id || '');
    const proCompanyId = input.pro_company_id ? String(input.pro_company_id) : null;
    if (!/^[0-9a-f-]{36}$/i.test(accountId) || !proCompanyId || !/^[0-9a-f-]{36}$/i.test(proCompanyId)) {
      return json({ error: 'INVALID_LINK_INPUT' }, 422);
    }
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const oneTimeToken = hex(tokenBytes);
    const result = await service.rpc('product_link_challenge_start', {
      p_account_id: accountId,
      p_actor_id: actor.id,
      p_pro_company_id: proCompanyId,
      p_proof_digest: await hashToken(oneTimeToken),
    });
    if (result.error) throw result.error;
    return json({ ...result.data, one_time_code: oneTimeToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PRODUCT_LINK_FAILED';
    const status = message.includes('AUTH_REQUIRED') ? 401
      : ['COMMERCIAL_ACCOUNT_ADMIN_REQUIRED', 'PRO_COMPANY_ADMIN_REQUIRED'].includes(message) ? 403
      : message.includes('NOT_FOUND') ? 404
      : message.includes('INVALID') || message.includes('EXPIRED') ? 422
      : 500;
    return json({ error: message.slice(0, 120) }, status);
  }
});
