import { sendWhatsAppText } from './whatsappOutbound.ts';

Deno.test('WhatsApp outbound without server token fails before outbox mutation or Graph call', async () => {
  const previous = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const previousEnabled = Deno.env.get('WHATSAPP_SEND_ENABLED');
  const previousProviderEnabled = Deno.env.get('WHATSAPP_PROVIDER_ENABLED');
  Deno.env.set('WHATSAPP_PROVIDER_ENABLED', 'true');
  Deno.env.set('WHATSAPP_SEND_ENABLED', 'true');
  Deno.env.delete('WHATSAPP_ACCESS_TOKEN');
  const tableWrites: string[] = [];
  const sb = {
    from(table: string) {
      return {
        insert: async () => { tableWrites.push(table); return { error: null }; },
      };
    },
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error('provider must not be called'); };
  try {
    const result = await sendWhatsAppText({
      sb,
      conversation: { id: crypto.randomUUID(), company_id: crypto.randomUUID(), lead_phone: '+5511999999999', channel: 'whatsapp' },
      message: 'Teste sintético sem envio',
      sender_type: 'user',
      request_id: crypto.randomUUID(),
    });
    if (result.ok || result.code !== 'PROVIDER_NOT_CONFIGURED' || result.status !== 503) throw new Error('missing provider configuration did not fail closed');
    if (fetchCount !== 0) throw new Error('WhatsApp provider was called without credentials');
    if (tableWrites.some((table) => table === 'whatsapp_outbox' || table === 'messages')) throw new Error('missing token mutated the outbound queue or message history');
    if (tableWrites.length !== 1 || tableWrites[0] !== 'integration_logs') throw new Error('sanitized failure audit was not the only database write');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous !== undefined) Deno.env.set('WHATSAPP_ACCESS_TOKEN', previous);
    if (previousEnabled !== undefined) Deno.env.set('WHATSAPP_SEND_ENABLED', previousEnabled); else Deno.env.delete('WHATSAPP_SEND_ENABLED');
    if (previousProviderEnabled !== undefined) Deno.env.set('WHATSAPP_PROVIDER_ENABLED', previousProviderEnabled); else Deno.env.delete('WHATSAPP_PROVIDER_ENABLED');
  }
});

Deno.test('WhatsApp outbound with a token stays disabled unless the explicit send flag is true', async () => {
  const previous = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const previousEnabled = Deno.env.get('WHATSAPP_SEND_ENABLED');
  const previousProviderEnabled = Deno.env.get('WHATSAPP_PROVIDER_ENABLED');
  Deno.env.set('WHATSAPP_ACCESS_TOKEN', 'local-fake-token-never-used');
  Deno.env.set('WHATSAPP_PROVIDER_ENABLED', 'true');
  Deno.env.delete('WHATSAPP_SEND_ENABLED');
  let fetchCount = 0;
  const writes: string[] = [];
  const sb = { from(table: string) { return { insert: async () => { writes.push(table); return { error: null }; } }; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error('provider must remain disabled'); };
  try {
    const result = await sendWhatsAppText({
      sb, conversation: { id: crypto.randomUUID(), company_id: crypto.randomUUID(), lead_phone: '+5511999999999', channel: 'whatsapp' },
      message: 'Teste local bloqueado', sender_type: 'user', request_id: crypto.randomUUID(),
    });
    if (result.ok || result.code !== 'OUTBOUND_DISABLED' || result.status !== 503) throw new Error('outbound flag did not fail closed');
    if (fetchCount !== 0 || writes.some((table) => table === 'whatsapp_outbox' || table === 'messages')) throw new Error('disabled outbound reached the provider or changed message data');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) Deno.env.delete('WHATSAPP_ACCESS_TOKEN'); else Deno.env.set('WHATSAPP_ACCESS_TOKEN', previous);
    if (previousEnabled === undefined) Deno.env.delete('WHATSAPP_SEND_ENABLED'); else Deno.env.set('WHATSAPP_SEND_ENABLED', previousEnabled);
    if (previousProviderEnabled === undefined) Deno.env.delete('WHATSAPP_PROVIDER_ENABLED'); else Deno.env.set('WHATSAPP_PROVIDER_ENABLED', previousProviderEnabled);
  }
});

Deno.test('WhatsApp send stays blocked when only the granular send flag is enabled', async () => {
  const previous = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const previousEnabled = Deno.env.get('WHATSAPP_SEND_ENABLED');
  const previousProviderEnabled = Deno.env.get('WHATSAPP_PROVIDER_ENABLED');
  Deno.env.set('WHATSAPP_ACCESS_TOKEN', 'local-fake-token-never-used');
  Deno.env.set('WHATSAPP_SEND_ENABLED', 'true');
  Deno.env.delete('WHATSAPP_PROVIDER_ENABLED');
  let fetchCount = 0;
  const writes: string[] = [];
  const sb = { from(table: string) { return { insert: async () => { writes.push(table); return { error: null }; } }; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error('provider must remain disabled'); };
  try {
    const result = await sendWhatsAppText({ sb, conversation: { id: crypto.randomUUID(), company_id: crypto.randomUUID(), lead_phone: '+5511999999999', channel: 'whatsapp' }, message: 'Teste sintético', sender_type: 'user' });
    if (result.ok || result.code !== 'WHATSAPP_PROVIDER_DISABLED' || result.status !== 503) throw new Error('global provider gate was bypassed');
    if (fetchCount !== 0 || writes.some((table) => table === 'whatsapp_outbox' || table === 'messages')) throw new Error('provider gate did not precede provider and message writes');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) Deno.env.delete('WHATSAPP_ACCESS_TOKEN'); else Deno.env.set('WHATSAPP_ACCESS_TOKEN', previous);
    if (previousEnabled === undefined) Deno.env.delete('WHATSAPP_SEND_ENABLED'); else Deno.env.set('WHATSAPP_SEND_ENABLED', previousEnabled);
    if (previousProviderEnabled === undefined) Deno.env.delete('WHATSAPP_PROVIDER_ENABLED'); else Deno.env.set('WHATSAPP_PROVIDER_ENABLED', previousProviderEnabled);
  }
});
