import { corsHeaders, json } from '../_shared/core.ts';
import { authorizeMarketplace, safeIntegrationLog } from '../_shared/mercadolivreAccess.ts';
import { assertSellerOwnedItem, decryptToken, encryptToken, meliRequest, minimalOrder, parseTokenResponse, validItemId, validUuid } from '../_shared/mercadolivre.ts';

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^MELI_[A-Z_]+$/.test(message) ? message : 'MELI_OPERATION_FAILED';
}

async function accessToken(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connection: Record<string, any>) {
  const clientId = Deno.env.get('MELI_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('MELI_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret || !Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY')) throw new Error('MELI_CONNECTOR_NOT_CONFIGURED');
  const expiresAt = Date.parse(String(connection.access_token_expires_at || ''));
  if (expiresAt > Date.now() + 60_000) return await decryptToken(connection.access_token_ciphertext, connection.access_token_iv);
  const leaseId = crypto.randomUUID();
  const { data: claim, error: claimError } = await sb.rpc('meli_claim_token_refresh', { p_company_id: companyId, p_connection_id: connection.id, p_lease_id: leaseId });
  const row = Array.isArray(claim) ? claim[0] : null;
  if (claimError) throw new Error('MELI_TOKEN_REFRESH_UNAVAILABLE');
  if (!row) throw new Error('MELI_TOKEN_REFRESH_IN_PROGRESS');
  if (row.connection_id !== connection.id) throw new Error('MELI_TOKEN_REFRESH_IDENTITY_MISMATCH');
  try {
    const refreshToken = await decryptToken(row.refresh_token_ciphertext, row.refresh_token_iv);
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(12_000),
    });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* never surface raw provider response */ }
    if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? 'MELI_REFRESH_REAUTH_REQUIRED' : 'MELI_REFRESH_RESULT_UNCERTAIN');
    const tokens = parseTokenResponse(payload);
    if (tokens.sellerId !== String(connection.seller_id)) throw new Error('MELI_REFRESH_IDENTITY_MISMATCH');
    const access = await encryptToken(tokens.accessToken);
    const refresh = await encryptToken(tokens.refreshToken);
    const { data: saved, error: saveError } = await sb.rpc('meli_complete_token_refresh', {
      p_company_id: companyId, p_connection_id: connection.id, p_lease_id: leaseId,
      p_access_ciphertext: access.ciphertext, p_access_iv: access.iv,
      p_refresh_ciphertext: refresh.ciphertext, p_refresh_iv: refresh.iv,
      p_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(), p_scopes: tokens.scopes,
    });
    if (saveError || saved !== true) throw new Error('MELI_REFRESH_PERSIST_FAILED');
    return tokens.accessToken;
  } catch (error) {
    const reason = safeErrorCode(error);
    await sb.rpc('meli_fail_token_refresh', {
      p_company_id: companyId, p_connection_id: connection.id, p_lease_id: leaseId, p_error_code: reason,
    });
    throw error;
  }
}

async function startRun(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connectionId: string, operation: string, userId: string, idempotencyKey?: string) {
  const payload = { company_id: companyId, connection_id: connectionId, operation, status: 'running', requested_by: userId, idempotency_key: idempotencyKey || null };
  const { data, error } = await sb.from('meli_sync_runs').insert(payload).select('id,status').maybeSingle();
  if (!error && data) return { id: data.id as string, replay: false };
  if (idempotencyKey) {
    const { data: existing } = await sb.from('meli_sync_runs').select('id,status,operation,items_seen,items_written,error_code')
      .eq('company_id', companyId).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing && existing.operation && existing.operation !== operation) throw new Error('MELI_IDEMPOTENCY_KEY_REUSED');
    if (existing?.status === 'completed') return { id: existing.id as string, replay: true, result: existing };
    if (existing) throw new Error('MELI_IDEMPOTENCY_IN_PROGRESS');
  }
  throw new Error('MELI_SYNC_RUN_CREATE_FAILED');
}

async function finishRun(sb: ReturnType<typeof import('../_shared/core.ts').admin>, runId: string, status: string, counts: { seen?: number; written?: number } = {}, errorCode: string | null = null) {
  const { error } = await sb.from('meli_sync_runs').update({ status, items_seen: counts.seen || 0, items_written: counts.written || 0,
    error_code: errorCode, finished_at: new Date().toISOString() }).eq('id', runId);
  if (error) throw new Error('MELI_RUN_FINALIZE_FAILED');
}

function listingSnapshot(item: Record<string, unknown>, sellerId: string) {
  assertSellerOwnedItem(item, sellerId);
  const id = String(item.id || '');
  if (!validItemId(id)) throw new Error('MELI_ITEM_ID_INVALID');
  const quantity = item.available_quantity == null ? null : Number(item.available_quantity);
  const price = item.price == null ? null : Number(item.price);
  return {
    external_item_id: id,
    title: String(item.title || 'Anúncio sem título').slice(0, 240),
    status: String(item.status || 'unknown').slice(0, 40),
    permalink: typeof item.permalink === 'string' && item.permalink.startsWith('https://') ? item.permalink.slice(0, 1000) : null,
    currency_id: typeof item.currency_id === 'string' ? item.currency_id.slice(0, 8) : null,
    price: Number.isFinite(price) ? price : null,
    available_quantity: Number.isSafeInteger(quantity) ? quantity : null,
    category_id: typeof item.category_id === 'string' ? item.category_id.slice(0, 40) : null,
    seller_sku: typeof item.seller_custom_field === 'string' ? item.seller_custom_field.slice(0, 120) : null,
    external_updated_at: typeof item.last_updated === 'string' ? item.last_updated : null,
    synced_at: new Date().toISOString(),
  };
}

async function persistListing(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connectionId: string, sellerId: string, item: Record<string, unknown>) {
  const snapshot = listingSnapshot(item, sellerId);
  const { data: old } = await sb.from('meli_listing_links').select('product_id')
    .eq('company_id', companyId).eq('connection_id', connectionId).eq('external_item_id', snapshot.external_item_id).maybeSingle();
  const { error } = await sb.from('meli_listing_links').upsert({ company_id: companyId, connection_id: connectionId,
    ...snapshot, product_id: old?.product_id || null }, { onConflict: 'company_id,connection_id,external_item_id' });
  if (error) throw new Error('MELI_LISTING_PERSIST_FAILED');
}

async function syncListings(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connection: Record<string, any>, token: string) {
  const query = new URLSearchParams({ search_type: 'scan', limit: '20' });
  if (connection.catalog_scroll_id) query.set('scroll_id', connection.catalog_scroll_id);
  const page = await meliRequest(`/users/${encodeURIComponent(connection.seller_id)}/items/search?${query.toString()}`, token);
  const ids = Array.isArray(page.data.results) ? page.data.results.map(String).filter(validItemId).slice(0, 20) : [];
  let written = 0;
  for (const itemId of ids) {
    const item = await meliRequest(`/items/${encodeURIComponent(itemId)}`, token);
    await persistListing(sb, companyId, connection.id, String(connection.seller_id), item.data);
    written += 1;
  }
  const nextScrollId = typeof page.data.scroll_id === 'string' && page.data.scroll_id.length <= 2000 ? page.data.scroll_id : null;
  await sb.from('meli_connections').update({ last_catalog_sync_at: new Date().toISOString(), catalog_scroll_id: nextScrollId, last_error_code: null })
    .eq('company_id', companyId).eq('id', connection.id);
  return { seen: ids.length, written, has_more: Boolean(nextScrollId) };
}

async function syncOrders(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connection: Record<string, any>, token: string, offset: number) {
  const query = new URLSearchParams({ seller: String(connection.seller_id), sort: 'date_desc', limit: '50', offset: String(offset) });
  const response = await meliRequest(`/orders/search?${query.toString()}`, token);
  const orders = Array.isArray(response.data.results) ? response.data.results.slice(0, 50) as Record<string, unknown>[] : [];
  let written = 0;
  for (const order of orders) {
    const summary = minimalOrder(order);
    if (!/^\d{1,30}$/.test(summary.external_order_id)) continue;
    const { error } = await sb.from('meli_orders').upsert({ company_id: companyId, connection_id: connection.id, ...summary, imported_at: new Date().toISOString() }, { onConflict: 'company_id,connection_id,external_order_id' });
    if (error) throw new Error('MELI_ORDER_PERSIST_FAILED');
    written += 1;
  }
  await sb.from('meli_connections').update({ last_orders_sync_at: new Date().toISOString(), last_error_code: null })
    .eq('company_id', companyId).eq('id', connection.id);
  const total = Number((response.data.paging as Record<string, unknown> | undefined)?.total || 0);
  const hasMore = total > offset + orders.length;
  return { seen: orders.length, written, has_more: hasMore, next_offset: hasMore ? offset + orders.length : null };
}

async function processNotifications(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connection: Record<string, any>, token: string) {
  const { data: events, error } = await sb.rpc('meli_claim_notification_events', { p_company_id: companyId, p_connection_id: connection.id, p_limit: 10 });
  if (error) throw new Error('MELI_NOTIFICATION_QUEUE_UNAVAILABLE');
  let processed = 0; let failed = 0;
  for (const event of (events || []) as Record<string, any>[]) {
    if (event.connection_id !== connection.id) {
      await sb.from('meli_webhook_events').update({ status: 'retry', last_error_code: 'CONNECTION_MISMATCH', next_attempt_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', event.id).eq('company_id', companyId);
      failed += 1; continue;
    }
    try {
      const resource = await meliRequest(event.resource_path, token);
      if (event.topic === 'items') await persistListing(sb, companyId, connection.id, String(connection.seller_id), resource.data);
      else {
        const summary = minimalOrder(resource.data);
        if (!/^\d{1,30}$/.test(summary.external_order_id)) throw new Error('MELI_ORDER_ID_INVALID');
        const { error: saveError } = await sb.from('meli_orders').upsert({ company_id: companyId, connection_id: connection.id, ...summary }, { onConflict: 'company_id,connection_id,external_order_id' });
        if (saveError) throw new Error('MELI_ORDER_PERSIST_FAILED');
      }
      await sb.from('meli_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString(), last_error_code: null }).eq('id', event.id).eq('company_id', companyId);
      processed += 1;
    } catch (error) {
      const code = safeErrorCode(error);
      const exhausted = Number(event.attempts) >= 6 || code === 'MELI_RESOURCE_NOT_FOUND';
      await sb.from('meli_webhook_events').update({ status: exhausted ? 'dead_letter' : 'retry', last_error_code: code,
        next_attempt_at: new Date(Date.now() + Math.min(60 * 60_000, 2 ** Number(event.attempts) * 30_000)).toISOString() })
        .eq('id', event.id).eq('company_id', companyId);
      failed += 1;
    }
  }
  return { seen: (events || []).length, written: processed, failed };
}

async function handle(req: Request) {
  const body = await req.json();
  const companyId = body?.company_id;
  const action = String(body?.action || '');
  if (!validUuid(companyId)) return json({ code: 'INVALID_PAYLOAD' }, 400);
  const managerActions = ['disconnect', 'map_listing', 'push_product'];
  const access = await authorizeMarketplace(req, companyId, managerActions.includes(action) ? 'manage' : 'view');
  if ('error' in access) return json({ code: access.error }, access.status);
  const { sb, user } = access;

  const { data: connections, error: connectionError } = await sb.from('meli_connections')
    .select('id,seller_id,status,scopes,access_token_ciphertext,access_token_iv,refresh_token_ciphertext,refresh_token_iv,access_token_expires_at,token_version,catalog_scroll_id,last_catalog_sync_at,last_orders_sync_at,last_error_code')
    .eq('company_id', companyId).eq('status', 'connected').order('connected_at', { ascending: false }).limit(10);
  if (connectionError) return json({ code: 'MELI_CONNECTION_LOOKUP_FAILED' }, 500);
  const connectionsSafe = (connections || []).map((connection) => ({ id: connection.id, seller_id: connection.seller_id,
    status: connection.status, scopes: connection.scopes, token_expires_at: connection.access_token_expires_at,
    last_catalog_sync_at: connection.last_catalog_sync_at, last_orders_sync_at: connection.last_orders_sync_at,
    last_error_code: connection.last_error_code }));
  if (action === 'status') return json({ code: 'OK', configured: Boolean(Deno.env.get('MELI_CLIENT_ID') && Deno.env.get('MELI_CLIENT_SECRET') && Deno.env.get('MELI_REDIRECT_URI') && Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY')),
    connections: connectionsSafe });
  const connectionId = body?.connection_id;
  if (!validUuid(connectionId)) return json({ code: 'INVALID_PAYLOAD' }, 400);
  const connection = (connections || []).find((item) => item.id === connectionId);
  if (!connection && action !== 'disconnect') return json({ code: 'MELI_CONNECTION_NOT_FOUND' }, 404);

  if (action === 'disconnect') {
    if (body?.confirm !== true) return json({ code: 'EXPLICIT_CONFIRMATION_REQUIRED' }, 400);
    const { error } = await sb.from('meli_connections').update({ status: 'disconnected', access_token_ciphertext: null,
      access_token_iv: null, refresh_token_ciphertext: null, refresh_token_iv: null, refresh_lease_id: null,
      refresh_lease_until: null, disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('id', connectionId);
    if (error) return json({ code: 'MELI_DISCONNECT_FAILED' }, 500);
    await sb.from('sales_channels').update({ status: 'disconnected', connected: false }).eq('company_id', companyId).eq('external_account_id', connection?.seller_id || '');
    await safeIntegrationLog(sb, companyId, 'account_disconnected', 'success', { local_tokens_cleared: true });
    return json({ code: 'OK', status: 'disconnected', note: 'A autorização também pode ser revogada no painel do Mercado Livre.' });
  }
  if (!connection) return json({ code: 'MELI_CONNECTION_NOT_FOUND' }, 404);

  if (action === 'map_listing') {
    if (body?.confirm !== true || !validUuid(body?.product_id) || !validItemId(body?.external_item_id)) return json({ code: 'INVALID_PAYLOAD' }, 400);
    const { data: product } = await sb.from('products').select('id').eq('company_id', companyId).eq('id', body.product_id).maybeSingle();
    const { data: listing } = await sb.from('meli_listing_links').select('id').eq('company_id', companyId).eq('connection_id', connectionId).eq('external_item_id', body.external_item_id).maybeSingle();
    if (!product || !listing) return json({ code: 'MELI_MAPPING_TARGET_NOT_FOUND' }, 404);
    const { error } = await sb.from('meli_listing_links').update({ product_id: product.id, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', listing.id);
    if (error) return json({ code: 'MELI_MAPPING_FAILED' }, 500);
    await safeIntegrationLog(sb, companyId, 'listing_mapped', 'success');
    return json({ code: 'OK', mapped: true });
  }

  const readOnlyActions = ['sync_listings', 'sync_orders', 'process_notifications', 'list_orders', 'list_listings', 'list_history'];
  if (!readOnlyActions.includes(action) && action !== 'push_product') return json({ code: 'UNSUPPORTED_ACTION' }, 400);
  if (action === 'list_orders') {
    const { data, error } = await sb.from('meli_orders').select('external_order_id,status,date_created,date_closed,currency_id,total_amount,paid_amount,item_count,shipping_status,imported_at')
      .eq('company_id', companyId).eq('connection_id', connectionId).order('date_created', { ascending: false }).limit(100);
    if (error) return json({ code: 'MELI_ORDERS_LOOKUP_FAILED' }, 500);
    return json({ code: 'OK', orders: data || [] });
  }
  if (action === 'list_listings') {
    const { data, error } = await sb.from('meli_listing_links').select('id,product_id,external_item_id,title,status,permalink,currency_id,price,available_quantity,category_id,seller_sku,external_updated_at,synced_at')
      .eq('company_id', companyId).eq('connection_id', connectionId).order('synced_at', { ascending: false }).limit(100);
    if (error) return json({ code: 'MELI_LISTINGS_LOOKUP_FAILED' }, 500);
    return json({ code: 'OK', listings: data || [] });
  }
  if (action === 'list_history') {
    const { data, error } = await sb.from('meli_sync_runs')
      .select('id,operation,status,items_seen,items_written,error_code,started_at,finished_at')
      .eq('company_id', companyId).eq('connection_id', connectionId).order('started_at', { ascending: false }).limit(30);
    if (error) return json({ code: 'MELI_HISTORY_LOOKUP_FAILED' }, 500);
    return json({ code: 'OK', runs: data || [] });
  }

  const key = body?.idempotency_key;
  if ((action === 'push_product' || key !== undefined) && !validUuid(key)) return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
  if (action === 'push_product' && body?.confirm !== true) return json({ code: 'EXPLICIT_CONFIRMATION_REQUIRED' }, 400);
  if (action === 'push_product' && !validItemId(body?.external_item_id)) return json({ code: 'INVALID_PAYLOAD' }, 400);
  const operation = action === 'sync_listings' ? 'catalog_read' : action === 'sync_orders' ? 'orders_read' : action === 'push_product' ? 'listing_update' : 'notification_process';
  const run = await startRun(sb, companyId, connectionId, operation, user.id, key);
  if (run.replay) return json({ code: 'OK', replay: true, run: run.result });
  let counts = { seen: 0, written: 0 };
  let providerWriteSucceeded = false;
  try {
    const token = await accessToken(sb, companyId, connection);
    if (action === 'sync_listings') counts = await syncListings(sb, companyId, connection, token);
    else if (action === 'sync_orders') {
      const offset = Number(body.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) throw new Error('MELI_OFFSET_INVALID');
      counts = await syncOrders(sb, companyId, connection, token, offset);
    }
    else if (action === 'process_notifications') counts = await processNotifications(sb, companyId, connection, token);
    else if (action === 'push_product') {
      const { data: link } = await sb.from('meli_listing_links').select('product_id')
        .eq('company_id', companyId).eq('connection_id', connectionId).eq('external_item_id', body.external_item_id).maybeSingle();
      if (!link?.product_id) throw new Error('MELI_LISTING_PRODUCT_NOT_MAPPED');
      const { data: product } = await sb.from('products').select('id,price,stock').eq('company_id', companyId).eq('id', link.product_id).maybeSingle();
      if (!product) throw new Error('MELI_PRODUCT_NOT_FOUND');
      const requested = Array.isArray(body.fields) ? [...new Set(body.fields.filter((field: unknown) => ['price', 'stock'].includes(String(field))))] : [];
      if (!requested.length || requested.length !== body.fields.length) throw new Error('MELI_FIELDS_INVALID');
      const payload: Record<string, number> = {};
      if (requested.includes('price')) {
        const price = Number(product.price);
        if (!Number.isFinite(price) || price <= 0) throw new Error('MELI_PRODUCT_PRICE_INVALID');
        payload.price = price;
      }
      if (requested.includes('stock')) {
        const stock = Number(product.stock);
        if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('MELI_STOCK_MUST_BE_INTEGER');
        payload.available_quantity = stock;
      }
      // An item-level PUT can change/delete variants if the variation list is
      // omitted. This connector does not yet map F7 variants, so fail closed.
      const remoteListing = await meliRequest(`/items/${encodeURIComponent(body.external_item_id)}`, token);
      assertSellerOwnedItem(remoteListing.data, String(connection.seller_id));
      if (Array.isArray(remoteListing.data.variations) && remoteListing.data.variations.length > 0) {
        throw new Error('MELI_VARIATIONS_UNSUPPORTED');
      }
      const updated = await meliRequest(`/items/${encodeURIComponent(body.external_item_id)}`, token, { method: 'PUT', body: JSON.stringify(payload) });
      providerWriteSucceeded = true;
      await persistListing(sb, companyId, connectionId, String(connection.seller_id), updated.data);
      counts = { seen: 1, written: 1 };
    }
    await finishRun(sb, run.id, 'completed', counts);
    await safeIntegrationLog(sb, companyId, action, 'success', { records_seen: counts.seen, records_written: counts.written });
    return json({ code: 'OK', run_id: run.id, ...counts });
  } catch (error) {
    const code = safeErrorCode(error);
    const uncertainWrite = action === 'push_product' && (providerWriteSucceeded || ['MELI_TIMEOUT', 'MELI_NETWORK_ERROR'].includes(code));
    const storedCode = uncertainWrite ? 'MELI_WRITE_RESULT_UNCERTAIN' : code;
    try { await finishRun(sb, run.id, uncertainWrite ? 'partial' : 'failed', counts, storedCode); } catch { /* keep the public response sanitized */ }
    await safeIntegrationLog(sb, companyId, action, 'error', { error_code: storedCode });
    const status = code === 'MELI_TOKEN_REFRESH_IN_PROGRESS' ? 409 : code === 'MELI_TOKEN_REJECTED' ? 401 : 502;
    return json({ code: storedCode, run_id: run.id }, status);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const length = Number(req.headers.get('content-length') || '0');
  if (length > 16_384) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413);
  try { return await handle(req); }
  catch (error) {
    const code = safeErrorCode(error);
    const authRequired = error instanceof Error && error.message === 'AUTH_REQUIRED';
    const conflict = error instanceof Error && ['MELI_IDEMPOTENCY_IN_PROGRESS', 'MELI_IDEMPOTENCY_KEY_REUSED', 'MELI_TOKEN_REFRESH_IN_PROGRESS'].includes(error.message);
    return json({ code: authRequired ? 'AUTH_REQUIRED' : code }, authRequired ? 401 : conflict ? 409 : 500);
  }
});
