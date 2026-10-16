import { admin, auth, userClient } from './core.ts';
export const MANAGER_ROLES = ['admin', 'gestor', 'comercial'];
export const VIEWER_ROLES = ['admin', 'gestor', 'comercial', 'vendedor'];
export const MARKETPLACE_ENTITLEMENT = 'marketplace_integrations';

type MarketplaceDependencies = {
  adminFactory?: typeof admin;
  authParser?: typeof auth;
  userClientFactory?: typeof userClient;
};

export async function checkMarketplaceEntitlement(sb: ReturnType<typeof admin>, companyId: string) {
  try {
    const { data, error } = await sb.rpc('company_has_feature_internal', {
      target_company: companyId,
      feature: MARKETPLACE_ENTITLEMENT,
    });
    if (error) return { allowed: false, unavailable: true };
    return { allowed: data === true, unavailable: false };
  } catch {
    return { allowed: false, unavailable: true };
  }
}

export async function authorizeMarketplace(req: Request, companyId: string, mode: 'view' | 'manage', dependencies: MarketplaceDependencies = {}) {
  const parseAuth = dependencies.authParser || auth;
  const getAdmin = dependencies.adminFactory || admin;
  const getUserClient = dependencies.userClientFactory || userClient;
  const jwt = parseAuth(req);
  const sb = getAdmin();
  const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
  if (authError || !user) return { error: 'AUTH_REQUIRED' as const, status: 401 as const };

  const viewer = getUserClient(jwt);
  const { data: member, error: memberError } = await viewer.from('company_users')
    .select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
  const role = String(member?.role || '').toLowerCase();
  const roles = mode === 'manage' ? MANAGER_ROLES : VIEWER_ROLES;
  if (memberError || member?.active !== true || !roles.includes(role)) {
    return { error: 'FORBIDDEN' as const, status: 403 as const };
  }
  const entitlement = await checkMarketplaceEntitlement(sb, companyId);
  if (entitlement.unavailable) return { error: 'ENTITLEMENT_CHECK_FAILED' as const, status: 503 as const };
  if (!entitlement.allowed) return { error: 'FEATURE_NOT_AVAILABLE' as const, status: 403 as const };
  return { sb, viewer, user, role };
}

export async function safeIntegrationLog(sb: ReturnType<typeof admin>, companyId: string, event: string, status: 'success' | 'error', metadata: Record<string, unknown> = {}) {
  // Callers may only pass enumerated codes/counts. Never include provider bodies,
  // token material, OAuth code/state, prompts, or customer/order PII.
  await sb.from('integration_logs').insert({
    company_id: companyId,
    provider: 'mercadolivre',
    event: event.slice(0, 80),
    status,
    metadata,
  });
}
