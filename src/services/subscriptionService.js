import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { FEATURE_REQUIREMENTS } from '@/lib/subscriptionRequirements';

export const TRIAL_ALLOWED_PATHS = ['/f7probusiness', '/treinamento', '/assinatura', '/configuracoes', '/configuracoes/atendimento', '/configuracoes/integracoes', '/usuarios', '/notificacoes'];
export { FEATURE_REQUIREMENTS } from '@/lib/subscriptionRequirements';

export async function loadSubscription(companyId) {
  if (!companyId || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return null;
  const client = getSupabaseClient();
  await client.rpc('sync_company_trial', { target_company: companyId }).catch(() => {});
  // Keep the header read compatible with the subscription columns already
  // exposed by the canonical platform-admin subscription view. Metadata such
  // as trial_used and updated_at is not needed to resolve the displayed state.
  const { data, error } = await client.from('company_subscriptions').select('plan,status,trial_ends_at,current_period_start,current_period_end').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export const trialActive = (subscription, now = Date.now()) => subscription?.status === 'trial' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() > now;
export const trialExpired = (subscription, now = Date.now()) => subscription?.status === 'expired' || (subscription?.status === 'trial' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() <= now);
export const trialHoursRemaining = (subscription, now = Date.now()) => Math.max(0, Math.ceil((new Date(subscription?.trial_ends_at || 0).getTime() - now) / 3_600_000));
