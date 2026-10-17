import { decryptToken, encryptToken, parseTokenResponse } from './mercadolivre.ts';

export type MeliTokenConnection = {
  id: string;
  seller_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_expires_at: string | null;
};
type AdminClient = ReturnType<typeof import('./core.ts').admin>;

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^MELI_[A-Z_]+$/.test(message) ? message : 'MELI_OPERATION_FAILED';
}

/** Reuses the connector's existing encrypted token and rotating refresh lease. */
export async function accessMercadoLivreToken(
  sb: AdminClient,
  companyId: string,
  connection: MeliTokenConnection,
  dependencies: { fetcher?: typeof fetch; now?: () => number } = {},
) {
  const clientId = Deno.env.get('MELI_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('MELI_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret || !Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY')) throw new Error('MELI_CONNECTOR_NOT_CONFIGURED');
  const now = dependencies.now || Date.now;
  const expiresAt = Date.parse(String(connection.access_token_expires_at || ''));
  if (expiresAt > now() + 60_000) return await decryptToken(connection.access_token_ciphertext, connection.access_token_iv);

  const leaseId = crypto.randomUUID();
  const { data: claim, error: claimError } = await sb.rpc('meli_claim_token_refresh', {
    p_company_id: companyId, p_connection_id: connection.id, p_lease_id: leaseId,
  });
  const row = Array.isArray(claim) ? claim[0] : null;
  if (claimError) throw new Error('MELI_TOKEN_REFRESH_UNAVAILABLE');
  if (!row) throw new Error('MELI_TOKEN_REFRESH_IN_PROGRESS');
  if (row.connection_id !== connection.id) throw new Error('MELI_TOKEN_REFRESH_IDENTITY_MISMATCH');
  try {
    const refreshToken = await decryptToken(row.refresh_token_ciphertext, row.refresh_token_iv);
    const fetcher = dependencies.fetcher || fetch;
    const response = await fetcher('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(12_000),
    });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* raw provider response is never surfaced */ }
    if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? 'MELI_REFRESH_REAUTH_REQUIRED' : 'MELI_REFRESH_RESULT_UNCERTAIN');
    const tokens = parseTokenResponse(payload);
    if (tokens.sellerId !== String(connection.seller_id)) throw new Error('MELI_REFRESH_IDENTITY_MISMATCH');
    const access = await encryptToken(tokens.accessToken);
    const refresh = await encryptToken(tokens.refreshToken);
    const { data: saved, error: saveError } = await sb.rpc('meli_complete_token_refresh', {
      p_company_id: companyId, p_connection_id: connection.id, p_lease_id: leaseId,
      p_access_ciphertext: access.ciphertext, p_access_iv: access.iv,
      p_refresh_ciphertext: refresh.ciphertext, p_refresh_iv: refresh.iv,
      p_expires_at: new Date(now() + tokens.expiresIn * 1000).toISOString(), p_scopes: tokens.scopes,
    });
    if (saveError || saved !== true) throw new Error('MELI_REFRESH_PERSIST_FAILED');
    return tokens.accessToken;
  } catch (error) {
    await sb.rpc('meli_fail_token_refresh', {
      p_company_id: companyId, p_connection_id: connection.id, p_lease_id: leaseId,
      p_error_code: safeErrorCode(error),
    });
    throw error;
  }
}
