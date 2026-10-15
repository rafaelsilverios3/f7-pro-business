import { admin, corsHeaders, json } from '../_shared/core.ts';
import { safeResourcePath, sha256, validSellerId } from '../_shared/mercadolivre.ts';

async function boundedPayload(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') || '0');
  if (declared > 32_768) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > 32_768) return null;
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await boundedPayload(req);
  if (!body) return json({ code: 'INVALID_NOTIFICATION' }, 400);
  const query = new URL(req.url).searchParams;
  const get = (key: string) => body[key] ?? query.get(key) ?? null;
  const appId = String(get('application_id') || '');
  const expectedAppId = Deno.env.get('MELI_CLIENT_ID') || '';
  if (!expectedAppId || appId !== expectedAppId) return json({ code: 'ACCEPTED', accepted: false });

  const sellerId = String(get('user_id') || '');
  const topic = String(get('topic') || '');
  const resource = safeResourcePath(topic, get('resource'));
  if (!validSellerId(sellerId) || !resource) return json({ code: 'ACCEPTED', accepted: false });

  const sb = admin();
  const { data: matches, error: lookupError } = await sb.from('meli_connections').select('id,company_id')
    .eq('seller_id', sellerId).eq('status', 'connected').limit(2);
  if (lookupError) return json({ code: 'TEMPORARY_FAILURE' }, 503);
  // One seller account may not be routed ambiguously to two tenant queues.
  if (!matches || matches.length !== 1) return json({ code: 'ACCEPTED', accepted: false });
  const match = matches[0];
  const providerId = String(get('_id') || '');
  const sent = String(get('sent') || '');
  const minute = Number.isFinite(Date.parse(sent)) ? new Date(sent).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
  const dedupeKey = await sha256(providerId ? `id:${providerId}` : `${sellerId}|${topic}|${resource}|${minute}`);
  const { data: queued, error: queueError } = await sb.rpc('meli_enqueue_notification', {
    p_company_id: match.company_id,
    p_connection_id: match.id,
    p_dedupe_key: dedupeKey,
    p_topic: topic,
    p_resource_path: resource,
  });
  if (queueError) return json({ code: 'TEMPORARY_FAILURE' }, 503);
  if (queued === false) return json({ code: 'QUEUE_LIMIT_REACHED', accepted: false }, 503);
  // Notifications are unsigned in the documented contract used here. This
  // endpoint stores only a pointer; the worker trusts the authenticated API
  // response, never the notification body, as resource data.
  return json({ code: 'ACCEPTED', accepted: true }, 200);
});
