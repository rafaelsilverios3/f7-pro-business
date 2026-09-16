import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const TRIAL_ALLOWED_PATHS = ['/f7probusiness', '/treinamento', '/assinatura', '/configuracoes', '/configuracoes/atendimento', '/configuracoes/integracoes', '/usuarios', '/notificacoes'];
export const FEATURE_REQUIREMENTS = {
  '/ai-sales': ['PRO', 'AI Sales Assistant', 'ai_sales'],
  '/intelligence': ['PRO', 'F7 Intelligence', 'intelligence'],
  '/opportunity-radar': ['BUSINESS', 'Opportunity Radar', 'opportunity_radar'],
  '/automacoes': ['BUSINESS', 'Automações', 'automations'],
  '/supplier-intelligence': ['PREMIUM', 'Supplier Intelligence', 'supplier_intelligence'],
  '/atendimento': ['BUSINESS', 'Smart Atendimento', 'atendimento'],
  '/market-intelligence': ['BUSINESS', 'Market Intelligence', 'advanced_reports'],
  '/sales-hub': ['BUSINESS', 'F7 Sales Hub', 'advanced_reports'],
  '/relatorios': ['BUSINESS', 'Relatórios avançados', 'advanced_reports'],
};

export async function loadSubscription(companyId) {
  if (!companyId || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return null;
  const client = getSupabaseClient();
  await client.rpc('sync_company_trial', { target_company: companyId }).catch(() => {});
  // Keep the header read compatible with the foundational subscription schema;
  // trial_started_at/trial_used are not needed to resolve the displayed state.
  const { data, error } = await client.from('company_subscriptions').select('id,company_id,plan,status,trial_ends_at,current_period_start,current_period_end,updated_at').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export const trialActive = (subscription, now = Date.now()) => subscription?.status === 'trial' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() > now;
export const trialExpired = (subscription, now = Date.now()) => subscription?.status === 'expired' || (subscription?.status === 'trial' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() <= now);
export const trialHoursRemaining = (subscription, now = Date.now()) => Math.max(0, Math.ceil((new Date(subscription?.trial_ends_at || 0).getTime() - now) / 3_600_000));
