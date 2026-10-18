import { handleIntegrationHealthRequest } from './index.ts';

Deno.test('integration health does not probe Meta when provider gates are absent', async () => {
  const envNames = ['WHATSAPP_PROVIDER_ENABLED', 'WHATSAPP_SEND_ENABLED', 'WHATSAPP_RECEIVE_ENABLED'];
  const prior = new Map(envNames.map((name) => [name, Deno.env.get(name)]));
  for (const name of envNames) Deno.env.delete(name);
  const companyId = crypto.randomUUID();
  const tables: Record<string, unknown[]> = {
    company_users: [{ company_id: companyId, role: 'admin', active: true }],
    company_integrations: [{ company_id: companyId, provider: 'whatsapp', status: 'connected', external_phone_id: '1234567890' }],
    integration_logs: [],
    messages: [],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: crypto.randomUUID() } } }) },
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        order: () => builder,
        limit: async () => ({ data: tables[table] || [], error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error('Meta must not be queried while disabled'); };
  try {
    const response = await handleIntegrationHealthRequest(new Request('https://local.invalid/functions/v1/integration-health', {
      method: 'POST', headers: { authorization: 'Bearer local-test-jwt', 'content-type': 'application/json' }, body: JSON.stringify({ company_id: companyId }),
    }), { adminClient: client });
    const payload = await response.json();
    const health = payload.integrations?.[0]?.whatsapp;
    if (response.status !== 200 || !health) throw new Error('health response was not returned');
    if (health.provider !== 'disabled' || health.provider_enabled !== false || health.send !== 'disabled' || health.receive !== 'disabled') throw new Error('health reported an inactive WhatsApp capability as enabled');
    if (fetchCount !== 0) throw new Error('health performed an unsolicited Meta request');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of prior) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); }
  }
});
