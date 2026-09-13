import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const sb = admin();
    const jwt = auth(req);
    const { data } = await sb.auth.getUser(jwt);
    if (!data?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({
      provider: 'mercado_pago',
      environment: Deno.env.get('MERCADO_PAGO_ENVIRONMENT') || 'test',
      access_token_configured: Boolean(Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN')),
      webhook_secret_configured: Boolean(Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET')),
      pix_enabled: Boolean(Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN')),
      card_enabled: false,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return json({ code: 'AUTH_REQUIRED' }, 401);
    return json({ code: 'BILLING_HEALTH_FAILED' }, 500);
  }
});
