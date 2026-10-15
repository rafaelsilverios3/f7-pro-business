import { corsHeaders, json } from '../_shared/core.ts';
import { authorizeMarketplace, safeIntegrationLog } from '../_shared/mercadolivreAccess.ts';
import { base64Url, encryptToken, makeAuthorizationUrl, pkceChallenge, sha256, validUuid } from '../_shared/mercadolivre.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const body = await req.json();
    const companyId = body?.company_id;
    if (!validUuid(companyId)) return json({ code: 'INVALID_PAYLOAD' }, 400);
    const access = await authorizeMarketplace(req, companyId, 'manage');
    if ('error' in access) return json({ code: access.error }, access.status);

    const clientId = Deno.env.get('MELI_CLIENT_ID')?.trim() || '';
    const redirectUri = Deno.env.get('MELI_REDIRECT_URI')?.trim() || '';
    if (!clientId || !/^\d+$/.test(clientId) || !Deno.env.get('MELI_CLIENT_SECRET') || !redirectUri || !Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY')) return json({ code: 'MELI_CONNECTOR_NOT_CONFIGURED' }, 503);
    let callback: URL;
    try { callback = new URL(redirectUri); } catch { return json({ code: 'MELI_CONNECTOR_CONFIG_INVALID' }, 503); }
    let supabaseOrigin = '';
    try { supabaseOrigin = new URL(Deno.env.get('SUPABASE_URL') || '').origin; } catch { /* invalid project URL */ }
    if (callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash
      || callback.origin !== supabaseOrigin || callback.pathname !== '/functions/v1/mercadolivre-callback') {
      return json({ code: 'MELI_CONNECTOR_CONFIG_INVALID' }, 503);
    }

    const pkceSetting = (Deno.env.get('MELI_PKCE_ENABLED') || 'false').trim().toLowerCase();
    if (!['true', 'false'].includes(pkceSetting)) return json({ code: 'MELI_CONNECTOR_CONFIG_INVALID' }, 503);
    let verifierCiphertext: string | null = null;
    let verifierIv: string | null = null;
    let challenge: string | undefined;
    if (pkceSetting === 'true') {
      const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const encrypted = await encryptToken(verifier);
      verifierCiphertext = encrypted.ciphertext;
      verifierIv = encrypted.iv;
      challenge = await pkceChallenge(verifier);
    }

    const state = crypto.randomUUID() + crypto.randomUUID();
    const stateHash = await sha256(state);
    const { error: stateError } = await access.sb.from('meli_oauth_states').insert({
      state_hash: stateHash,
      company_id: companyId,
      user_id: access.user.id,
      pkce_verifier_ciphertext: verifierCiphertext,
      pkce_verifier_iv: verifierIv,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (stateError) return json({ code: 'MELI_OAUTH_STATE_CREATE_FAILED' }, 500);
    await access.sb.from('meli_oauth_states').delete().lt('expires_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    await safeIntegrationLog(access.sb, companyId, 'oauth_authorization_started', 'success');
    return json({ code: 'OK', authorization_url: makeAuthorizationUrl(clientId, redirectUri, state, challenge), expires_in_seconds: 600 });
  } catch (error) {
    const code = error instanceof Error && ['AUTH_REQUIRED'].includes(error.message) ? error.message : 'MELI_REQUEST_FAILED';
    const status = code === 'AUTH_REQUIRED' ? 401 : 500;
    return json({ code }, status);
  }
});
