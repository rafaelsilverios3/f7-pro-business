import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const aiCreditsService = {
  async snapshot(companyId) {
    const client = getSupabaseClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user?.id) throw new Error('AUTH_REQUIRED');
    const { data, error } = await client.rpc('ai_credits_snapshot_v1', { target_company: companyId, target_user: user.id });
    if (error) throw error;
    return data;
  },
  async cancelQuote(companyId, quoteId) {
    const client = getSupabaseClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user?.id) throw new Error('AUTH_REQUIRED');
    const { data, error } = await client.rpc('cancel_ai_credit_quote_v1', { target_company: companyId, target_user: user.id, quote_id: quoteId });
    if (error) throw error;
    return Boolean(data);
  },
};
