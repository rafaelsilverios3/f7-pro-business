import { assert, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createAIProviderHttpClient } from './aiProviderTls.ts';

Deno.test('AI provider uses default TLS trust when local mock CA is not configured', () => {
  const previous = Deno.env.get('AI_LOCAL_MOCK_TLS_CA_B64');
  Deno.env.delete('AI_LOCAL_MOCK_TLS_CA_B64');
  try {
    assert(createAIProviderHttpClient('https://api.openai.com/v1/chat/completions') === null);
  } finally {
    if (previous === undefined) Deno.env.delete('AI_LOCAL_MOCK_TLS_CA_B64');
    else Deno.env.set('AI_LOCAL_MOCK_TLS_CA_B64', previous);
  }
});

Deno.test('local mock CA cannot be applied to a real or other provider host', () => {
  const previous = Deno.env.get('AI_LOCAL_MOCK_TLS_CA_B64');
  Deno.env.set('AI_LOCAL_MOCK_TLS_CA_B64', btoa('synthetic certificate'));
  try {
    assertThrows(
      () => createAIProviderHttpClient('https://api.openai.com/v1/chat/completions'),
      Error,
      'AI_LOCAL_MOCK_CA_SCOPE_INVALID',
    );
    assertThrows(
      () => createAIProviderHttpClient('http://ai-mock-provider:57443/v1/chat/completions'),
      Error,
      'AI_LOCAL_MOCK_CA_SCOPE_INVALID',
    );
  } finally {
    if (previous === undefined) Deno.env.delete('AI_LOCAL_MOCK_TLS_CA_B64');
    else Deno.env.set('AI_LOCAL_MOCK_TLS_CA_B64', previous);
  }
});

Deno.test('local mock CA rejects malformed certificate material without returning it', () => {
  const previous = Deno.env.get('AI_LOCAL_MOCK_TLS_CA_B64');
  Deno.env.set('AI_LOCAL_MOCK_TLS_CA_B64', btoa('not a CA'));
  try {
    assertThrows(
      () => createAIProviderHttpClient('https://ai-mock-provider:57443/v1/chat/completions'),
      Error,
      'AI_LOCAL_MOCK_CA_INVALID',
    );
  } finally {
    if (previous === undefined) Deno.env.delete('AI_LOCAL_MOCK_TLS_CA_B64');
    else Deno.env.set('AI_LOCAL_MOCK_TLS_CA_B64', previous);
  }
});
