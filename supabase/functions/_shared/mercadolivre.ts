export const MELI_API = 'https://api.mercadolibre.com';
export const MELI_AUTH = 'https://auth.mercadolivre.com.br/authorization';

export function canManageMarketplace(role: unknown, active: unknown): boolean {
  return active === true && ['admin', 'gestor', 'comercial'].includes(String(role || '').toLowerCase());
}

export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validSellerId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{3,24}$/.test(value);
}

export function validItemId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}\d{6,20}$/.test(value);
}

export function assertSellerOwnedItem(item: Record<string, unknown>, sellerId: string): void {
  if (!validSellerId(sellerId) || String(item.seller_id || '') !== sellerId) {
    throw new Error('MELI_LISTING_SELLER_MISMATCH');
  }
}

export function safeResourcePath(topic: unknown, value: unknown): string | null {
  if (typeof topic !== 'string' || typeof value !== 'string' || value.length > 241) return null;
  if (!/^\/(items|orders)\/[A-Za-z0-9_-]{1,80}$/.test(value)) return null;
  if (topic === 'items' && value.startsWith('/items/')) return value;
  if (topic === 'orders_v2' && value.startsWith('/orders/')) return value;
  return null;
}

export function makeAuthorizationUrl(clientId: string, redirectUri: string, state: string, codeChallenge?: string): string {
  const url = new URL(MELI_AUTH);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function parseTokenResponse(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('MELI_TOKEN_RESPONSE_INVALID');
  const token = value as Record<string, unknown>;
  if (typeof token.access_token !== 'string' || token.access_token.length < 16 || token.access_token.length > 8192) throw new Error('MELI_TOKEN_RESPONSE_INVALID');
  if (typeof token.refresh_token !== 'string' || token.refresh_token.length < 16 || token.refresh_token.length > 8192) throw new Error('MELI_TOKEN_RESPONSE_INVALID');
  if (!validSellerId(String(token.user_id || ''))) throw new Error('MELI_TOKEN_RESPONSE_INVALID');
  const expires = Number(token.expires_in);
  if (!Number.isFinite(expires) || expires < 60 || expires > 31_536_000) throw new Error('MELI_TOKEN_RESPONSE_INVALID');
  const scope = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter((item) => /^[a-z_]{1,50}$/.test(item)).slice(0, 20) : [];
  return { accessToken: token.access_token, refreshToken: token.refresh_token, sellerId: String(token.user_id), expiresIn: expires, scopes: scope };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY') || '';
  let raw: Uint8Array;
  try { raw = base64ToBytes(encoded); } catch { throw new Error('MELI_TOKEN_KEY_INVALID'); }
  if (raw.length !== 32) throw new Error('MELI_TOKEN_KEY_INVALID');
  return crypto.subtle.importKey('raw', arrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(cipher)), iv: bytesToBase64(iv) };
}

export async function decryptToken(ciphertext: string, iv: string): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(base64ToBytes(iv)) }, await encryptionKey(), arrayBuffer(base64ToBytes(ciphertext)));
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new Error('MELI_TOKEN_DECRYPT_FAILED');
  }
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function meliRequest(path: string, accessToken: string, init: RequestInit = {}): Promise<{ data: Record<string, unknown>; status: number }> {
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 1000) throw new Error('MELI_PATH_INVALID');
  const url = new URL(path, MELI_API);
  if (url.origin !== MELI_API || url.username || url.password) throw new Error('MELI_PATH_INVALID');
  const method = String(init.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 3 : 1;
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        method,
        signal: controller.signal,
        headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers, Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      clearTimeout(timeout);
      const name = error instanceof Error && error.name === 'AbortError' ? 'MELI_TIMEOUT' : 'MELI_NETWORK_ERROR';
      if (method !== 'GET' || attempt === attempts - 1) throw new Error(name);
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    clearTimeout(timeout);
    lastStatus = response.status;
    let data: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch { /* sanitized provider response */ }
    if (response.ok) return { data, status: response.status };
    if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    const code = response.status === 401 ? 'MELI_TOKEN_REJECTED'
      : response.status === 403 ? 'MELI_SCOPE_OR_ACCESS_DENIED'
      : response.status === 404 ? 'MELI_RESOURCE_NOT_FOUND'
      : response.status === 429 ? 'MELI_RATE_LIMITED'
      : response.status >= 500 ? 'MELI_PROVIDER_UNAVAILABLE'
      : 'MELI_REQUEST_REJECTED';
    throw Object.assign(new Error(code), { status: response.status });
  }
  throw Object.assign(new Error('MELI_PROVIDER_UNAVAILABLE'), { status: lastStatus });
}

export function minimalOrder(order: Record<string, unknown>) {
  const shipping = order.shipping && typeof order.shipping === 'object' ? order.shipping as Record<string, unknown> : {};
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  return {
    external_order_id: String(order.id || ''),
    status: String(order.status || 'unknown').slice(0, 60),
    date_created: typeof order.date_created === 'string' ? order.date_created : null,
    date_closed: typeof order.date_closed === 'string' ? order.date_closed : null,
    currency_id: typeof order.currency_id === 'string' ? order.currency_id.slice(0, 8) : null,
    total_amount: Number.isFinite(Number(order.total_amount)) ? Number(order.total_amount) : null,
    paid_amount: Number.isFinite(Number(order.paid_amount)) ? Number(order.paid_amount) : null,
    item_count: items.length,
    shipping_status: typeof shipping.status === 'string' ? shipping.status.slice(0, 60) : null,
    source_summary: { imported_from: 'mercadolivre', pii_stored: false },
  };
}
