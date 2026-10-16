import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { invokeEdgeFunction } from '@/services/integrationsService';
import { buildActivePlanCatalog, planCatalogUnavailable } from '@/services/billingPlanCatalog';

const FALLBACK_PLANS = [
  { code: 'free', name: 'FREE', description: 'Para começar e conhecer o sistema.', price_minor: null, billing_period: 'month', highlighted: false, sort_order: 1, features: [] },
  { code: 'pro', name: 'PRO', description: 'Para pequenos negócios que querem organização e inteligência.', price_minor: null, billing_period: 'month', highlighted: true, sort_order: 2, features: [] },
  { code: 'business', name: 'BUSINESS', description: 'Para empresas que precisam de mais recursos e automações.', price_minor: null, billing_period: 'month', highlighted: false, sort_order: 3, features: [] },
  { code: 'premium', name: 'PREMIUM', description: 'Para operações mais completas e avançadas.', price_minor: null, billing_period: 'month', highlighted: false, sort_order: 4, features: [] },
];

export const billingService = {
  async listPlans() {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return FALLBACK_PLANS;
    try {
      const { data, error } = await getSupabaseClient().from('plans').select('id,code,name,description,price_minor,currency,billing_period,trial_days,highlighted,sort_order').eq('active', true).order('sort_order');
      if (error) throw planCatalogUnavailable();
      const ids = data.map((plan) => plan.id).filter(Boolean);
      const featureResult = ids.length
        ? await getSupabaseClient().from('plan_features').select('plan_id,feature,enabled,usage_limit').in('plan_id', ids)
        : { data: [], error: null };
      if (featureResult.error) throw planCatalogUnavailable();
      return buildActivePlanCatalog(data || [], featureResult.data || []);
    } catch {
      throw planCatalogUnavailable();
    }
  },
  createCheckout: (companyId, planCode, method = 'pix', cardTokenId = undefined) => invokeEdgeFunction('billing-checkout', {
    company_id: companyId, plan_code: planCode, method,
    ...(method === 'card' && cardTokenId ? { card_token_id: cardTokenId } : {}),
  }),
  manageSubscription: (companyId, subscriptionId, action) => invokeEdgeFunction('billing-subscription-manage', {
    company_id: companyId, subscription_id: subscriptionId, action,
  }),
  health: (companyId) => invokeEdgeFunction('billing-health', null, { method: 'GET', query: { company_id: companyId } }),
};

export { FALLBACK_PLANS };
