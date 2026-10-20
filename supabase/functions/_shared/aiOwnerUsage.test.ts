import { reserveAIForOwnerOrCredits, checkOwnerWebResearchPolicy, hasPermanentGlobalOwnerAccess } from './aiCredits.ts';

function fakeClient(responses: Record<string, { data?: unknown; error?: unknown }>, calls: string[]) {
  return { rpc: async (name: string) => { calls.push(name); return responses[name] || { data: null, error: null }; } };
}

Deno.test('permanent global owner is reserved in personal ledger and never charged commercial credits', async () => {
  Deno.env.set('AI_API_URL', 'https://api.openai.com/v1/chat/completions');
  const calls: string[] = [];
  const sb = fakeClient({ reserve_platform_owner_ai_usage_v1: { data: { ok: true, is_owner: true, allowed: true, operation_id: 'owner-op' } } }, calls);
  const result = await reserveAIForOwnerOrCredits(sb, { company_id: 'company-a', user_id: 'owner-uuid', request_key: 'req-1', request_hash: 'a'.repeat(64), model_key: 'gpt-6-luna', input_tokens: 100, output_token_limit: 1000 });
  if (!result.allowed || !result.owner_exempt || result.operation_id !== 'owner-op') throw new Error('Owner did not receive personal ledger reservation');
  if (calls.join(',') !== 'reserve_platform_owner_ai_usage_v1') throw new Error('Owner was charged or queried against commercial credits');
});

Deno.test('ordinary company member and non-owner platform admin use commercial wallet path', async () => {
  Deno.env.set('AI_API_URL', 'https://api.openai.com/v1/chat/completions');
  const calls: string[] = [];
  const sb = fakeClient({
    reserve_platform_owner_ai_usage_v1: { data: { ok: true, is_owner: false } },
    ai_credit_quote_reserve_v1: { data: { allowed: false, code: 'AI_CREDITS_INSUFFICIENT' } },
  }, calls);
  const result = await reserveAIForOwnerOrCredits(sb, { company_id: 'company-a', user_id: 'company-admin-uuid', request_key: 'req-2', request_hash: 'b'.repeat(64), model_key: 'gpt-6-luna', input_tokens: 100, output_token_limit: 1000 });
  if (result.allowed || result.owner_exempt !== false || result.code !== 'AI_CREDITS_INSUFFICIENT') throw new Error('Non-owner unexpectedly received exemption');
  if (calls.join(',') !== 'reserve_platform_owner_ai_usage_v1,ai_credit_quote_reserve_v1') throw new Error('Non-owner did not use commercial wallet path');
});

Deno.test('owner authorization lookup failure blocks generation without commercial fallback', async () => {
  Deno.env.set('AI_API_URL', 'https://api.openai.com/v1/chat/completions');
  const calls: string[] = [];
  const sb = fakeClient({ reserve_platform_owner_ai_usage_v1: { data: null, error: new Error('db unavailable') } }, calls);
  const result = await reserveAIForOwnerOrCredits(sb, { company_id: 'company-a', user_id: 'unknown', request_key: 'req-3', request_hash: 'c'.repeat(64), model_key: 'gpt-6-luna', input_tokens: 100, output_token_limit: 1000 });
  if (result.allowed || result.code !== 'AI_OWNER_USAGE_POLICY_UNAVAILABLE') throw new Error('Owner check failure did not fail closed');
  if (calls.includes('ai_credit_quote_reserve_v1')) throw new Error('Authorization failure fell through to generation');
});

Deno.test('Owner web policy is fail-closed and respects zero-query pilot', async () => {
  const calls: string[] = [];
  const sb = fakeClient({ check_platform_owner_web_policy_v1: { data: { ok: true, is_owner: true, allowed: false } } }, calls);
  const result = await checkOwnerWebResearchPolicy(sb, 'owner-uuid');
  if (!result.ok || !result.is_owner || result.allowed) throw new Error('Owner zero-web limit was not enforced');
  const failed = await checkOwnerWebResearchPolicy(fakeClient({ check_platform_owner_web_policy_v1: { error: new Error('db unavailable') } }, []), 'owner-uuid');
  if (failed.ok || failed.allowed) throw new Error('Web gate did not fail closed');
});

Deno.test('plan exemption recognizes only active non-expiring owner role from database', async () => {
  const client = (row: unknown, error: unknown = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
  });
  const owner = await hasPermanentGlobalOwnerAccess(client({ role: 'owner', status: 'active', expires_at: null }), 'owner-uuid');
  if (!owner.ok || !owner.is_owner) throw new Error('Permanent owner was not recognized');
  for (const row of [
    { role: 'admin', status: 'active', expires_at: null },
    { role: 'owner', status: 'disabled', expires_at: null },
    { role: 'owner', status: 'active', expires_at: '2026-10-19T00:00:00Z' },
  ]) {
    const result = await hasPermanentGlobalOwnerAccess(client(row), 'other-uuid');
    if (!result.ok || result.is_owner) throw new Error('Non-permanent owner row received plan exemption');
  }
  const failed = await hasPermanentGlobalOwnerAccess(client(null, new Error('db unavailable')), 'owner-uuid');
  if (failed.ok || failed.is_owner) throw new Error('Owner lookup failure did not fail closed');
});
