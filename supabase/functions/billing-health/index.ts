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
    let providerReachable = false;
    let providerUser: any = null;
    if (token) {
      const response = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` } });
      providerReachable = response.ok;
      providerUser = response.ok ? await response.json().catch(() => null) : null;
    }
    const isTestUser = Array.isArray(providerUser?.tags) && providerUser.tags.includes('test_user');
    return json({
      provider: 'mercado_pago',
      environment: Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || 'test',
      access_token_configured: Boolean(token),
      webhook_secret_configured: Boolean(Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET')),
      provider_reachable: providerReachable,
      credential_environment: isTestUser ? 'sandbox' : 'unconfirmed',
      environment_confirmed: isTestUser,
      provider_user_id: providerUser?.id || null,
      provider_site_id: providerUser?.site_id || null,
      pix_enabled: Boolean(token && isTestUser),
      card_enabled: false,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'BILLING_HEALTH_FAILED' }, 500);
  }
});
