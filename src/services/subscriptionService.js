import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { FEATURE_REQUIREMENTS } from '@/lib/subscriptionRequirements';

export const TRIAL_ALLOWED_PATHS = ['/f7probusiness', '/treinamento', '/assinatura', '/configuracoes', '/configuracoes/atendimento', '/configuracoes/integracoes', '/usuarios', '/notificacoes'];
export { FEATURE_REQUIREMENTS } from '@/lib/subscriptionRequirements';

export async function loadSubscription(companyId) {
  if (!companyId || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return null;
  const client = getSupabaseClient();
  await client.rpc('sync_company_trial', { target_company: companyId }).catch(() => {});
  // The RPC validates auth.uid() + active membership before reading the
  // canonical row and returns only the fields required by the header.
  const { data, error } = await client.rpc('get_current_subscription', { target_company: companyId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

export const trialActive = (subscription, now = Date.now()) => subscription?.status === 'trial' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() > now;
export const trialExpired = (subscription, now = Date.now()) => subscription?.status === 'expired' || (subscription?.status === 'trial' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() <= now);
export const trialHoursRemaining = (subscription, now = Date.now()) => Math.max(0, Math.ceil((new Date(subscription?.trial_ends_at || 0).getTime() - now) / 3_600_000));
