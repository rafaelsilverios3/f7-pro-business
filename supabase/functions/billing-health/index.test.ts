import { handleBillingHealthRequest } from './index.ts';

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_A = '11111111-1111-4111-8111-111111111111';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assert(condition: unknown) {
  if (!condition) throw new Error('Assertion failed');
}

function fakeAdmin({
  user = { id: USER_A },
  membership = { role: 'admin', active: true } as { role: string; active: boolean } | null,
  membershipError = null as Error | null,
} = {}) {
  const query = {
    filters: [] as Array<[string, unknown]>,
    select() { return this; },
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; },
    async maybeSingle() { return { data: membership, error: membershipError }; },
  };
  return {
    query,
    client: {
      auth: { async getUser(token: string) { return token === 'valid' ? { data: { user }, error: null } : { data: { user: null }, error: new Error('invalid') }; } },
      from(table: string) { assertEquals(table, 'company_users'); return query; },
    },
  };
}

function request({ token = 'valid', companyId = COMPANY_A, method = 'GET' } = {}) {
  return new Request(`https://edge.test/billing-health${companyId ? `?company_id=${companyId}` : ''}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function env(values: Record<string, string>) {
  return (key: string) => values[key];
}

Deno.test('billing-health requires a valid JWT before evaluating tenant data', async () => {
  const { client } = fakeAdmin();
  const noAuth = await handleBillingHealthRequest(request({ token: '' }), { adminClient: client });
  assertEquals(noAuth.status, 401);
  const invalid = await handleBillingHealthRequest(request({ token: 'invalid' }), { adminClient: client });
  assertEquals(invalid.status, 401);
});

Deno.test('billing-health requires a company id and denies non-authorized company roles', async () => {
  const { client } = fakeAdmin({ membership: { role: 'vendedor', active: true } });
  const missingCompany = await handleBillingHealthRequest(request({ companyId: '' }), { adminClient: client });
  assertEquals(missingCompany.status, 422);
  const denied = await handleBillingHealthRequest(request(), { adminClient: client });
  assertEquals(denied.status, 403);
});

Deno.test('billing-health denies inactive membership and does not query the provider', async () => {
  const { client } = fakeAdmin({ membership: { role: 'admin', active: false } });
  let providerCalls = 0;
  const response = await handleBillingHealthRequest(request(), {
    adminClient: client,
    getEnv: env({ MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-test-token', MERCADO_PAGO_WEBHOOK_SECRET: 'configured' }),
    providerFetch: async () => { providerCalls++; return new Response('{}'); },
  });
  assertEquals(response.status, 403);
  assertEquals(providerCalls, 0);
});

Deno.test('billing-health denies another tenant when caller has no membership there', async () => {
  const { client, query } = fakeAdmin({ membership: null });
  let providerCalls = 0;
  const response = await handleBillingHealthRequest(request({ companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), {
    adminClient: client,
    getEnv: env({ MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-test-token', MERCADO_PAGO_WEBHOOK_SECRET: 'configured' }),
    providerFetch: async () => { providerCalls++; return Response.json({}); },
  });
  assertEquals(response.status, 403);
  assertEquals(query.filters, [['company_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], ['user_id', USER_A]]);
  assertEquals(providerCalls, 0);
});

Deno.test('billing-health checks exact authenticated tenant and returns only operational fields', async () => {
  const { client, query } = fakeAdmin();
  let providerCalls = 0;
  const response = await handleBillingHealthRequest(request(), {
    adminClient: client,
    getEnv: env({
      MERCADO_PAGO_ENVIRONMENT: 'test',
      MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-test-token',
      MERCADO_PAGO_WEBHOOK_SECRET: 'configured',
    }),
    providerFetch: async (url, init) => {
      providerCalls++;
      assertEquals(String(url), 'https://api.mercadolibre.com/users/me');
      assertEquals(new Headers(init?.headers).get('Authorization'), 'Bearer APP_USR-test-token');
      return Response.json({ id: 987654321, site_id: 'MLB', tags: ['test_user'], email: 'private@example.test' });
    },
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(providerCalls, 1);
  assertEquals(query.filters, [['company_id', COMPANY_A], ['user_id', USER_A]]);
  assertEquals(body, {
    provider: 'mercado_pago',
    environment: 'test',
    state: 'ready',
    payments_enabled: true,
    pix_allowed: true,
    card_enabled: false,
  });
  assert(!JSON.stringify(body).includes('987654321'));
  assert(!JSON.stringify(body).includes('private@example.test'));
});

Deno.test('billing-health fails closed when membership lookup fails', async () => {
  const { client } = fakeAdmin({ membershipError: new Error('private database detail') });
  const response = await handleBillingHealthRequest(request(), { adminClient: client });
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: 'AUTHORIZATION_CHECK_FAILED' });
});

Deno.test('homologation never probes production provider credentials', async () => {
  const { client } = fakeAdmin();
  Deno.env.set('SUPABASE_URL', 'https://vwylnjmapixtzhryiutt.supabase.co');
  let providerCalls = 0;
  const response = await handleBillingHealthRequest(request(), {
    adminClient: client,
    getEnv: env({
      MERCADO_PAGO_ENVIRONMENT: 'production',
      MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-secret',
      MERCADO_PAGO_WEBHOOK_SECRET: 'configured',
      MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: 'true',
    }),
    providerFetch: async () => { providerCalls++; return Response.json({ id: 42 }); },
  });
  assertEquals(response.status, 200);
  assertEquals(providerCalls, 0);
  assertEquals(await response.json(), {
    provider: 'mercado_pago',
    environment: 'production',
    state: 'payments_disabled',
    payments_enabled: false,
    pix_allowed: false,
    card_enabled: false,
  });
});

Deno.test('production identity in test mode fails closed without exposing account details', async () => {
  const { client } = fakeAdmin();
  let providerCalls = 0;
  const response = await handleBillingHealthRequest(request(), {
    adminClient: client,
    getEnv: env({ MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-wrong-environment', MERCADO_PAGO_WEBHOOK_SECRET: 'configured' }),
    providerFetch: async () => { providerCalls++; return Response.json({ id: 42, site_id: 'MLB', tags: ['normal'] }); },
  });
  assertEquals(response.status, 200);
  assertEquals(providerCalls, 1);
  assertEquals(await response.json(), {
    provider: 'mercado_pago',
    environment: 'test',
    state: 'configuration_required',
    payments_enabled: false,
    pix_allowed: false,
    card_enabled: false,
  });
});
