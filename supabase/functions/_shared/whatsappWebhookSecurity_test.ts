import { getWhatsAppWebhookChallenge, verifyWhatsAppWebhookSignature } from './whatsappWebhookSecurity.ts';

Deno.test('WhatsApp webhook signature fails closed for absent secret and malformed digest', async () => {
  const body = '{"entry":[]}';
  assertEquals(await verifyWhatsAppWebhookSignature(null, body, null), false);
  assertEquals(await verifyWhatsAppWebhookSignature('sha256=', body, 'synthetic-secret'), false);
  assertEquals(await verifyWhatsAppWebhookSignature(`sha256=${'a'.repeat(63)}`, body, 'synthetic-secret'), false);
});

Deno.test('WhatsApp webhook HMAC accepts only a valid signature for the exact payload', async () => {
  const body = '{"entry":[{"id":"synthetic"}]}';
  const secret = 'synthetic-only-secret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(signed)].map((value) => value.toString(16).padStart(2, '0')).join('');
  assertEquals(await verifyWhatsAppWebhookSignature(`sha256=${hex}`, body, secret), true);
  assertEquals(await verifyWhatsAppWebhookSignature(`sha256=${hex}`, `${body} `, secret), false);
  assertEquals(await verifyWhatsAppWebhookSignature(`sha256=${hex}`, body, null), false);
});

Deno.test('WhatsApp webhook verification does not accept an unset or empty token', () => {
  const url = new URL('https://example.test/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=synthetic');
  assertEquals(getWhatsAppWebhookChallenge(url, null), null);
  assertEquals(getWhatsAppWebhookChallenge(url, ''), null);
  assertEquals(getWhatsAppWebhookChallenge(url, 'configured'), null);
  url.searchParams.set('hub.verify_token', 'configured');
  assertEquals(getWhatsAppWebhookChallenge(url, 'configured'), 'synthetic');
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}; received ${String(actual)}`);
}
