import { admin, corsHeaders, json } from '../_shared/core.ts';
import { canManageMarketplace, decryptToken, parseTokenResponse, encryptToken, meliRequest, sha256, validSellerId } from '../_shared/mercadolivre.ts';
import { checkMarketplaceEntitlement, safeIntegrationLog } from '../_shared/mercadolivreAccess.ts';

function resultRedirect(code: string) {
  const configured = Deno.env.get('APP_ORIGIN') || '';
  try {
    const origin = new URL(configured);
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error();
    const result = new URL('/f7-commerce', origin.origin);
    result.searchParams.set('mercadolivre', code);
    return new Response(null, { status: 303, headers: {
      Location: result.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    } });
  } catch {
    return json({ code }, 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || code.length > 4096 || !state || state.length > 128 || url.searchParams.has('error')) return resultRedirect('authorization_failed');

  const sb = admin();
  let companyId = '';
  try {
    const stateHash = await sha256(state);
    const { data: stateRows, error: consumeError } = await sb.rpc('meli_consume_oauth_state', { p_state_hash: stateHash });
    const oauthState = Array.isArray(stateRows) ? stateRows[0] : null;
    if (consumeError || !oauthState?.company_id || !oauthState?.user_id) return resultRedirect('authorization_expired');
    companyId = String(oauthState.company_id);

    const { data: member, error: memberError } = await sb.from('company_users').select('role,active')
      .eq('company_id', companyId).eq('user_id', oauthState.user_id).maybeSingle();
    if (memberError || !canManageMarketplace(member?.role, member?.active)) {
      await safeIntegrationLog(sb, companyId, 'oauth_callback_denied', 'error', { reason: 'membership_or_entitlement' });
      return resultRedirect('access_revoked');
    }
    const entitlement = await checkMarketplaceEntitlement(sb, companyId);
    if (entitlement.unavailable) return resultRedirect('connection_failed');
    if (!entitlement.allowed) {
      await safeIntegrationLog(sb, companyId, 'oauth_callback_denied', 'error', { reason: 'feature_not_available' });
      return resultRedirect('feature_not_available');
    }

    const clientId = Deno.env.get('MELI_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('MELI_CLIENT_SECRET') || '';
    const redirectUri = Deno.env.get('MELI_REDIRECT_URI') || '';
    if (!clientId || !clientSecret || !redirectUri || !Deno.env.get('MELI_TOKEN_ENCRYPTION_KEY')) {
      await safeIntegrationLog(sb, companyId, 'oauth_callback_configuration_missing', 'error');
      return resultRedirect('connector_not_configured');
    }
    const callbackUri = new URL(redirectUri);
    const projectOrigin = new URL(Deno.env.get('SUPABASE_URL') || '').origin;
    if (callbackUri.protocol !== 'https:' || callbackUri.username || callbackUri.password || callbackUri.search || callbackUri.hash
      || callbackUri.origin !== projectOrigin || callbackUri.pathname !== '/functions/v1/mercadolivre-callback') {
      await safeIntegrationLog(sb, companyId, 'oauth_callback_configuration_invalid', 'error');
      return resultRedirect('connector_not_configured');
    }
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
    if (oauthState.pkce_verifier_ciphertext || oauthState.pkce_verifier_iv) {
      if (!oauthState.pkce_verifier_ciphertext || !oauthState.pkce_verifier_iv) return resultRedirect('authorization_expired');
      form.set('code_verifier', await decryptToken(oauthState.pkce_verifier_ciphertext, oauthState.pkce_verifier_iv));
    }
    const tokenResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(12_000),
    });
    let tokenData: unknown = null;
    try { tokenData = await tokenResponse.json(); } catch { /* sanitized below */ }
    if (!tokenResponse.ok) {
      await safeIntegrationLog(sb, companyId, 'oauth_exchange_failed', 'error', { provider_http_status: tokenResponse.status });
      return resultRedirect('authorization_failed');
    }
    const tokens = parseTokenResponse(tokenData);
    const profile = await meliRequest('/users/me', tokens.accessToken);
    if (!validSellerId(String(profile.data.id || '')) || String(profile.data.id) !== tokens.sellerId) {
      await safeIntegrationLog(sb, companyId, 'oauth_identity_mismatch', 'error');
      return resultRedirect('identity_validation_failed');
    }
    const access = await encryptToken(tokens.accessToken);
    const refresh = await encryptToken(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
    const { data: connection, error: connectionError } = await sb.from('meli_connections').upsert({
      company_id: companyId,
      seller_id: tokens.sellerId,
      status: 'connected',
      scopes: tokens.scopes,
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      access_token_expires_at: expiresAt,
      token_version: 1,
      connected_by: oauthState.user_id,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_error_code: null,
      refresh_lease_id: null,
      refresh_lease_until: null,
    }, { onConflict: 'company_id,seller_id' }).select('id,seller_id,status').single();
    if (connectionError || !connection) throw new Error('MELI_CONNECTION_SAVE_FAILED');

    const { data: channel } = await sb.from('sales_channels').select('id')
      .eq('company_id', companyId).eq('channel_type', 'marketplace').eq('external_account_id', tokens.sellerId).maybeSingle();
    const channelPayload = { name: 'Mercado Livre', channel_type: 'marketplace', status: 'connected', connected: true,
      external_account_id: tokens.sellerId, metadata: { provider: 'mercadolivre', connection_id: connection.id } };
    const channelResult = channel?.id
      ? await sb.from('sales_channels').update(channelPayload).eq('company_id', companyId).eq('id', channel.id)
      : await sb.from('sales_channels').insert({ company_id: companyId, ...channelPayload });
    if (channelResult.error) throw new Error('MELI_CHANNEL_SAVE_FAILED');
    await safeIntegrationLog(sb, companyId, 'oauth_connected', 'success', { seller_account_linked: true });
    return resultRedirect('connected');
  } catch (error) {
    const safeCode = error instanceof Error && /^MELI_[A-Z_]+$/.test(error.message) ? error.message : 'MELI_CALLBACK_FAILED';
    if (companyId) await safeIntegrationLog(sb, companyId, 'oauth_callback_failed', 'error', { reason: safeCode });
    return resultRedirect('connection_failed');
  }
});
