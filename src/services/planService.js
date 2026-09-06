export const PLAN_LIMITS = Object.freeze({
  free: { users: 1, products: 100, customers: 100, salesPerMonth: 50, automations: 0, intelligence: 'basic' },
  pro: { users: 3, products: 1000, customers: 1000, salesPerMonth: 500, automations: 5, intelligence: 'basic' },
  business: { users: 10, products: 10000, customers: 10000, salesPerMonth: Infinity, automations: Infinity, intelligence: 'advanced' },
  premium: { users: Infinity, products: Infinity, customers: Infinity, salesPerMonth: Infinity, automations: Infinity, intelligence: 'advanced' },
});
export const FEATURE_PLANS = Object.freeze({ automations: 'pro', advanced_automations: 'business', atendimento: 'business', advanced_reports: 'business', intelligence: 'free', whatsapp: 'premium', ai: 'premium' });
export function getPlanLimits(plan = 'free') { return PLAN_LIMITS[plan] || PLAN_LIMITS.free; }
export function canUseFeature(plan, feature) { const required = FEATURE_PLANS[feature]; if (!required) return false; const rank = ['free','pro','business','premium']; return rank.indexOf(plan || 'free') >= rank.indexOf(required); }
export function withinLimit(plan, resource, current) { return Number(current || 0) < getPlanLimits(plan)[resource]; }
