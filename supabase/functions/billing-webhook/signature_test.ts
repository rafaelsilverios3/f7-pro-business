import { validateSignature } from './index.ts';

function sign(secret: string, dataId: string, requestId: string, timestamp: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:${dataId};request-id:${requestId};ts:${timestamp};`)))
    .then((bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''));
}

Deno.test('Mercado Pago webhook HMAC validates the received and documented lowercase ID canonicalizations', async () => {
  const secret = 'local-signature-test-only';
  const previousSecret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET');
  const previousEnvironment = Deno.env.get('MERCADO_PAGO_ENVIRONMENT');
  Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', secret);
  Deno.env.set('MERCADO_PAGO_ENVIRONMENT', 'test');

  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestId = 'signature-case-regression';
    for (const dataId of ['ORDTST01AB23', 'Order-Test-Aa19', 'ordtst01ab23']) {
      const digest = await sign(secret, dataId, requestId, timestamp);
      const request = new Request(`https://local.invalid/functions/v1/billing-webhook?data.id=${encodeURIComponent(dataId)}`, {
        method: 'POST',
        headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${digest}` },
      });
      const result = await validateSignature(request, {});
      if (!result.valid || result.dataId !== dataId) throw new Error('original-case webhook signature was rejected');
    }

    const alphanumericId = 'ORDTST01AB23';
    const normalizedDigest = await sign(secret, alphanumericId.toLowerCase(), requestId, timestamp);
    const normalizedRequest = new Request(`https://local.invalid/functions/v1/billing-webhook?data.id=${encodeURIComponent(alphanumericId)}`, {
      method: 'POST',
      headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${normalizedDigest}` },
    });
    const normalizedResult = await validateSignature(normalizedRequest, {});
    if (!normalizedResult.valid || normalizedResult.dataId !== alphanumericId) throw new Error('documented lowercase HMAC canonicalization was rejected or changed the original resource ID');

    const punctuatedId = 'Order-Test-Aa19';
    const punctuatedDigest = await sign(secret, punctuatedId.toLowerCase(), requestId, timestamp);
    const punctuatedRequest = new Request(`https://local.invalid/functions/v1/billing-webhook?data.id=${encodeURIComponent(punctuatedId)}`, {
      method: 'POST',
      headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${punctuatedDigest}` },
    });
    const punctuatedResult = await validateSignature(punctuatedRequest, {});
    if (punctuatedResult.valid) throw new Error('lowercase fallback was applied to an ID outside the documented alphanumeric form');
  } finally {
    if (previousSecret === undefined) Deno.env.delete('MERCADO_PAGO_WEBHOOK_SECRET');
    else Deno.env.set('MERCADO_PAGO_WEBHOOK_SECRET', previousSecret);
    if (previousEnvironment === undefined) Deno.env.delete('MERCADO_PAGO_ENVIRONMENT');
    else Deno.env.set('MERCADO_PAGO_ENVIRONMENT', previousEnvironment);
  }
});
