import { admin, auth, userClient } from './core.ts';
export const MANAGER_ROLES = ['admin', 'gestor', 'comercial'];
export const VIEWER_ROLES = ['admin', 'gestor', 'comercial', 'vendedor'];

export async function authorizeMarketplace(req: Request, companyId: string, mode: 'view' | 'manage') {
  const jwt = auth(req);
  const sb = admin();
  const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
  if (authError || !user) return { error: 'AUTH_REQUIRED' as const, status: 401 as const };

  const viewer = userClient(jwt);
  const { data: member, error: memberError } = await viewer.from('company_users')
    .select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
  const role = String(member?.role || '').toLowerCase();
  const roles = mode === 'manage' ? MANAGER_ROLES : VIEWER_ROLES;
  if (memberError || member?.active !== true || !roles.includes(role)) {
    return { error: 'FORBIDDEN' as const, status: 403 as const };
  }
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
