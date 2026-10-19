export type MercadoPagoEnvironment = 'test' | 'production';
export type MercadoPagoCredentialCheck = 'verified' | 'mismatch' | 'unavailable';
export type MercadoPagoCredentialIdentity = { check: MercadoPagoCredentialCheck; sellerId: string | null };

const MERCADO_LIBRE_SELF_URL = 'https://api.mercadolibre.com/users/me';
const EXPECTED_SITE_ID = 'MLB';

/**
 * Mercado Pago Orders test Access Tokens can use the same APP_USR prefix as
 * production credentials. Verify the account behind the token against the
 * documented Mercado Libre `/users/me` identity instead of inferring its mode
 * from the token string or an environment flag.
 *
 * This is a read-only provider request. Any missing, malformed, or
 * unverifiable identity fails closed; no raw response is returned or logged.
 */
export async function getMercadoPagoCredentialIdentity(
  accessToken: string,
  expectedEnvironment: string,
  providerFetch: typeof fetch = fetch,
): Promise<MercadoPagoCredentialIdentity> {
  if (!accessToken || !['test', 'production'].includes(expectedEnvironment)) {
    return { check: 'mismatch', sellerId: null };
  }
  const environment = expectedEnvironment as MercadoPagoEnvironment;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await providerFetch(MERCADO_LIBRE_SELF_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { check: 'mismatch', sellerId: null };
    if (!response.ok) return { check: response.status >= 500 || response.status === 429 ? 'unavailable' : 'mismatch', sellerId: null };

    let identity: unknown;
    try {
      identity = await response.json();
    } catch {
      return { check: 'mismatch', sellerId: null };
    }
    if (!identity || typeof identity !== 'object') return { check: 'mismatch', sellerId: null };

    const profile = identity as { id?: unknown; tags?: unknown; site_id?: unknown };
    const sellerId = String(profile.id ?? '').trim();
    if (
      profile.site_id !== EXPECTED_SITE_ID ||
      !/^\d{1,24}$/.test(sellerId) ||
      !Array.isArray(profile.tags) ||
      !profile.tags.every((tag) => typeof tag === 'string')
    ) {
      return { check: 'mismatch', sellerId: null };
    }

    const isTestAccount = profile.tags.includes('test_user');
    const check = environment === 'test'
      ? isTestAccount ? 'verified' : 'mismatch'
      : isTestAccount ? 'mismatch' : 'verified';
    return { check, sellerId: check === 'verified' ? sellerId : null };
  } catch {
    return { check: 'unavailable', sellerId: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyMercadoPagoCredentialEnvironment(
  accessToken: string,
  expectedEnvironment: string,
  providerFetch: typeof fetch = fetch,
): Promise<MercadoPagoCredentialCheck> {
  return (await getMercadoPagoCredentialIdentity(accessToken, expectedEnvironment, providerFetch)).check;
}
