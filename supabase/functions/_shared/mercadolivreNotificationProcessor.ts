import { meliRequest, minimalOrder, assertSellerOwnedItem, validItemId } from './mercadolivre.ts';
import { processMeliNotificationBatch } from './mercadolivreQueuePolicy.js';
import type { MeliTokenConnection } from './mercadolivreTokens.ts';
import { safeMeliCategoryName, safeMeliImageUrl, safeMeliPermalink } from './mercadolivreCatalog.js';

type AdminClient = ReturnType<typeof import('./core.ts').admin>;

export type MeliClaimedEvent = {
  id: string;
  company_id: string;
  connection_id: string;
  topic: string;
  resource_path: string;
  attempts: number;
};
export type MeliNotificationConnection = MeliTokenConnection & {
  company_id: string;
  status: string;
  seller_id: string;
};

export function listingSnapshot(item: Record<string, unknown>, sellerId: string, now = new Date().toISOString(), categoryName: unknown = null) {
  assertSellerOwnedItem(item, sellerId);
  const id = String(item.id || '');
  if (!validItemId(id)) throw new Error('MELI_ITEM_ID_INVALID');
  const quantity = item.available_quantity == null ? null : Number(item.available_quantity);
  const price = item.price == null ? null : Number(item.price);
  return {
    external_item_id: id,
    title: String(item.title || 'Anúncio sem título').slice(0, 240),
    status: String(item.status || 'unknown').slice(0, 40),
    permalink: safeMeliPermalink(item.permalink),
    image_url: safeMeliImageUrl(item),
    currency_id: typeof item.currency_id === 'string' ? item.currency_id.slice(0, 8) : null,
    price: Number.isFinite(price) ? price : null,
    available_quantity: Number.isSafeInteger(quantity) ? quantity : null,
    category_id: typeof item.category_id === 'string' ? item.category_id.slice(0, 40) : null,
    category_name: safeMeliCategoryName(categoryName),
    seller_sku: typeof item.seller_custom_field === 'string' ? item.seller_custom_field.slice(0, 120) : null,
    external_updated_at: typeof item.last_updated === 'string' ? item.last_updated : null,
    synced_at: now,
  };
}

export async function persistMeliListing(sb: AdminClient, companyId: string, connectionId: string, sellerId: string, item: Record<string, unknown>, categoryName: unknown = null) {
  const snapshot = listingSnapshot(item, sellerId, new Date().toISOString(), categoryName);
  const { data: old, error: lookupError } = await sb.from('meli_listing_links').select('product_id,category_name,image_url')
    .eq('company_id', companyId).eq('connection_id', connectionId).eq('external_item_id', snapshot.external_item_id).maybeSingle();
  if (lookupError) throw new Error('MELI_LISTING_PERSIST_FAILED');
  const { error } = await sb.from('meli_listing_links').upsert({ company_id: companyId, connection_id: connectionId,
    ...snapshot, category_name: snapshot.category_name || old?.category_name || null,
    image_url: snapshot.image_url || old?.image_url || null, product_id: old?.product_id || null },
  { onConflict: 'company_id,connection_id,external_item_id' });
  if (error) throw new Error('MELI_LISTING_PERSIST_FAILED');
}

export async function processCanonicalMeliNotification(sb: AdminClient, event: MeliClaimedEvent, connection: MeliNotificationConnection, token: string) {
  if (event.company_id !== connection.company_id || event.connection_id !== connection.id) throw new Error('MELI_EVENT_TENANT_MISMATCH');
  if (!['items', 'orders_v2'].includes(event.topic) || typeof event.resource_path !== 'string'
      || !/^\/(items|orders)\/[A-Za-z0-9_-]{1,80}$/.test(event.resource_path)
      || (event.topic === 'items' && !event.resource_path.startsWith('/items/'))
      || (event.topic === 'orders_v2' && !event.resource_path.startsWith('/orders/'))) {
    throw new Error('MELI_NOTIFICATION_RESOURCE_INVALID');
  }
  const resource = await meliRequest(event.resource_path, token);
  if (event.topic === 'items') {
    await persistMeliListing(sb, connection.company_id, connection.id, String(connection.seller_id), resource.data);
    return;
  }
  const seller = resource.data.seller && typeof resource.data.seller === 'object' ? resource.data.seller as Record<string, unknown> : null;
  if (seller?.id == null || String(seller.id) !== String(connection.seller_id)) throw new Error('MELI_EVENT_TENANT_MISMATCH');
  const summary = minimalOrder(resource.data);
  if (!/^\d{1,30}$/.test(summary.external_order_id)) throw new Error('MELI_ORDER_ID_INVALID');
  const { error } = await sb.from('meli_orders').upsert({ company_id: connection.company_id, connection_id: connection.id,
    ...summary, imported_at: new Date().toISOString() }, { onConflict: 'company_id,connection_id,external_order_id' });
  if (error) throw new Error('MELI_ORDER_PERSIST_FAILED');
}

export function processClaimedMeliNotifications(sb: AdminClient, events: MeliClaimedEvent[], options: {
  loadConnection: (companyId: string, connectionId: string) => Promise<MeliNotificationConnection | null>;
  resolveToken: (companyId: string, connection: MeliNotificationConnection) => Promise<string>;
  settle: (event: MeliClaimedEvent, outcome: string, errorCode: string | null) => Promise<boolean>;
  eventConcurrency?: number;
}) {
  return processMeliNotificationBatch(events, {
    loadConnection: options.loadConnection,
    resolveToken: options.resolveToken,
    processEvent: (event: MeliClaimedEvent, connection: MeliNotificationConnection, token: string) => processCanonicalMeliNotification(sb, event, connection, token),
    settle: options.settle,
    eventConcurrency: options.eventConcurrency,
  });
}
