import { corsHeaders, json } from '../_shared/core.ts';
import { authorizeMarketplace, safeIntegrationLog } from '../_shared/mercadolivreAccess.ts';
import { assertSellerOwnedItem, meliRequest, minimalOrder, validItemId, validUuid } from '../_shared/mercadolivre.ts';
import { processClaimedMeliNotifications, persistMeliListing } from '../_shared/mercadolivreNotificationProcessor.ts';
import { accessMercadoLivreToken } from '../_shared/mercadolivreTokens.ts';
import { freshMeliScanCursor, nextMeliScanCursor, normalizeMeliListingQuery, safeMeliCategoryName } from '../_shared/mercadolivreCatalog.js';

const accessToken = accessMercadoLivreToken;

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^MELI_[A-Z0-9_]{1,72}$/.test(message) ? message : 'MELI_OPERATION_FAILED';
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

async function syncListings(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connection: Record<string, any>, token: string) {
  const query = new URLSearchParams({ search_type: 'scan', limit: '20' });
  const cursor = freshMeliScanCursor(connection.catalog_scroll_id, connection.last_catalog_sync_at);
  if (cursor) query.set('scroll_id', cursor);
  const page = await meliRequest(`/users/${encodeURIComponent(connection.seller_id)}/items/search?${query.toString()}`, token);
  const ids = Array.isArray(page.data.results) ? page.data.results.map(String).filter(validItemId).slice(0, 20) : [];
  const categoryNames = new Map<string, string | null>();
  let written = 0;
  for (const itemId of ids) {
    const item = await meliRequest(`/items/${encodeURIComponent(itemId)}`, token);
    const categoryId = typeof item.data.category_id === 'string' ? item.data.category_id : '';
    let categoryName: string | null = null;
    if (categoryId) {
      if (categoryNames.has(categoryId)) categoryName = categoryNames.get(categoryId) || null;
      else {
        try {
          const category = await meliRequest(`/categories/${encodeURIComponent(categoryId)}`, token);
          categoryName = safeMeliCategoryName(category.data?.name);
        } catch {
          // Preserve the real category ID and any previous name; never guess a label.
        }
        categoryNames.set(categoryId, categoryName);
      }
    }
    await persistMeliListing(sb, companyId, connection.id, String(connection.seller_id), item.data, categoryName);
    written += 1;
  }
  const nextScrollId = nextMeliScanCursor(page.data.scroll_id, ids.length);
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

async function processNotifications(sb: ReturnType<typeof import('../_shared/core.ts').admin>, companyId: string, connection: Record<string, any>, _token: string) {
  const claimToken = crypto.randomUUID();
  const { data: events, error } = await sb.rpc('meli_claim_notification_batch', {
    p_claim_token: claimToken, p_company_id: companyId, p_connection_id: connection.id, p_limit: 10,
  });
  if (error) throw new Error('MELI_NOTIFICATION_QUEUE_UNAVAILABLE');
  const result = await processClaimedMeliNotifications(sb, events || [], {
    loadConnection: async (tenantId, connectionId) => {
      const { data, error: lookupError } = await sb.from('meli_connections').select('*')
        .eq('company_id', tenantId).eq('id', connectionId).maybeSingle();
      if (lookupError) throw new Error('MELI_CONNECTION_LOOKUP_FAILED');
      return data;
    },
    resolveToken: async (tenantId, claimedConnection) => {
      if (tenantId === companyId && claimedConnection.id === connection.id) return _token;
      return await accessToken(sb, tenantId, claimedConnection);
    },
    settle: async (event, outcome, errorCode) => {
      const { data, error: settlementError } = await sb.rpc('meli_finish_notification_event', {
        p_company_id: event.company_id, p_event_id: event.id, p_claim_token: claimToken,
        p_outcome: outcome, p_error_code: errorCode,
      });
      if (settlementError) return false;
      return data === true;
    },
  });
  return { seen: result.claimed, written: result.processed, failed: result.retried + result.dead_letter + result.settlement_failures };
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
    const filters = normalizeMeliListingQuery(body);
    const select = 'id,product_id,external_item_id,title,status,permalink,image_url,currency_id,price,available_quantity,category_id,category_name,seller_sku,external_updated_at,synced_at';
    let query = sb.from('meli_listing_links').select(select, { count: 'exact' })
      .eq('company_id', companyId).eq('connection_id', connectionId);
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.or(`title.ilike.%${filters.search}%,external_item_id.ilike.%${filters.search}%`);
    const sortOptions: Record<string, [string, boolean]> = {
      updated_desc: ['synced_at', false], updated_asc: ['synced_at', true],
      price_asc: ['price', true], price_desc: ['price', false],
      title_asc: ['title', true], title_desc: ['title', false],
    };
    const sort = sortOptions[filters.sort] || sortOptions.updated_desc;
    query = query.order(sort[0], { ascending: sort[1], nullsFirst: false })
      .range(filters.offset, filters.offset + filters.pageSize - 1);
    const { data, error, count } = await query;
    if (error) return json({ code: 'MELI_LISTINGS_LOOKUP_FAILED' }, 500);
    const total = count || 0;
    return json({ code: 'OK', listings: data || [], total, page: filters.page, page_size: filters.pageSize,
      has_more: filters.offset + (data || []).length < total });
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
      await persistMeliListing(sb, companyId, connectionId, String(connection.seller_id), updated.data);
      counts = { seen: 1, written: 1 };
    }
    const notificationFailures = action === 'process_notifications'
      ? Number((counts as typeof counts & { failed?: number }).failed || 0)
      : 0;
    const runStatus = notificationFailures > 0 ? 'partial' : 'completed';
    await finishRun(sb, run.id, runStatus, counts, notificationFailures > 0 ? 'MELI_NOTIFICATION_BATCH_PARTIAL' : null);
    await safeIntegrationLog(sb, companyId, action, notificationFailures > 0 ? 'error' : 'success', {
      records_seen: counts.seen, records_written: counts.written, notifications_failed: notificationFailures,
    });
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
