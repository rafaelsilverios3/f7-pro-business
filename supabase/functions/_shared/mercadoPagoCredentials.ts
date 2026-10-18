export type MercadoPagoEnvironment = 'test' | 'production';
export type MercadoPagoCredentialCheck = 'verified' | 'mismatch' | 'unavailable';

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
export async function verifyMercadoPagoCredentialEnvironment(
  accessToken: string,
  expectedEnvironment: string,
  providerFetch: typeof fetch = fetch,
): Promise<MercadoPagoCredentialCheck> {
  if (!accessToken || !['test', 'production'].includes(expectedEnvironment)) {
    return 'mismatch';
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
    if (response.status === 401 || response.status === 403) return 'mismatch';
    if (!response.ok) return response.status >= 500 || response.status === 429 ? 'unavailable' : 'mismatch';

    let identity: unknown;
    try {
      identity = await response.json();
    } catch {
      return 'mismatch';
    }
    if (!identity || typeof identity !== 'object') return 'mismatch';

    const profile = identity as { tags?: unknown; site_id?: unknown };
    if (
      profile.site_id !== EXPECTED_SITE_ID ||
      !Array.isArray(profile.tags) ||
      !profile.tags.every((tag) => typeof tag === 'string')
    ) {
      return 'mismatch';
    }

    const isTestAccount = profile.tags.includes('test_user');
    return environment === 'test'
      ? isTestAccount ? 'verified' : 'mismatch'
      : isTestAccount ? 'mismatch' : 'verified';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timeout);
  }
}
