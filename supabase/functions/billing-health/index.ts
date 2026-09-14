import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const sb = admin();
    const jwt = auth(req);
    const { data } = await sb.auth.getUser(jwt);
    if (!data?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
    const configuredEnvironment = (Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || '').trim().toLowerCase();
    const validEnvironment = configuredEnvironment === 'test' || configuredEnvironment === 'production';
    const environmentConflict = !validEnvironment;
    const productionPaymentsEnabled = (Deno.env.get('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') || '').trim().toLowerCase() === 'true';
    let providerReachable = false;
    let providerUser: any = null;
    if (token) {
      const response = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` } });
      providerReachable = response.ok;
      providerUser = response.ok ? await response.json().catch(() => null) : null;
    }
    const isTestUser = Array.isArray(providerUser?.tags) && providerUser.tags.includes('test_user');
    const webhookSecretConfigured = Boolean(Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET'));
    const sandboxAllowed = configuredEnvironment === 'test' && validEnvironment && providerReachable && webhookSecretConfigured && !environmentConflict;
    const productionReady = configuredEnvironment === 'production' && validEnvironment && providerReachable && webhookSecretConfigured;
    const paymentsEnabled = configuredEnvironment === 'test' ? sandboxAllowed : productionReady && productionPaymentsEnabled;
    const environmentConfirmed = configuredEnvironment === 'test' ? sandboxAllowed : productionReady;
    return json({
      provider: 'mercado_pago',
      configured: Boolean(token && webhookSecretConfigured),
      environment: configuredEnvironment || 'unconfigured',
      configured_environment: validEnvironment ? configuredEnvironment : null,
      access_token_configured: Boolean(token),
      credentials_configured: Boolean(token),
      webhook_secret_configured: webhookSecretConfigured,
      provider_reachable: providerReachable,
      production_payments_enabled: productionPaymentsEnabled,
      payments_enabled: paymentsEnabled,
      credential_environment: validEnvironment ? configuredEnvironment : 'unconfirmed',
      environment_confirmed: environmentConfirmed,
      environment_conflict: environmentConflict,
      environment_evidence: [
        validEnvironment ? `server_config=${configuredEnvironment}` : 'server_config=invalid_or_missing',
        `provider_api_reachable=${providerReachable}`,
        `provider_test_user=${isTestUser}`,
        `webhook_secret_configured=${webhookSecretConfigured}`,
      ],
      provider_user_id: providerUser?.id || null,
      provider_site_id: providerUser?.site_id || null,
      pix_allowed: paymentsEnabled,
      pix_enabled: paymentsEnabled,
      card_enabled: false,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'BILLING_HEALTH_FAILED' }, 500);
  }
});
