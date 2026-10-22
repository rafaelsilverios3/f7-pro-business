import { admin, json } from './core.ts';

const encoder = new TextEncoder();
function fromHex(value: string) { return new Uint8Array(value.match(/.{2}/g)!.map((item) => Number.parseInt(item, 16))); }
function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function verify(secret: string, signature: string, requestId: string, dataId: string) {
  let ts = ''; let v1 = '';
  for (const part of signature.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 'ts') ts = value || '';
    if (key === 'v1') v1 = value || '';
  }
  if (!/^\d{10,13}$/.test(ts) || !/^[a-f0-9]{64}$/i.test(v1) || !requestId || !dataId) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(manifest)));
  return constantTimeEqual(expected, fromHex(v1));
}
function minor(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}
async function dispatchFoodOutbox() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceKey) return { status: 'not_configured' };
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/product-license-dispatch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { status: 'processed', processed: Number(body.processed || 0) }
      : { status: 'pending', code: String(body.error || `HTTP_${response.status}`).slice(0, 80) };
  } catch {
    return { status: 'pending', code: 'DELIVERY_REQUEST_FAILED' };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('MP_PRODUCT_WEBHOOK_SECRET') || '';
  const accessToken = Deno.env.get('MP_TEST_ACCESS_TOKEN') || '';
  if (secret.length < 32 || !/^TEST-/.test(accessToken)) return json({ error: 'SANDBOX_WEBHOOK_NOT_CONFIGURED' }, 503);
  const url = new URL(req.url);
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('id') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const signature = req.headers.get('x-signature') || '';
  if (!await verify(secret, signature, requestId, dataId)) return json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const notification = await req.json().catch(() => ({}));
  const paymentId = String(dataId || notification.data?.id || '');
  if (!/^\d{1,30}$/.test(paymentId)) return json({ error: 'INVALID_PAYMENT_REFERENCE' }, 422);
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000),
  });
  if (!paymentResponse.ok) return json({ error: 'PAYMENT_PROVIDER_LOOKUP_FAILED' }, 502);
  const payment = await paymentResponse.json();
  if (String(payment.id) !== paymentId) return json({ error: 'PAYMENT_ID_MISMATCH' }, 422);
  const service = admin();
  const checkoutId = String(payment.external_reference || '');
  if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) return json({ error: 'CHECKOUT_REFERENCE_INVALID' }, 422);
  const sessionResult = await service.from('product_checkout_sessions')
    .select('id,offer_id,product_key,amount_minor,currency,status,provider,provider_checkout_id')
    .eq('id', checkoutId).maybeSingle();
  if (sessionResult.error) throw sessionResult.error;
  const session = sessionResult.data;
  if (!session || session.provider !== 'mercado_pago' || !session.provider_checkout_id) return json({ error: 'CHECKOUT_NOT_FOUND' }, 404);
  const preferenceResponse = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(session.provider_checkout_id)}`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000),
  });
  if (!preferenceResponse.ok) return json({ error: 'PREFERENCE_PROVIDER_LOOKUP_FAILED' }, 502);
  const preference = await preferenceResponse.json();
  const preferenceAmount = Array.isArray(preference.items)
    ? preference.items.reduce((sum: number, item: any) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0), 0)
    : Number.NaN;
  if (preference.external_reference !== session.id || minor(preferenceAmount) !== Number(session.amount_minor)
      || String(preference.currency_id || '').toUpperCase() !== String(session.currency).toUpperCase()
      || (payment.collector_id && preference.collector_id && String(payment.collector_id) !== String(preference.collector_id))) {
    return json({ error: 'CHECKOUT_VALUE_OR_MERCHANT_MISMATCH' }, 422);
  }
  const paymentAmount = minor(payment.transaction_amount);
  const eventId = `payment:${paymentId}:${String(payment.status || 'unknown')}`;
  if (payment.status === 'approved') {
    const result = await service.rpc('confirm_product_test_checkout_payment', {
      p_provider_event_id: eventId,
      p_checkout_id: session.id,
      p_provider_payment_id: paymentId,
      p_amount_minor: paymentAmount,
      p_currency: payment.currency_id,
    });
    if (result.error) throw result.error;
    if (['paid', 'already_paid'].includes(String(result.data?.status))) {
      return json({ ...result.data, food_delivery: await dispatchFoodOutbox() });
    }
    return json(result.data);
  }
  if (['refunded', 'charged_back', 'cancelled', 'rejected', 'pending', 'in_process'].includes(String(payment.status))) {
    const result = await service.rpc('reconcile_product_test_payment_status', {
      p_provider_event_id: eventId,
      p_checkout_id: session.id,
      p_provider_payment_id: paymentId,
      p_provider_status: payment.status,
    });
    if (result.error) throw result.error;
    if (result.data?.status === 'reconciled') {
      return json({ ...result.data, food_delivery: await dispatchFoodOutbox() });
    }
    return json(result.data);
  }
  return json({ status: 'provider_status_not_processed' });
});
