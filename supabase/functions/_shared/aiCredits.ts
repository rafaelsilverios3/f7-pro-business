import { modelProviderKey } from './aiBudgetPolicy.js';

/** Server-side lookup used only to bypass commercial plan entitlements for the permanent Owner.
 * Company membership and company-role permissions remain independently required. */
export async function hasPermanentGlobalOwnerAccess(sb: any, userId: string) {
  if (!userId) return { ok: false, is_owner: false };
  const { data, error } = await sb.from('platform_admins').select('role,status,expires_at').eq('user_id', userId).maybeSingle();
  if (error) return { ok: false, is_owner: false };
  return { ok: true, is_owner: data?.role === 'owner' && data?.status === 'active' && data?.expires_at === null };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function aiCreditRequestHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function reserveAICredits(sb: any, input: {
  company_id: string; user_id: string; request_key: string; request_hash: string; model_key: string;
  input_tokens: number; output_token_limit: number; quote_id?: string | null; confirmed?: boolean;
}) {
  const provider = modelProviderKey(Deno.env.get('AI_API_URL'));
  if (!provider) return { allowed: false, code: 'AI_CREDITS_PROVIDER_UNSUPPORTED' };
  const { data, error } = await sb.rpc('ai_credit_quote_reserve_v1', {
    target_company: input.company_id, target_user: input.user_id, request_key: input.request_key,
    request_hash: input.request_hash, provider_key: provider, model_key: input.model_key,
    input_tokens: input.input_tokens, output_token_limit: input.output_token_limit,
    quote_id: input.quote_id || null, confirm: input.confirmed === true,
  });
  if (error) return { allowed: false, code: 'AI_CREDITS_UNAVAILABLE' };
  return data || { allowed: false, code: 'AI_CREDITS_UNAVAILABLE' };
}

/** Owner Global is exempt from commercial credits only. The separate, service-role-only
 * owner usage ledger enforces temporary pilot limits and records actual provider cost. */
export async function reserveAIForOwnerOrCredits(sb: any, input: {
  company_id: string; user_id: string; request_key: string; request_hash: string; model_key: string;
  input_tokens: number; output_token_limit: number; quote_id?: string | null; confirmed?: boolean;
}) {
  const provider = modelProviderKey(Deno.env.get('AI_API_URL'));
  if (!provider) return { allowed: false, code: 'AI_CREDITS_PROVIDER_UNSUPPORTED', owner_exempt: false };
  const { data: owner, error: ownerError } = await sb.rpc('reserve_platform_owner_ai_usage_v1', {
    p_user: input.user_id, p_company: input.company_id, p_request_key: input.request_key,
    p_request_hash: input.request_hash, p_provider: provider, p_model: input.model_key,
    p_input: input.input_tokens, p_output: input.output_token_limit,
  });
  if (ownerError || owner?.ok !== true) return { allowed: false, code: 'AI_OWNER_USAGE_POLICY_UNAVAILABLE', owner_exempt: false };
  if (owner.is_owner === true) return {
    allowed: owner.allowed === true, code: owner.code || (owner.allowed ? 'AI_OWNER_COMMERCIAL_EXEMPT' : 'AI_OWNER_LIMIT_REACHED'),
    operation_id: owner.operation_id, owner_exempt: true, owner_usage: owner,
  };
  const credits = await reserveAICredits(sb, input);
  return { ...credits, owner_exempt: false };
}

export async function settleAICredits(sb: any, input: {
  company_id: string; operation_id: string; input_tokens: number; output_tokens: number; usage_reliable: boolean;
}) {
  const { data, error } = await sb.rpc('settle_ai_credits_v1', {
    target_company: input.company_id, operation_id: input.operation_id,
    actual_input: input.input_tokens, actual_output: input.output_tokens, usage_reliable: input.usage_reliable,
  });
  return error ? { settled: false, code: 'AI_CREDITS_SETTLEMENT_UNAVAILABLE' } : data || { settled: false, code: 'AI_CREDITS_SETTLEMENT_UNAVAILABLE' };
}

export async function releaseAICredits(sb: any, input: { company_id: string; operation_id: string }) {
  return await settleAICredits(sb, { ...input, input_tokens: 0, output_tokens: 0, usage_reliable: true });
}

export async function settleAIForOwnerOrCredits(sb: any, input: {
  company_id: string; user_id: string; operation_id: string; owner_exempt: boolean;
  input_tokens: number; output_tokens: number; usage_reliable: boolean;
}) {
  if (input.owner_exempt) {
    const { data, error } = await sb.rpc('settle_platform_owner_ai_usage_v1', {
      p_operation: input.operation_id, p_user: input.user_id, p_input: input.input_tokens,
      p_output: input.output_tokens, p_reliable: input.usage_reliable,
    });
    return error ? { settled: false, code: 'AI_OWNER_USAGE_SETTLEMENT_UNAVAILABLE' } : data || { settled: false, code: 'AI_OWNER_USAGE_SETTLEMENT_UNAVAILABLE' };
  }
  return await settleAICredits(sb, input);
}

export async function releaseAIForOwnerOrCredits(sb: any, input: { company_id: string; user_id: string; operation_id: string; owner_exempt: boolean }) {
  if (input.owner_exempt) {
    const { data, error } = await sb.rpc('release_platform_owner_ai_usage_v1', { p_operation: input.operation_id, p_user: input.user_id });
    return error ? { released: false, code: 'AI_OWNER_USAGE_RELEASE_UNAVAILABLE' } : { released: data === true };
  }
  return await releaseAICredits(sb, input);
}

export async function checkOwnerWebResearchPolicy(sb: any, userId: string) {
  const { data, error } = await sb.rpc('check_platform_owner_web_policy_v1', { p_user: userId });
  if (error || data?.ok !== true) return { ok: false, is_owner: false, allowed: false };
  return { ok: true, is_owner: data.is_owner === true, allowed: data.allowed === true };
}
