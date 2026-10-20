import { getMercadoPagoCredentialIdentity, verifyMercadoPagoCredentialEnvironment } from './mercadoPagoCredentials.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('Orders APP_USR test credential is accepted only when provider identity is a Brazilian test user', async () => {
  let calls = 0;
  const result = await verifyMercadoPagoCredentialEnvironment(
    'APP_USR-synthetic-test-token',
    'test',
    async (input, init) => {
      calls += 1;
      assertEquals(String(input), 'https://api.mercadolibre.com/users/me');
      assertEquals(new Headers(init?.headers).get('Authorization'), 'Bearer APP_USR-synthetic-test-token');
      assertEquals(init?.method, 'GET');
      return Response.json({ id: 123, site_id: 'MLB', tags: ['normal', 'test_user'] });
    },
  );
  assertEquals(result, 'verified');
  assertEquals(calls, 1);
});

Deno.test('verified Mercado Pago identity returns only the provider seller ID needed for resource binding', async () => {
  const result = await getMercadoPagoCredentialIdentity('APP_USR-synthetic-test-token', 'test', async () =>
    Response.json({ id: 123456789, site_id: 'MLB', tags: ['test_user'] }));
  assertEquals(result, { check: 'verified', sellerId: '123456789' });
});

Deno.test('malformed Mercado Pago seller identity fails closed', async () => {
  const result = await getMercadoPagoCredentialIdentity('synthetic', 'test', async () =>
    Response.json({ id: 'seller-unknown', site_id: 'MLB', tags: ['test_user'] }));
  assertEquals(result, { check: 'mismatch', sellerId: null });
});

Deno.test('production account token is rejected in test mode regardless of APP_USR prefix', async () => {
  const result = await verifyMercadoPagoCredentialEnvironment(
    'APP_USR-synthetic-production-token',
    'test',
    async () => Response.json({ id: 456, site_id: 'MLB', tags: ['normal'] }),
  );
  assertEquals(result, 'mismatch');
});

Deno.test('test user is rejected when production mode is expected', async () => {
  const result = await verifyMercadoPagoCredentialEnvironment(
    'APP_USR-synthetic-test-token',
    'production',
    async () => Response.json({ id: 123, site_id: 'MLB', tags: ['test_user'] }),
  );
  assertEquals(result, 'mismatch');
});

Deno.test('ordinary Brazilian seller is accepted only for production mode', async () => {
  const result = await verifyMercadoPagoCredentialEnvironment(
    'synthetic-provider-token-without-assumed-prefix',
    'production',
    async () => Response.json({ id: 789, site_id: 'MLB', tags: ['normal'] }),
  );
  assertEquals(result, 'verified');
});

Deno.test('missing token and invalid environment fail closed without provider requests', async () => {
  let calls = 0;
  const providerFetch: typeof fetch = async () => {
    calls += 1;
    return Response.json({ id: 1, site_id: 'MLB', tags: ['test_user'] });
  };
  assertEquals(await verifyMercadoPagoCredentialEnvironment('', 'test', providerFetch), 'mismatch');
  assertEquals(await verifyMercadoPagoCredentialEnvironment('synthetic', 'invalid', providerFetch), 'mismatch');
  assertEquals(calls, 0);
});

Deno.test('invalid provider credential and unverifiable identity fail closed', async () => {
  assertEquals(
    await verifyMercadoPagoCredentialEnvironment('synthetic-invalid', 'test', async () => new Response(null, { status: 401 })),
    'mismatch',
  );
  assertEquals(
    await verifyMercadoPagoCredentialEnvironment('synthetic', 'test', async () => Response.json({ id: 1, site_id: 'MLB' })),
    'mismatch',
  );
  assertEquals(
    await verifyMercadoPagoCredentialEnvironment('synthetic', 'test', async () => new Response('{}', { status: 503 })),
    'unavailable',
  );
  assertEquals(
    await verifyMercadoPagoCredentialEnvironment('synthetic', 'test', async () => { throw new Error('network unavailable'); }),
    'unavailable',
  );
});

Deno.test('non-Brazilian test account is not accepted for the BRL Orders checkout', async () => {
  const result = await verifyMercadoPagoCredentialEnvironment(
    'APP_USR-synthetic-test-token',
    'test',
    async () => Response.json({ id: 123, site_id: 'MLA', tags: ['test_user'] }),
  );
  assertEquals(result, 'mismatch');
});
