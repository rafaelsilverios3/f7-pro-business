import { assertSellerOwnedItem, canManageMarketplace, decryptToken, encryptToken, isOfficialMercadoLivreWebhookIp, makeAuthorizationUrl, meliRequest, minimalOrder, parseTokenResponse, pkceChallenge, safeResourcePath, sha256, validItemId } from './mercadolivre.ts';
import { authorizeMarketplace, checkMarketplaceEntitlement } from './mercadolivreAccess.ts';

Deno.test('Mercado Livre authorization URL binds server callback and opaque state', () => {
  const url = new URL(makeAuthorizationUrl('123456', 'https://project.supabase.co/functions/v1/mercadolivre-callback', 'opaque-state'));
  if (url.origin !== 'https://auth.mercadolivre.com.br') throw new Error('wrong OAuth origin');
  if (url.searchParams.get('response_type') !== 'code') throw new Error('wrong OAuth grant');
  if (url.searchParams.get('redirect_uri') !== 'https://project.supabase.co/functions/v1/mercadolivre-callback') throw new Error('wrong redirect URI');
  if (url.searchParams.get('state') !== 'opaque-state') throw new Error('state missing');
});

Deno.test('OAuth PKCE S256 parameters are included only for configured PKCE applications', async () => {
  const challenge = await pkceChallenge('synthetic-verifier-that-is-long-enough-for-pkce-0123456789');
  const url = new URL(makeAuthorizationUrl('123456', 'https://project.supabase.co/functions/v1/mercadolivre-callback', 'synthetic-state', challenge));
  if (url.searchParams.get('code_challenge') !== challenge || url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('PKCE parameters missing');
  const plain = new URL(makeAuthorizationUrl('123456', 'https://project.supabase.co/functions/v1/mercadolivre-callback', 'synthetic-state'));
  if (plain.searchParams.has('code_challenge')) throw new Error('PKCE unexpectedly enabled');
});

Deno.test('tenant management authorization fails closed for inactive or unsupported role', () => {
  for (const value of [
    canManageMarketplace('admin', true),
    canManageMarketplace('gestor', true),
    canManageMarketplace('comercial', true),
  ]) if (!value) throw new Error('authorized role rejected');
  for (const value of [
    canManageMarketplace('admin', false),
    canManageMarketplace('vendedor', true),
  ]) if (value) throw new Error('unauthorized access allowed');
});

Deno.test('server authorization requires active membership and centralized marketplace entitlement', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const makeDependencies = (options: { member?: Record<string, unknown> | null; entitlement?: boolean; rpcError?: boolean } = {}) => {
    const adminClient = {
      auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user-a' } }, error: null }) },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: options.entitlement === true, error: options.rpcError ? new Error('synthetic rpc failure') : null };
      },
    };
    const userClient = {
      from: (table: string) => {
        if (table !== 'company_users') throw new Error('unexpected table');
        const filters: Record<string, unknown> = {};
        const builder = {
          select: () => builder,
          eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
          maybeSingle: async () => ({ data: filters.company_id === 'company-a' ? options.member || { role: 'admin', active: true } : null, error: null }),
        };
        return builder;
      },
    };
    return {
      adminFactory: () => adminClient as never,
      userClientFactory: () => userClient as never,
      authParser: () => 'synthetic-jwt',
    };
  };
  const request = new Request('https://local.invalid/functions/v1/mercadolivre-api', { headers: { authorization: 'Bearer synthetic' } });

  const permitted = await authorizeMarketplace(request, 'company-a', 'view', makeDependencies({ entitlement: true }));
  if (!('user' in permitted) || calls.at(-1)?.args.feature !== 'marketplace_integrations') throw new Error('active entitlement was not accepted through the central RPC');

  const planDenied = await authorizeMarketplace(request, 'company-a', 'view', makeDependencies({ entitlement: false }));
  if (!('error' in planDenied) || planDenied.error !== 'FEATURE_NOT_AVAILABLE' || planDenied.status !== 403) throw new Error('missing plan entitlement was not denied');

  const expiredSubscriptionDenied = await authorizeMarketplace(request, 'company-a', 'view', makeDependencies({ entitlement: false }));
  if (!('error' in expiredSubscriptionDenied) || expiredSubscriptionDenied.error !== 'FEATURE_NOT_AVAILABLE') throw new Error('central expired-subscription denial was not enforced');

  const unavailable = await authorizeMarketplace(request, 'company-a', 'view', makeDependencies({ rpcError: true }));
  if (!('error' in unavailable) || unavailable.error !== 'ENTITLEMENT_CHECK_FAILED' || unavailable.status !== 503) throw new Error('entitlement backend failure did not fail closed');

  const beforeCrossTenantCalls = calls.length;
  const crossTenant = await authorizeMarketplace(request, 'company-b', 'view', makeDependencies({ entitlement: true }));
  if (!('error' in crossTenant) || crossTenant.error !== 'FORBIDDEN' || calls.length !== beforeCrossTenantCalls) throw new Error('cross-company access reached entitlement or was allowed');
});

Deno.test('entitlement RPC errors and non-true results fail closed', async () => {
  const noData = await checkMarketplaceEntitlement({ rpc: async () => ({ data: null, error: null }) } as never, 'company-a');
  const error = await checkMarketplaceEntitlement({ rpc: async () => ({ data: true, error: new Error('synthetic') }) } as never, 'company-a');
  if (noData.allowed || noData.unavailable || error.allowed || !error.unavailable) throw new Error('entitlement did not fail closed');
});

Deno.test('notification resource pointers are restricted to documented item/order paths', () => {
  if (safeResourcePath('items', '/items/MLB12345678') !== '/items/MLB12345678') throw new Error('valid item path rejected');
  if (safeResourcePath('orders_v2', '/orders/123456789') !== '/orders/123456789') throw new Error('valid order path rejected');
  for (const [topic, path] of [
    ['items', '//attacker.invalid/items/1'],
    ['items', '/orders/123456789'],
    ['orders_v2', '/users/1'],
    ['orders_v2', '/orders/1?expand=buyer'],
    ['items', '/items/../../secret'],
  ]) if (safeResourcePath(topic, path) !== null) throw new Error('unsafe resource accepted');
});

Deno.test('webhook origin allowlist accepts only the current official Mercado Livre IPs', () => {
  if (!isOfficialMercadoLivreWebhookIp('44.212.211.213') || !isOfficialMercadoLivreWebhookIp('54.146.232.68')) {
    throw new Error('official notification source rejected');
  }
  for (const candidate of [null, '', '127.0.0.1', '44.212.211.213, 127.0.0.1', '54.88.218.97', '256.1.1.1', '::1']) {
    if (isOfficialMercadoLivreWebhookIp(candidate)) throw new Error('untrusted or malformed source accepted');
  }
});

Deno.test('listing snapshots reject items owned by a different seller account', () => {
  assertSellerOwnedItem({ seller_id: '123456789', id: 'MLB1234567890' }, '123456789');
  try {
    assertSellerOwnedItem({ seller_id: '987654321', id: 'MLB1234567890' }, '123456789');
    throw new Error('cross-seller item unexpectedly accepted');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'MELI_LISTING_SELLER_MISMATCH') throw error;
  }
});

Deno.test('token response parser requires rotated refresh token and valid account identity', () => {
  const token = parseTokenResponse({ access_token: 'access-token-synthetic-123', refresh_token: 'refresh-token-synthetic-123', user_id: 123456, expires_in: 21600, scope: 'read write offline_access' });
  if (token.sellerId !== '123456' || token.expiresIn !== 21600 || token.scopes.length !== 3) throw new Error('valid response parsed incorrectly');
  let rejected = false;
  try { parseTokenResponse({ access_token: 'short', refresh_token: 'short', user_id: 'bad', expires_in: -1 }); } catch { rejected = true; }
  if (!rejected) throw new Error('invalid provider token accepted');
});

Deno.test('AES-GCM token protection roundtrips synthetic bytes and rejects tampering', async () => {
  const oldKey = Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY');
  Deno.env.set('MELI_TOKEN_ENCRYPTION_KEY', btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
  try {
    const source = 'synthetic-refresh-token-ñ';
    const encrypted = await encryptToken(source);
    if (encrypted.ciphertext.includes(source)) throw new Error('plaintext leaked into ciphertext');
    if (await decryptToken(encrypted.ciphertext, encrypted.iv) !== source) throw new Error('token did not roundtrip');
    let rejected = false;
    try { await decryptToken(encrypted.ciphertext.slice(0, -4) + 'AAAA', encrypted.iv); } catch { rejected = true; }
    if (!rejected) throw new Error('tampered token accepted');
    const hash = await sha256('synthetic-state');
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('unexpected digest');
  } finally {
    if (oldKey === undefined) Deno.env.delete('MELI_TOKEN_ENCRYPTION_KEY');
    else Deno.env.set('MELI_TOKEN_ENCRYPTION_KEY', oldKey);
  }
});

Deno.test('Mercado Livre requests cannot target a caller-controlled host', async () => {
  let rejected = false;
  try { await meliRequest('//attacker.invalid/resource', 'synthetic-token'); } catch (error) { rejected = error instanceof Error && error.message === 'MELI_PATH_INVALID'; }
  if (!rejected) throw new Error('caller-controlled request host accepted');
  if (!validItemId('MLB12345678') || validItemId('https://attacker.invalid')) throw new Error('item ID validation mismatch');
});

Deno.test('order import summary excludes customer, address, phone and raw API fields', () => {
  const summary = minimalOrder({
    id: 123456, status: 'paid', currency_id: 'BRL', total_amount: 120, paid_amount: 120,
    buyer: { email: 'synthetic@example.invalid', first_name: 'Synthetic' },
    shipping: { status: 'ready_to_ship', receiver_address: { street_name: 'Synthetic Street' } },
    order_items: [{ item: { id: 'MLB12345678' }, quantity: 1 }],
  });
  const text = JSON.stringify(summary);
  for (const forbidden of ['synthetic@example.invalid', 'Synthetic Street', 'buyer', 'receiver_address']) {
    if (text.includes(forbidden)) throw new Error(`personal data leaked: ${forbidden}`);
  }
  if (summary.item_count !== 1 || summary.external_order_id !== '123456') throw new Error('safe order summary lost expected fields');
});
