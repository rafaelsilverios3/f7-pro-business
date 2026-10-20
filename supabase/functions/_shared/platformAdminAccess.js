export const PLATFORM_ROLES = Object.freeze(['owner', 'admin', 'support', 'readonly']);

const WRITE_ROLES = new Set(['owner', 'admin']);
const READONLY_ACTIONS = new Set(['access', 'overview', 'companies', 'health', 'ai_financial_rates', 'ai_financial_usage', 'plan_grants']);
const SUPPORT_ACTIONS = new Set(['access', 'overview', 'companies', 'company', 'subscriptions', 'whatsapp', 'health', 'ai_financial_rates', 'ai_financial_usage', 'plan_grants']);
const ADMIN_MANAGEMENT_ACTIONS = new Set(['create_platform_admin', 'update_platform_admin']);
const WRITE_ACTIONS = new Set([
  'update_company_plan', 'update_company_status', 'create_warning', 'resolve_warning',
  'update_company_user', 'update_feature', 'update_ai', 'disable_whatsapp',
  'create_plan_grant', 'revoke_plan_grant',
  ...ADMIN_MANAGEMENT_ACTIONS,
]);
const AI_FINANCIAL_ACTIONS = new Set([
  'ai_financial_rates', 'ai_financial_usage',
]);
const AI_FINANCIAL_WRITE_ACTIONS = new Set([
  'ai_financial_budget', 'ai_financial_rate_create', 'ai_financial_rate_enable',
]);

export function isPlatformAdminCurrent(row, now = Date.now()) {
  if (!row || row.status !== 'active' || !PLATFORM_ROLES.includes(row.role)) return false;
  if (!Object.hasOwn(row, 'expires_at')) return false;
  if (row.role === 'owner') return row.expires_at === null;
  if (row.role === 'admin' && row.expires_at === null) return true;
  if (typeof row.expires_at !== 'string') return false;
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function normalizePlatformAdminExpiry(value, { required = false, allowPermanent = false, now = Date.now() } = {}) {
  if (value === undefined) return required
    ? { valid: false, value: null }
    : { valid: true, value: undefined };
  if (value === null) return allowPermanent
    ? { valid: true, value: null }
    : { valid: false, value: null };
  if (value === '') return { valid: false, value: null };
  if (typeof value !== 'string') return { valid: false, value: null };
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || epoch <= now) return { valid: false, value: null };
  return { valid: true, value: new Date(epoch).toISOString() };
}

export function platformAdminCanAccessAction(role, action) {
  if (!PLATFORM_ROLES.includes(role)) return false;
  if (role === 'readonly' && !READONLY_ACTIONS.has(action)) return false;
  if (role === 'support' && !SUPPORT_ACTIONS.has(action)) return false;
  if (AI_FINANCIAL_WRITE_ACTIONS.has(action) && role !== 'owner') return false;
  if (AI_FINANCIAL_ACTIONS.has(action)) return true;
  if (WRITE_ACTIONS.has(action) && !WRITE_ROLES.has(role)) return false;
  if (ADMIN_MANAGEMENT_ACTIONS.has(action) && role !== 'owner') return false;
  return true;
}
