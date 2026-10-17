import { hasInternalServiceAuthorization } from './mercadolivreWorkerAuth.ts';

Deno.test('worker accepts only the exact server-side service bearer', () => {
  const secret = 'synthetic-service-key-never-used-remotely';
  const valid = new Request('https://unit.test/worker', { headers: { authorization: `Bearer ${secret}` } });
  const user = new Request('https://unit.test/worker', { headers: { authorization: 'Bearer synthetic-user-jwt' } });
  const wrong = new Request('https://unit.test/worker', { headers: { authorization: `bearer ${secret}` } });
  const empty = new Request('https://unit.test/worker');
  if (!hasInternalServiceAuthorization(valid, secret)) throw new Error('Expected exact server service bearer to pass');
  if (hasInternalServiceAuthorization(user, secret) || hasInternalServiceAuthorization(wrong, secret) || hasInternalServiceAuthorization(empty, '')) {
    throw new Error('Expected non-service requests to be denied');
  }
});
