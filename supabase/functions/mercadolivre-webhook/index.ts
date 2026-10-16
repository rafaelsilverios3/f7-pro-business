import { admin, corsHeaders, json } from '../_shared/core.ts';
import { isOfficialMercadoLivreWebhookIp, safeResourcePath, sha256, validSellerId } from '../_shared/mercadolivre.ts';
import { checkMarketplaceEntitlement } from '../_shared/mercadolivreAccess.ts';

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
  // Supabase's Cloudflare edge supplies this canonical client address. Do not
  // fall back to caller-controlled X-Forwarded-For values.
  const sourceIp = req.headers.get('cf-connecting-ip')?.trim() || '';
  if (!isOfficialMercadoLivreWebhookIp(sourceIp)) return json({ code: 'UNTRUSTED_NOTIFICATION_SOURCE' }, 403);
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
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(providerId)) return json({ code: 'ACCEPTED', accepted: false });
  const entitlement = await checkMarketplaceEntitlement(sb, String(match.company_id));
  if (entitlement.unavailable) return json({ code: 'TEMPORARY_FAILURE' }, 503);
  if (!entitlement.allowed) return json({ code: 'ACCEPTED', accepted: false });
  const dedupeKey = await sha256(`id:${providerId}`);
  const { data: queued, error: queueError } = await sb.rpc('meli_enqueue_notification', {
    p_company_id: match.company_id,
    p_connection_id: match.id,
    p_dedupe_key: dedupeKey,
    p_topic: topic,
    p_resource_path: resource,
  });
  if (queueError) return json({ code: 'TEMPORARY_FAILURE' }, 503);
  if (queued === false) {
    const { data: duplicate, error: duplicateLookupError } = await sb.from('meli_webhook_events').select('id')
      .eq('company_id', match.company_id).eq('dedupe_key', dedupeKey).maybeSingle();
    if (duplicateLookupError) return json({ code: 'TEMPORARY_FAILURE' }, 503);
    if (duplicate) return json({ code: 'ACCEPTED', accepted: true, deduplicated: true }, 200);
    return json({ code: 'QUEUE_LIMIT_REACHED', accepted: false }, 503);
  }
  // The notification only points to a resource. The worker fetches the
  // canonical resource with this seller's token before persisting anything.
  return json({ code: 'ACCEPTED', accepted: true, deduplicated: false }, 200);
});
