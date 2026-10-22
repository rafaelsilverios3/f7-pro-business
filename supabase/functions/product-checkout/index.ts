import { admin, auth, corsHeaders, json, userClient } from './core.ts';

const APP_ORIGIN = 'https://f7business.com.br';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const jwt = auth(req);
    const service = admin();
    const identity = await service.auth.getUser(jwt);
    if (identity.error || !identity.data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
    const actor = identity.data.user;
    const input = await req.json();
    const accountId = String(input.commercial_account_id || '');
    const offerId = String(input.offer_id || '');
    const key = String(input.idempotency_key || crypto.randomUUID());
    if (!/^[0-9a-f-]{36}$/i.test(accountId) || !/^[0-9a-f-]{36}$/i.test(offerId) || !/^[0-9a-f-]{36}$/i.test(key)) {
      return json({ error: 'INVALID_CHECKOUT_INPUT' }, 422);
    }
    const membership = await service.from('commercial_account_members').select('role,active')
      .eq('commercial_account_id', accountId).eq('user_id', actor.id).eq('active', true).maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data || !['owner', 'admin', 'billing'].includes(membership.data.role)) return json({ error: 'COMMERCIAL_BILLING_PERMISSION_REQUIRED' }, 403);
    const user = userClient(jwt);
    const prepared = await user.rpc('prepare_product_checkout', { p_account_id: accountId, p_offer_id: offerId, p_idempotency_key: key });
    if (prepared.error) throw prepared.error;
    const session = prepared.data;
    const settings = await service.from('product_checkout_settings').select('live_charges_enabled,test_checkout_enabled').eq('singleton', true).single();
    if (settings.error) throw settings.error;
    if (settings.data.live_charges_enabled) return json({ checkout_id: session.id, status: session.status, live_charges_enabled: true, checkout_url: null, reason: 'LIVE_CHARGES_DISABLED_IN_THIS_FLOW' });
    if (!settings.data.test_checkout_enabled) return json({ checkout_id: session.id, status: session.status, live_charges_enabled: false, checkout_url: null, reason: 'SANDBOX_CHECKOUT_NOT_ENABLED' });
    const token = Deno.env.get('MP_TEST_ACCESS_TOKEN');
    const notificationUrl = Deno.env.get('MP_PRODUCT_WEBHOOK_URL');
    if (!token || !/^TEST-/.test(token) || !notificationUrl?.startsWith('https://')) {
      return json({ checkout_id: session.id, status: session.status, live_charges_enabled: false, checkout_url: null, reason: 'SANDBOX_CREDENTIALS_NOT_CONFIGURED' }, 503);
    }
    if (session.amount_minor <= 0) return json({ checkout_id: session.id, status: session.status, live_charges_enabled: false, checkout_url: null, reason: 'ZERO_VALUE_OFFER_HAS_NO_PAYMENT' }, 422);
    if (session.provider_checkout_id) {
      const preference = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(session.provider_checkout_id)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      if (preference.ok) {
        const body = await preference.json();
        if (body.external_reference === session.id && body.sandbox_init_point) return json({ checkout_id: session.id, status: 'pending', live_charges_enabled: false, checkout_url: body.sandbox_init_point });
      }
    }
    const offerResult = await service.from('product_offers').select('name,description').eq('id', offerId).single();
    if (offerResult.error) throw offerResult.error;
    const preferenceResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: offerId, title: offerResult.data.name, description: offerResult.data.description || undefined, quantity: 1, currency_id: session.currency, unit_price: session.amount_minor / 100 }],
        external_reference: session.id,
        notification_url: notificationUrl,
        back_urls: { success: `${APP_ORIGIN}/checkout/retorno`, pending: `${APP_ORIGIN}/checkout/retorno`, failure: `${APP_ORIGIN}/checkout/retorno` },
        metadata: { checkout_id: session.id, product_key: session.product_key, mode: 'sandbox' },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!preferenceResponse.ok) return json({ error: 'SANDBOX_PREFERENCE_FAILED' }, 502);
    const preference = await preferenceResponse.json();
    if (!preference.id || preference.external_reference !== session.id || !preference.sandbox_init_point) return json({ error: 'SANDBOX_PREFERENCE_INVALID' }, 502);
    const saved = await service.from('product_checkout_sessions').update({ provider: 'mercado_pago', provider_checkout_id: String(preference.id), status: 'pending', updated_at: new Date().toISOString() }).eq('id', session.id).eq('commercial_account_id', accountId);
    if (saved.error) throw saved.error;
    return json({ checkout_id: session.id, status: 'pending', live_charges_enabled: false, checkout_url: preference.sandbox_init_point });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PRODUCT_CHECKOUT_FAILED';
    const status = message.includes('AUTH_REQUIRED') ? 401 : message.includes('FORBIDDEN') ? 403 : 500;
    return json({ error: message.slice(0, 120) }, status);
  }
});
