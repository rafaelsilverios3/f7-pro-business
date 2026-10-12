export const HOMOLOGATION_URL = 'https://vwylnjmapixtzhryiutt.supabase.co';
export const HOMOLOGATION_VERCEL_BRANCH = 'codex/harden-multi-tenant-isolation';
export const PROBE_PATH = '/__homologation/rest-check';
export const COMPANIES = {
  A: { id: '65fcb6d2-444a-416a-9185-0614ad2c8cbe', name: 'Empresa Homolog A' },
  B: { id: '00810923-89d7-435b-bf14-af8db490b65f', name: 'Empresa Homolog B' },
};
export const IDENTITIES = {
  'f7group7@gmail.com': { company: 'A', role: 'admin', label: 'Admin A' },
  'rafaelsilverio.s3@gmail.com': { company: 'B', role: 'admin', label: 'Admin B' },
  'f7group7+vendedor@gmail.com': { company: 'A', role: 'vendedor', label: 'Vendedor A' },
};

export function isExactHomologationBuild() {
  if (import.meta.env.VERCEL_ENV !== 'preview') return false;
  if (import.meta.env.VERCEL_GIT_COMMIT_REF !== HOMOLOGATION_VERCEL_BRANCH) return false;
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return false;
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).origin === HOMOLOGATION_URL;
  } catch {
    return false;
  }
}

export function result(identity, company, resource, operation, expected, state, status = null, detail = '') {
  return { identity, company, resource, operation, expected, state, status, detail };
}

export async function validateOperationSession(supabase, allowedRoles, requireRunnerRoute = true) {
  if (!isExactHomologationBuild() || (requireRunnerRoute && window.location.pathname !== PROBE_PATH)) {
    return { error: 'Destino/ambiente fora do escopo autorizado.' };
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user?.id || !user?.email) return { error: 'Sessão Auth inválida ou expirada.' };
  const identity = IDENTITIES[String(user.email).trim().toLowerCase()];
  if (!identity || !allowedRoles.includes(identity.role)) return { error: 'Identidade ou papel fora do escopo da operação.' };
  const ownCompany = COMPANIES[identity.company];
  const otherCompany = COMPANIES[identity.company === 'A' ? 'B' : 'A'];
  const { data: memberships, error: membershipError, status } = await supabase
    .from('company_users')
    .select('company_id, role, active')
    .eq('user_id', user.id)
    .eq('active', true);
  if (membershipError || !Array.isArray(memberships) || memberships.length !== 1
    || memberships[0].company_id !== ownCompany.id || memberships[0].role !== identity.role
    || memberships[0].active !== true) {
    return { error: 'Vínculo ativo e papel não conferem.', status: status ?? null };
  }
  return { user, identity, ownCompany, otherCompany };
}

export function safeApiFailure(error) {
  const status = Number(error?.status) || null;
  const code = String(error?.code || '');
  const denied = [401, 403].includes(status) || code === '42501';
  return { status, code, denied };
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export function testMarker(company, nonce) {
  return `F7_HOMOLOG_REST_${company}_${nonce}`;
}
