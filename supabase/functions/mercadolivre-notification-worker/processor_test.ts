import { processCanonicalMeliNotification } from '../_shared/mercadolivreNotificationProcessor.ts';

const companyA = '11111111-1111-4111-8111-111111111111';
const companyB = '22222222-2222-4222-8222-222222222222';
const connection = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: companyA, seller_id: '12345678', status: 'connected',
  access_token_ciphertext: 'synthetic-ciphertext', access_token_iv: 'synthetic-iv', access_token_expires_at: null };

function fakeAdmin() {
  const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const query = { eq() { return this; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } };
  return {
    writes,
    from(table: string) {
      return {
        select() { return query; },
        upsert(payload: Record<string, unknown>) { writes.push({ table, payload }); return Promise.resolve({ error: null }); },
      };
    },
  };
}

function withProviderResponse(payload: Record<string, unknown>, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
  return run().finally(() => { globalThis.fetch = original; });
}

Deno.test('canonical item fetch persists only a matching seller snapshot in the claimed tenant', async () => {
  const sb = fakeAdmin();
  const db = sb as unknown as ReturnType<typeof import('../_shared/core.ts').admin>;
  await withProviderResponse({ id: 'MLB12345678', seller_id: '12345678', title: 'Synthetic listing', status: 'active', price: 12.5, available_quantity: 4 }, async () => {
    await processCanonicalMeliNotification(db, { company_id: companyA, connection_id: connection.id, topic: 'items', resource_path: '/items/MLB12345678', id: crypto.randomUUID(), attempts: 1 }, connection, 'synthetic-token-never-sent');
  });
  if (sb.writes.length !== 1 || sb.writes[0].table !== 'meli_listing_links') throw new Error('Expected one tenant-scoped listing upsert');
  if (sb.writes[0].payload.company_id !== companyA || sb.writes[0].payload.connection_id !== connection.id) throw new Error('Listing write escaped its claimed tenant/connection');
  if (sb.writes[0].payload.title !== 'Synthetic listing') throw new Error('Canonical item fields were not persisted');
});

Deno.test('cross-tenant claim and mismatching canonical seller are rejected before persistence', async () => {
  const sb = fakeAdmin();
  const db = sb as unknown as ReturnType<typeof import('../_shared/core.ts').admin>;
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => { calls += 1; return Promise.resolve(new Response(JSON.stringify({ id: 'MLB12345678', seller_id: '87654321' }), { status: 200 })); };
  try {
    let tenantRejected = false;
    try {
      await processCanonicalMeliNotification(db, { company_id: companyB, connection_id: connection.id, topic: 'items', resource_path: '/items/MLB12345678', id: crypto.randomUUID(), attempts: 1 }, connection, 'synthetic-token-never-sent');
    } catch (error) { tenantRejected = error instanceof Error && error.message === 'MELI_EVENT_TENANT_MISMATCH'; }
    if (!tenantRejected || calls !== 0) throw new Error('Cross-tenant pointer was not rejected before provider access');

    let sellerRejected = false;
    try {
      await processCanonicalMeliNotification(db, { company_id: companyA, connection_id: connection.id, topic: 'items', resource_path: '/items/MLB12345678', id: crypto.randomUUID(), attempts: 1 }, connection, 'synthetic-token-never-sent');
    } catch (error) { sellerRejected = error instanceof Error && error.message === 'MELI_LISTING_SELLER_MISMATCH'; }
    if (!sellerRejected || sb.writes.length !== 0) throw new Error('Mismatching provider seller was persisted');
  } finally { globalThis.fetch = original; }
});

Deno.test('order import requires canonical seller identity and stores only the minimal tenant-scoped snapshot', async () => {
  const sb = fakeAdmin();
  const db = sb as unknown as ReturnType<typeof import('../_shared/core.ts').admin>;
  await withProviderResponse({ id: 123456789, seller: { id: 12345678 }, status: 'paid', total_amount: 20, order_items: [], buyer: { email: 'must-not-persist@example.test' } }, async () => {
    await processCanonicalMeliNotification(db, { company_id: companyA, connection_id: connection.id, topic: 'orders_v2', resource_path: '/orders/123456789', id: crypto.randomUUID(), attempts: 1 }, connection, 'synthetic-token-never-sent');
  });
  if (sb.writes.length !== 1 || sb.writes[0].table !== 'meli_orders') throw new Error('Expected one minimal order snapshot');
  const payload = sb.writes[0].payload;
  if (payload.company_id !== companyA || payload.connection_id !== connection.id) throw new Error('Order write escaped its claimed tenant/connection');
  if ('buyer' in payload || JSON.stringify(payload).includes('must-not-persist')) throw new Error('PII leaked into order snapshot');
});
