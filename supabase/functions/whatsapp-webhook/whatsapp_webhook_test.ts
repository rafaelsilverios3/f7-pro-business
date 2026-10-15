import { handleWhatsAppWebhookRequest } from './index.ts';

Deno.test('WhatsApp webhook stays inert when receiving is not explicitly enabled', async () => {
  const previous = Deno.env.get('WHATSAPP_RECEIVE_ENABLED');
  Deno.env.delete('WHATSAPP_RECEIVE_ENABLED');
  let databaseTouched = false;
  try {
    const response = await handleWhatsAppWebhookRequest(new Request('https://local.invalid/functions/v1/whatsapp-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    }), { adminClient: { from() { databaseTouched = true; throw new Error('database must remain untouched'); } } });
    const payload = await response.json();
    if (response.status !== 503 || payload.error !== 'WHATSAPP_RECEIVE_DISABLED') throw new Error('webhook was not clearly disabled');
    if (databaseTouched) throw new Error('disabled webhook accessed the database');
  } finally {
    if (previous === undefined) Deno.env.delete('WHATSAPP_RECEIVE_ENABLED'); else Deno.env.set('WHATSAPP_RECEIVE_ENABLED', previous);
  }
});

Deno.test('WhatsApp webhook preflight remains available while receiving is disabled', async () => {
  const previous = Deno.env.get('WHATSAPP_RECEIVE_ENABLED');
  Deno.env.delete('WHATSAPP_RECEIVE_ENABLED');
  try {
    const response = await handleWhatsAppWebhookRequest(new Request('https://local.invalid/functions/v1/whatsapp-webhook', { method: 'OPTIONS' }));
    if (response.status !== 200 || !response.headers.get('access-control-allow-origin')) throw new Error('webhook CORS preflight was blocked');
  } finally {
    if (previous === undefined) Deno.env.delete('WHATSAPP_RECEIVE_ENABLED'); else Deno.env.set('WHATSAPP_RECEIVE_ENABLED', previous);
  }
});

Deno.test('WhatsApp webhook remains disabled when only the receive flag is enabled', async () => {
  const previousProviderEnabled = Deno.env.get('WHATSAPP_PROVIDER_ENABLED');
  const previousReceiveEnabled = Deno.env.get('WHATSAPP_RECEIVE_ENABLED');
  Deno.env.delete('WHATSAPP_PROVIDER_ENABLED');
  Deno.env.set('WHATSAPP_RECEIVE_ENABLED', 'true');
  let databaseTouched = false;
  try {
    const response = await handleWhatsAppWebhookRequest(new Request('https://local.invalid/functions/v1/whatsapp-webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }), { adminClient: { from() { databaseTouched = true; throw new Error('database must remain untouched'); } } });
    if (response.status !== 503 || (await response.json()).error !== 'WHATSAPP_RECEIVE_DISABLED') throw new Error('global provider gate was bypassed');
    if (databaseTouched) throw new Error('webhook reached the database while provider gate was disabled');
  } finally {
    if (previousProviderEnabled === undefined) Deno.env.delete('WHATSAPP_PROVIDER_ENABLED'); else Deno.env.set('WHATSAPP_PROVIDER_ENABLED', previousProviderEnabled);
    if (previousReceiveEnabled === undefined) Deno.env.delete('WHATSAPP_RECEIVE_ENABLED'); else Deno.env.set('WHATSAPP_RECEIVE_ENABLED', previousReceiveEnabled);
  }
});
