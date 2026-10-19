import { modelProviderKey } from './aiBudgetPolicy.js';

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
