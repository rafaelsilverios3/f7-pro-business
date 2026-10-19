const LOCAL_MOCK_HOST = 'ai-mock-provider';
const LOCAL_MOCK_PORT = '57443';
const LOCAL_MOCK_CA_ENV = 'AI_LOCAL_MOCK_TLS_CA_B64';

/**
 * Local-only TLS trust for the synthetic provider used by the Windows/Docker
 * homologation stack. The override is deliberately scoped to that exact
 * HTTPS host and port; production provider requests always use normal Deno
 * certificate validation because this variable is absent there.
 */
export function createAIProviderHttpClient(endpoint: string): Deno.HttpClient | null {
  const encoded = Deno.env.get(LOCAL_MOCK_CA_ENV)?.trim();
  if (!encoded) return null;

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('AI_LOCAL_MOCK_CA_ENDPOINT_INVALID');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== LOCAL_MOCK_HOST || parsed.port !== LOCAL_MOCK_PORT) {
    throw new Error('AI_LOCAL_MOCK_CA_SCOPE_INVALID');
  }

  let pem: string;
  try {
    pem = new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
  } catch {
    throw new Error('AI_LOCAL_MOCK_CA_INVALID');
  }

  if (!pem.includes('-----BEGIN CERTIFICATE-----') || pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('AI_LOCAL_MOCK_CA_INVALID');
  }

  try {
    return Deno.createHttpClient({ caCerts: [pem] });
  } catch {
    throw new Error('AI_LOCAL_MOCK_CA_INVALID');
  }
}
