import { admin, corsHeaders, json } from '../_shared/core.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const client = admin();
  const { data, error } = await client.from('plans').select('id,code,name,description,price_minor,currency,billing_period,trial_days,highlighted,sort_order').eq('active', true).order('sort_order');
  if (error) return json({ code: 'BILLING_PLANS_UNAVAILABLE' }, 500);
  const ids = (data || []).map((plan) => plan.id).filter(Boolean);
  const { data: features } = ids.length ? await client.from('plan_features').select('plan_id,feature,enabled,usage_limit').in('plan_id', ids) : { data: [] };
  return json({ code: 'OK', plans: (data || []).map((plan) => ({ ...plan, features: (features || []).filter((feature) => feature.plan_id === plan.id).map(({ plan_id, ...feature }) => feature) })) });
});
