import React, { useCallback, useState } from 'react';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';

const HOMOLOGATION_URL = 'https://vwylnjmapixtzhryiutt.supabase.co';
const HOMOLOGATION_VERCEL_BRANCH = 'codex/harden-multi-tenant-isolation';
const PROBE_PATH = '/__homologation/rest-check';
const COMPANIES = {
  A: { id: '65fcb6d2-444a-416a-9185-0614ad2c8cbe', name: 'Empresa Homolog A' },
  B: { id: '00810923-89d7-435b-bf14-af8db490b65f', name: 'Empresa Homolog B' },
};
const IDENTITIES = {
  'f7group7@gmail.com': { company: 'A', role: 'admin', label: 'Admin A' },
  'rafaelsilverio.s3@gmail.com': { company: 'B', role: 'admin', label: 'Admin B' },
  'f7group7+vendedor@gmail.com': { company: 'A', role: 'vendedor', label: 'Vendedor A' },
};
const READ_RESOURCES = [
  'customers', 'products', 'sales', 'sale_items', 'stock_movements',
  'purchases', 'purchase_items', 'financial_entries', 'company_users',
  'company_invites', 'company_subscriptions', 'audit_logs', 'quotes', 'commissions',
];

function isExactHomologationBuild() {
  if (import.meta.env.VERCEL_ENV !== 'preview') return false;
  if (import.meta.env.VERCEL_GIT_COMMIT_REF !== HOMOLOGATION_VERCEL_BRANCH) return false;
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return false;
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).origin === HOMOLOGATION_URL;
  } catch {
    return false;
  }
}

function result(identity, company, resource, operation, expected, state, status = null, detail = '') {
  return { identity, company, resource, operation, expected, state, status, detail };
}

function classifyCrossRead({ identity, company, table, status, count, error }) {
  if (error && [401, 403].includes(status)) {
    return result(identity, company, table, 'REST HEAD cross-tenant', 'sem linhas visíveis', 'PASS', status, 'API negou acesso');
  }
  if (error) {
    return result(identity, company, table, 'REST HEAD cross-tenant', 'sem linhas visíveis', 'PENDING', status, 'recurso indisponível ou consulta não suportada');
  }
  if (count === 0) {
    return result(identity, company, table, 'REST HEAD cross-tenant', 'zero linhas visíveis', 'PASS', status, 'nenhuma linha do outro tenant');
  }
  return result(identity, company, table, 'REST HEAD cross-tenant', 'zero linhas visíveis', 'FAIL', status, 'a API informou ao menos uma linha do outro tenant');
}

async function validateOperationSession(supabase, allowedRoles) {
  if (!isExactHomologationBuild() || window.location.pathname !== PROBE_PATH) {
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

function safeApiFailure(error) {
  const status = Number(error?.status) || null;
  const code = String(error?.code || '');
  const denied = [401, 403].includes(status) || code === '42501';
  return { status, code, denied };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function testMarker(company, nonce) {
  return `F7_HOMOLOG_REST_${company}_${nonce}`;
}

export default function HomologationRestRunner() {
  const { isAuthenticated } = useAuth();
  const [running, setRunning] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [rows, setRows] = useState([]);
  const [finished, setFinished] = useState(false);
  const [fixture, setFixture] = useState(null);
  const [targetFixture, setTargetFixture] = useState({ id: '', marker: '' });
  const [writeRunning, setWriteRunning] = useState(false);

  const runReadOnlyChecks = useCallback(async () => {
    setRunning(true);
    setFinished(false);
    setRows([]);
    setIdentity(null);
    const checks = [];
    let identityLabel = 'Sessão atual';
    let companyLabel = '—';

    try {
      if (!isExactHomologationBuild() || window.location.pathname !== PROBE_PATH) {
        checks.push(result(identityLabel, companyLabel, 'project guard', 'preflight', HOMOLOGATION_URL, 'BLOCKED', null, 'build não autorizado'));
        return;
      }
      if (!isAuthenticated) {
        checks.push(result(identityLabel, companyLabel, 'Supabase Auth', 'session', 'sessão autenticada', 'BLOCKED', null, 'entre pelo login normal do Preview'));
        return;
      }

      const supabase = getSupabaseClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.email) {
        checks.push(result(identityLabel, companyLabel, 'Supabase Auth', 'GET /user', 'usuário verificado pelo Auth', 'BLOCKED', userError?.status ?? null, 'sessão indisponível ou expirada'));
        return;
      }

      const email = String(userData.user.email).trim().toLowerCase();
      const expected = IDENTITIES[email];
      if (!expected) {
        checks.push(result(identityLabel, companyLabel, 'Supabase Auth', 'identity allowlist', 'uma das três contas de homologação', 'BLOCKED', 200, 'identidade fora da lista de teste'));
        return;
      }

      identityLabel = expected.label;
      companyLabel = expected.company;
      setIdentity({ label: expected.label, email, company: expected.company, role: expected.role });
      checks.push(result(identityLabel, companyLabel, 'Supabase Auth', 'GET /user', 'conta de homologação permitida', 'PASS', 200, 'identidade validada pelo Auth'));

      const ownCompany = COMPANIES[expected.company];
      const otherCompany = COMPANIES[expected.company === 'A' ? 'B' : 'A'];
      const { data: memberships, error: membershipError, status: membershipStatus } = await supabase
        .from('company_users')
        .select('company_id, role, active')
        .eq('user_id', userData.user.id)
        .eq('active', true);
      const membershipOk = !membershipError
        && Array.isArray(memberships)
        && memberships.length === 1
        && memberships[0].company_id === ownCompany.id
        && memberships[0].role === expected.role
        && memberships[0].active === true;
      checks.push(result(identityLabel, companyLabel, 'company_users', 'active membership', `${ownCompany.name} / ${expected.role}`, membershipOk ? 'PASS' : 'BLOCKED', membershipStatus ?? 200, membershipOk ? 'vínculo único confirmado por REST' : 'vínculo ausente, múltiplo ou divergente; demais checks parados'));
      if (!membershipOk) return;

      const { error: companyError, count: companyCount, status: companyStatus } = await supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .eq('id', otherCompany.id)
        .limit(1);
      const otherCompanyVisible = !companyError && Number(companyCount || 0) > 0;
      const otherCompanyDenied = companyError && [401, 403].includes(companyStatus);
      const otherCompanyHidden = !companyError && !otherCompanyVisible;
      checks.push(result(identityLabel, companyLabel, 'companies', 'REST HEAD cross-tenant', 'zero linhas visíveis', otherCompanyDenied || otherCompanyHidden ? 'PASS' : companyError ? 'PENDING' : 'FAIL', companyStatus ?? null, otherCompanyVisible ? 'a API informou outra empresa' : otherCompanyDenied || otherCompanyHidden ? 'empresa oposta não visível' : 'falha sanitizada ao consultar empresa oposta'));

      for (const table of READ_RESOURCES) {
        const { count, error, status } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('company_id', otherCompany.id)
          .limit(1);
        checks.push(classifyCrossRead({ identity: identityLabel, company: companyLabel, table, status: status ?? null, count: Number(count || 0), error }));
      }

      // company_has_feature is STABLE and the migration requires active tenant
      // membership before it evaluates another company's feature entitlement.
      const { data: crossFeature, error: featureError, status: featureStatus } = await supabase.rpc('company_has_feature', {
        target_company: otherCompany.id,
        feature: 'intelligence',
      });
      const featureDenied = featureError && [401, 403].includes(featureStatus);
      const featureHidden = !featureError && crossFeature === false;
      checks.push(result(identityLabel, companyLabel, 'company_has_feature', 'RPC cross-tenant', 'false ou acesso negado', featureDenied || featureHidden ? 'PASS' : featureError ? 'PENDING' : 'FAIL', featureStatus ?? null, featureHidden ? 'entitlement oculto para empresa não vinculada' : featureDenied ? 'RPC negou acesso' : featureError ? 'RPC não pôde ser validada' : 'RPC revelou entitlement externo'));
    } catch {
      checks.push(result(identityLabel, companyLabel, 'test runner', 'read-only checks', 'execução sanitizada', 'BLOCKED', null, 'falha de rede ou cliente; detalhes brutos omitidos'));
    } finally {
      setRows(checks);
      setFinished(true);
      setRunning(false);
    }
  }, [isAuthenticated]);

  const appendWriteResults = useCallback((entries) => {
    setRows((current) => [...current, ...entries]);
    setFinished(true);
  }, []);

  const createOwnFixture = useCallback(async () => {
    setWriteRunning(true);
    const checks = [];
    try {
      const supabase = getSupabaseClient();
      const guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error) {
        checks.push(result('Sessão atual', '—', 'customers', 'fixture INSERT preflight', 'admin homologado', 'BLOCKED', guard.status, guard.error));
        return;
      }
      const nonce = crypto.randomUUID().replaceAll('-', '').toUpperCase();
      const id = crypto.randomUUID();
      const marker = testMarker(guard.identity.company, nonce);
      const { count, error: existsError } = await supabase.from('customers')
        .select('id', { count: 'exact', head: true }).eq('id', id);
      if (existsError || Number(count || 0) !== 0) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'fixture precheck', 'UUID novo e ausente', 'BLOCKED', existsError?.status ?? null, 'precondição indisponível; nenhuma escrita executada'));
        return;
      }
      const { data, error, status } = await supabase.from('customers')
        .insert({ id, company_id: guard.ownCompany.id, name: marker })
        .select('id,company_id,name').single();
      if (error || data?.id !== id || data?.company_id !== guard.ownCompany.id || data?.name !== marker) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'fixture INSERT own-tenant', 'uma fixture fictícia no tenant próprio', 'FAIL', status ?? error?.status ?? null, 'resultado divergente; detalhe bruto omitido'));
        return;
      }
      setFixture({ id, marker, company: guard.identity.company, companyId: guard.ownCompany.id, owner: guard.identity.label });
      checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'fixture INSERT own-tenant', 'uma fixture fictícia no tenant próprio', 'PASS', status ?? 201, `criada; id=${id}; marcador=${marker}`));
    } catch {
      checks.push(result('Sessão atual', '—', 'customers', 'fixture INSERT', 'resultado sanitizado', 'BLOCKED', null, 'falha de rede/cliente; detalhe bruto omitido'));
    } finally {
      appendWriteResults(checks);
      setWriteRunning(false);
    }
  }, [appendWriteResults]);

  const runCrossTenantWrites = useCallback(async () => {
    setWriteRunning(true);
    const checks = [];
    let stop = false;
    try {
      const supabase = getSupabaseClient();
      let guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error) {
        checks.push(result('Sessão atual', '—', 'customers', 'cross-write preflight', 'admin homologado', 'BLOCKED', guard.status, guard.error));
        return;
      }
      const id = targetFixture.id.trim();
      const marker = targetFixture.marker.trim();
      const markerPattern = new RegExp(`^F7_HOMOLOG_REST_${guard.identity.company === 'A' ? 'B' : 'A'}_[A-F0-9]{32}$`);
      if (!isUuid(id) || !markerPattern.test(marker)) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'cross-write fixture validation', 'ID UUID e marcador fictício do outro tenant', 'BLOCKED', null, 'informe o ID/marcador da fixture criada pelo outro administrador'));
        return;
      }
      const other = guard.otherCompany;
      const { data: visible, error: readError, status: readStatus } = await supabase.from('customers')
        .select('id').eq('id', id).eq('company_id', other.id).eq('name', marker).limit(1);
      if (readError || (Array.isArray(visible) && visible.length > 0)) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'cross-tenant fixture read', 'fixture alheia invisível antes do ataque', readError ? 'PENDING' : 'FAIL', readStatus ?? readError?.status ?? null, readError ? 'leitura de precondição não validada' : 'fixture externa visível; testes de escrita interrompidos'));
        return;
      }
      checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'cross-tenant fixture read', 'fixture alheia invisível', 'PASS', readStatus ?? 200, 'zero registros visíveis antes das tentativas'));

      guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error || guard.otherCompany.id !== other.id) {
        checks.push(result('Sessão atual', '—', 'customers', 'cross INSERT revalidation', 'mesma sessão/tenant/papel', 'BLOCKED', guard.status, guard.error || 'contexto de empresa alterado'));
        return;
      }
      const attackMarker = testMarker('CROSS', crypto.randomUUID().replaceAll('-', '').toUpperCase());
      const insert = await supabase.from('customers')
        .insert({ company_id: other.id, name: attackMarker }).select('id,company_id,name');
      const insertDenied = safeApiFailure(insert.error);
      if (insertDenied.denied) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST INSERT cross-tenant', 'negado pelo servidor/RLS', 'PASS', insertDenied.status, `denegado (${insertDenied.code || 'HTTP'})`));
      } else if (insert.error) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST INSERT cross-tenant', 'negação comprovada', 'PENDING', insertDenied.status, 'erro não conclusivo; sequência interrompida'));
        stop = true;
      } else {
        const returned = Array.isArray(insert.data) ? insert.data[0] : null;
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST INSERT cross-tenant', 'nenhuma linha criada', 'FAIL', insert.status ?? 201, `possível escrita cruzada; linhas=${insert.data?.length ?? 0}; id=${returned?.id || 'não retornado'}; company_id=${returned?.company_id || other.id}; nenhuma ação posterior executada`));
        stop = true;
      }
      if (stop) return;

      guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error || guard.otherCompany.id !== other.id) {
        checks.push(result('Sessão atual', '—', 'customers', 'cross PATCH revalidation', 'mesma sessão/tenant/papel', 'BLOCKED', guard.status, guard.error || 'contexto de empresa alterado'));
        return;
      }
      const patch = await supabase.from('customers').update({ name: `${marker}_PATCH_ATTEMPT` })
        .eq('id', id).eq('company_id', other.id).eq('name', marker).select('id');
      const patchDenied = safeApiFailure(patch.error);
      if (patchDenied.denied || (!patch.error && Array.isArray(patch.data) && patch.data.length === 0)) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST PATCH cross-tenant', 'negado/zero linhas afetadas', 'PASS', patchDenied.status ?? patch.status ?? 200, patchDenied.denied ? `denegado (${patchDenied.code || 'HTTP'})` : 'zero linhas afetadas'));
      } else {
        const returned = Array.isArray(patch.data) ? patch.data[0] : null;
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST PATCH cross-tenant', 'zero linhas afetadas', patch.error ? 'PENDING' : 'FAIL', patchDenied.status ?? patch.status ?? null, `resultado inesperado; linhas=${patch.data?.length ?? 0}; id=${returned?.id || id}; sequência interrompida`));
        stop = true;
      }
      if (stop) return;

      guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error || guard.otherCompany.id !== other.id) {
        checks.push(result('Sessão atual', '—', 'customers', 'cross DELETE revalidation', 'mesma sessão/tenant/papel', 'BLOCKED', guard.status, guard.error || 'contexto de empresa alterado'));
        return;
      }
      const deletion = await supabase.from('customers').delete()
        .eq('id', id).eq('company_id', other.id).eq('name', marker).select('id');
      const deleteDenied = safeApiFailure(deletion.error);
      if (deleteDenied.denied || (!deletion.error && Array.isArray(deletion.data) && deletion.data.length === 0)) {
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST DELETE cross-tenant', 'negado/zero linhas afetadas', 'PASS', deleteDenied.status ?? deletion.status ?? 200, deleteDenied.denied ? `denegado (${deleteDenied.code || 'HTTP'})` : 'zero linhas afetadas'));
      } else {
        const returned = Array.isArray(deletion.data) ? deletion.data[0] : null;
        checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'REST DELETE cross-tenant', 'zero linhas afetadas', deletion.error ? 'PENDING' : 'FAIL', deleteDenied.status ?? deletion.status ?? null, `resultado inesperado; linhas=${deletion.data?.length ?? 0}; id=${returned?.id || id}; sequência interrompida`));
        stop = true;
      }
    } catch {
      checks.push(result('Sessão atual', '—', 'customers', 'cross-tenant writes', 'sem respostas brutas', 'BLOCKED', null, 'falha de rede/cliente; sequência interrompida'));
    } finally {
      appendWriteResults(checks);
      setWriteRunning(false);
    }
  }, [appendWriteResults, targetFixture]);

  const verifyOwnFixture = useCallback(async () => {
    setWriteRunning(true);
    const checks = [];
    try {
      const supabase = getSupabaseClient();
      const guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error || !fixture || fixture.companyId !== guard.ownCompany.id) {
        checks.push(result('Sessão atual', '—', 'customers', 'owner fixture verification', 'admin proprietário da fixture', 'BLOCKED', guard.status, guard.error || 'fixture não pertence à empresa autenticada'));
        return;
      }
      const { data, error, status } = await supabase.from('customers').select('id,company_id,name')
        .eq('id', fixture.id).eq('company_id', guard.ownCompany.id).eq('name', fixture.marker).maybeSingle();
      const unchanged = !error && data?.id === fixture.id && data?.company_id === guard.ownCompany.id && data?.name === fixture.marker;
      checks.push(result(guard.identity.label, guard.identity.company, 'customers', 'owner verify cross-test fixture', 'fixture segue intacta', unchanged ? 'PASS' : error ? 'PENDING' : 'FAIL', status ?? error?.status ?? 200, unchanged ? `intacta; id=${fixture.id}` : 'fixture ausente/alterada ou leitura inconclusiva'));
    } catch {
      checks.push(result('Sessão atual', '—', 'customers', 'owner fixture verification', 'resposta sanitizada', 'BLOCKED', null, 'falha de rede/cliente'));
    } finally {
      appendWriteResults(checks);
      setWriteRunning(false);
    }
  }, [appendWriteResults, fixture]);

  const runSellerAdministrativeChecks = useCallback(async () => {
    setWriteRunning(true);
    const checks = [];
    try {
      const supabase = getSupabaseClient();
      let guard = await validateOperationSession(supabase, ['vendedor']);
      if (guard.error || guard.identity.company !== 'A') {
        checks.push(result('Vendedor A', 'A', 'administrative APIs', 'preflight', 'vendedor A autenticado', 'BLOCKED', guard.status, guard.error || 'empresa divergente'));
        return;
      }
      const { data: membership, error: membershipError } = await supabase.from('company_users')
        .select('id,company_id,user_id,role,active').eq('user_id', guard.user.id)
        .eq('company_id', guard.ownCompany.id).eq('role', 'vendedor').eq('active', true).maybeSingle();
      if (membershipError || !membership?.id) {
        checks.push(result(guard.identity.label, 'A', 'company_users', 'seller admin-target preflight', 'membership do próprio vendedor confirmada', 'BLOCKED', membershipError?.status ?? null, 'alvo de teste não validado'));
        return;
      }
      guard = await validateOperationSession(supabase, ['vendedor']);
      if (guard.error) {
        checks.push(result('Vendedor A', 'A', 'company_users', 'REST PATCH role escalation', 'sessão/vínculo revalidados', 'BLOCKED', guard.status, guard.error));
        return;
      }
      const escalation = await supabase.from('company_users').update({ role: 'admin' })
        .eq('id', membership.id).eq('company_id', guard.ownCompany.id).eq('user_id', guard.user.id)
        .eq('role', 'vendedor').select('id,role');
      const escalationDenied = safeApiFailure(escalation.error);
      if (escalationDenied.denied) {
        checks.push(result(guard.identity.label, 'A', 'company_users', 'REST PATCH role escalation', 'negado pelo servidor', 'PASS', escalationDenied.status, `denegado (${escalationDenied.code || 'HTTP'})`));
      } else if (!escalation.error && Array.isArray(escalation.data) && escalation.data.length === 0) {
        const { data: unchanged, error: verifyError } = await supabase.from('company_users').select('role,active')
          .eq('id', membership.id).eq('company_id', guard.ownCompany.id).maybeSingle();
        const stillSeller = !verifyError && unchanged?.role === 'vendedor' && unchanged?.active === true;
        checks.push(result(guard.identity.label, 'A', 'company_users', 'REST PATCH role escalation', 'zero linhas e papel vendedor preservado', stillSeller ? 'PASS' : verifyError ? 'PENDING' : 'FAIL', verifyError?.status ?? escalation.status ?? 200, stillSeller ? 'zero afetadas; papel confirmado sem alteração' : 'não foi possível confirmar o papel'));
        if (!stillSeller) return;
      } else {
        checks.push(result(guard.identity.label, 'A', 'company_users', 'REST PATCH role escalation', 'vendedor não pode promover a si próprio', 'FAIL', escalation.status ?? null, 'resposta inesperada; nenhum teste administrativo posterior executado'));
        return;
      }

      guard = await validateOperationSession(supabase, ['vendedor']);
      if (guard.error || guard.identity.company !== 'A') {
        checks.push(result('Vendedor A', 'A', 'update_company_member_role', 'RPC revalidation', 'vendedor A segue ativo', 'BLOCKED', guard.status, guard.error || 'empresa divergente'));
        return;
      }
      const { error: roleRpcError, status: roleRpcStatus } = await supabase.rpc('update_company_member_role', {
        target_company: guard.ownCompany.id,
        target_user: guard.user.id,
        new_role: 'admin',
      });
      const roleRpcDenied = !!roleRpcError && /somente administradores podem alterar papéis/i.test(String(roleRpcError.message || ''));
      checks.push(result(guard.identity.label, 'A', 'update_company_member_role', 'administrative RPC role escalation', 'rejeição explícita por papel', roleRpcDenied ? 'PASS' : roleRpcError ? 'PENDING' : 'FAIL', roleRpcStatus ?? roleRpcError?.status ?? (roleRpcError ? null : 200), roleRpcDenied ? 'rejeitado pela autorização administrativa; detalhes omitidos' : roleRpcError ? 'erro não comprova autorização por papel' : 'RPC aceitou alteração; parar e investigar'));
      if (!roleRpcDenied) return;

      guard = await validateOperationSession(supabase, ['vendedor']);
      if (guard.error || guard.identity.company !== 'A') {
        checks.push(result('Vendedor A', 'A', 'create_company_invite', 'RPC revalidation', 'vendedor A segue ativo', 'BLOCKED', guard.status, guard.error || 'empresa divergente'));
        return;
      }
      const nonce = crypto.randomUUID().replaceAll('-', '').toLowerCase();
      const fakeEmail = `f7-homolog-${nonce}@example.invalid`;
      const { error: inviteError, status: inviteStatus } = await supabase.rpc('create_company_invite', {
        target_company: guard.ownCompany.id,
        invite_email: fakeEmail,
        invite_role: 'vendedor',
        invite_token_hash: nonce,
        invite_expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      const message = String(inviteError?.message || '');
      const adminOnlyDenied = !!inviteError && /somente administradores podem criar convites/i.test(message);
      checks.push(result(guard.identity.label, 'A', 'create_company_invite', 'RPC create invite (sem envio)', 'rejeição explícita por papel', adminOnlyDenied ? 'PASS' : inviteError ? 'PENDING' : 'FAIL', inviteStatus ?? inviteError?.status ?? (inviteError ? null : 200), adminOnlyDenied ? 'rejeitado pela autorização administrativa; detalhes omitidos' : inviteError ? 'erro não comprova autorização por papel' : 'RPC aceitou chamada administrativa; parar e investigar'));
    } catch {
      checks.push(result('Vendedor A', 'A', 'administrative APIs', 'seller checks', 'resposta sanitizada', 'BLOCKED', null, 'falha de rede/cliente; detalhes brutos omitidos'));
    } finally {
      appendWriteResults(checks);
      setWriteRunning(false);
    }
  }, [appendWriteResults]);

  const runCancelledSaleIdempotency = useCallback(async () => {
    setWriteRunning(true);
    const checks = [];
    const productMarker = 'Produto fictício F7 A - teste de rascunho 0087';
    try {
      const supabase = getSupabaseClient();
      let guard = await validateOperationSession(supabase, ['admin']);
      if (guard.error || guard.identity.company !== 'A') {
        checks.push(result('Admin A', 'A', 'cancel_sale', 'preflight', 'Admin A autenticado', 'BLOCKED', guard.status, guard.error || 'empresa divergente'));
        return;
      }
      const { data: sales, error: saleError } = await supabase.from('sales')
        .select('id,company_id,status,items,customer_id').eq('company_id', guard.ownCompany.id)
        .eq('status', 'cancelled').contains('items', [{ name: productMarker }]);
      if (saleError || !Array.isArray(sales) || sales.length !== 1) {
        checks.push(result(guard.identity.label, 'A', 'sales', 'cancelled fixture identification', 'exatamente uma venda fictícia cancelada', saleError ? 'PENDING' : 'BLOCKED', saleError?.status ?? null, `encontradas=${sales?.length ?? 'indisponível'}; nenhuma RPC chamada`));
        return;
      }
      const sale = sales[0];
      if (sale.status !== 'cancelled' || !Array.isArray(sale.items) || sale.items.length !== 1 || sale.items[0]?.name !== productMarker || !isUuid(sale.items[0]?.product_id)) {
        checks.push(result(guard.identity.label, 'A', 'sales', 'cancelled fixture validation', 'fixture única e exata', 'BLOCKED', null, `venda=${sale.id}; formato divergente; nenhuma RPC chamada`));
        return;
      }
      const productId = sale.items[0].product_id;
      const { data: product, error: productError } = await supabase.from('products').select('id,company_id,name,stock')
        .eq('id', productId).eq('company_id', guard.ownCompany.id).eq('name', productMarker).maybeSingle();
      if (productError || !product) {
        checks.push(result(guard.identity.label, 'A', 'products', 'cancel fixture product validation', 'produto da mesma empresa identificado', 'BLOCKED', productError?.status ?? null, 'produto não validado; nenhuma RPC chamada'));
        return;
      }
      const snapshot = async () => {
        const [saleState, productState, movementState, financeState, commissionState] = await Promise.all([
          supabase.from('sales').select('id,company_id,status').eq('id', sale.id).eq('company_id', guard.ownCompany.id).maybeSingle(),
          supabase.from('products').select('id,company_id,stock').eq('id', product.id).eq('company_id', guard.ownCompany.id).maybeSingle(),
          supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', guard.ownCompany.id).eq('sale_id', sale.id),
          supabase.from('financial_entries').select('id', { count: 'exact', head: true }).eq('company_id', guard.ownCompany.id).eq('sale_id', sale.id),
          supabase.from('commissions').select('id', { count: 'exact', head: true }).eq('company_id', guard.ownCompany.id).eq('sale_id', sale.id),
        ]);
        const responses = [saleState, productState, movementState, financeState, commissionState];
        if (responses.some((response) => response.error)) return { error: 'snapshot unavailable' };
        return {
          saleStatus: saleState.data?.status,
          stock: Number(productState.data?.stock),
          stockMovements: movementState.count,
          financeEntries: financeState.count,
          commissions: commissionState.count,
        };
      };
      const before = await snapshot();
      if (before.error || before.saleStatus !== 'cancelled' || !Number.isFinite(before.stock)) {
        checks.push(result(guard.identity.label, 'A', 'sale/product/ledger', 'pre-cancel baseline', 'estado legível antes de RPC', 'BLOCKED', null, 'baseline incompleto; nenhuma RPC chamada'));
        return;
      }
      checks.push(result(guard.identity.label, 'A', 'sale/product/ledger', 'pre-cancel baseline', 'cancelled + estoque/razões registradas', 'PASS', 200, `sale=${sale.id}; product=${product.id}; stock=${before.stock}; stock_movements=${before.stockMovements}; finance=${before.financeEntries}; commissions=${before.commissions}`));

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        guard = await validateOperationSession(supabase, ['admin']);
        if (guard.error || guard.identity.company !== 'A') {
          checks.push(result('Admin A', 'A', 'cancel_sale', `pre-RPC validation ${attempt}`, 'identidade/empresa/papel revalidados', 'BLOCKED', guard.status, guard.error || 'empresa divergente'));
          break;
        }
        const { data: currentSale, error: currentSaleError } = await supabase.from('sales')
          .select('id,company_id,status,items').eq('id', sale.id).eq('company_id', guard.ownCompany.id).eq('status', 'cancelled').maybeSingle();
        if (currentSaleError || currentSale?.id !== sale.id || currentSale?.items?.[0]?.product_id !== product.id) {
          checks.push(result(guard.identity.label, 'A', 'cancel_sale', `pre-RPC validation ${attempt}`, 'mesma venda fictícia já cancelada', 'BLOCKED', currentSaleError?.status ?? null, 'identidade/estado da venda divergente; chamada parada'));
          break;
        }
        const { error: rpcError, status: rpcStatus } = await supabase.rpc('cancel_sale', { target_sale: sale.id });
        if (rpcError) {
          checks.push(result(guard.identity.label, 'A', 'cancel_sale', `idempotency call ${attempt}`, 'RPC oficial retorna sucesso sem novos efeitos', 'FAIL', rpcStatus ?? rpcError.status ?? null, 'RPC retornou erro; detalhes omitidos'));
          break;
        }
        const after = await snapshot();
        const noEffect = !after.error && JSON.stringify(after) === JSON.stringify(before);
        checks.push(result(guard.identity.label, 'A', 'cancel_sale', `idempotency call ${attempt}`, 'nenhum efeito adicional', noEffect ? 'PASS' : 'FAIL', rpcStatus ?? 200, noEffect ? `sem alteração; stock=${after.stock}; movements=${after.stockMovements}; finance=${after.financeEntries}; commissions=${after.commissions}` : 'estado alterado ou baseline indisponível; chamadas seguintes interrompidas'));
        if (!noEffect) break;
      }
    } catch {
      checks.push(result('Admin A', 'A', 'cancel_sale', 'idempotency checks', 'sem detalhes brutos', 'BLOCKED', null, 'falha de rede/cliente; resposta sanitizada'));
    } finally {
      appendWriteResults(checks);
      setWriteRunning(false);
    }
  }, [appendWriteResults]);

  const counts = rows.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] || 0) + 1 }), {});
  const exactProject = isExactHomologationBuild();

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">F7 Business · Homologação</p>
        <h1 className="mt-3 text-2xl font-bold">Verificação REST de isolamento</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Usa a sessão Supabase já autenticada neste navegador. Executa somente leituras REST e a RPC estável de consulta; não cria, altera ou exclui dados.
        </p>

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm">
          <div>Destino permitido: <code className="text-cyan-200">f7-pro-business-homolog</code> · <code className="text-cyan-200">vwylnjmapixtzhryiutt</code></div>
          <div className="mt-1">Proteção do build: <strong className={exactProject ? 'text-emerald-300' : 'text-rose-300'}>{exactProject ? 'Preview, branch e projeto homologação confirmados' : 'bloqueado fora do Preview autorizado'}</strong></div>
          {identity && <div className="mt-2">Sessão: <strong>{identity.label}</strong> · {identity.email} · Empresa {identity.company} · papel <strong>{identity.role}</strong></div>}
        </div>

        <button type="button" onClick={runReadOnlyChecks} disabled={running || !exactProject || !isAuthenticated} className="mt-5 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
          {running ? 'Verificando sessão e API...' : 'Executar verificações somente leitura'}
        </button>

        <section className="mt-7 border-t border-slate-700 pt-6">
          <h2 className="text-lg font-semibold">Escritas controladas · somente homologação</h2>
          <p className="mt-2 text-sm text-amber-200">Ações manuais, sequenciais e registradas nesta página. Somente admins podem criar fixtures e tentar escritas cruzadas; qualquer retorno com linha afetada interrompe a sequência.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={createOwnFixture} disabled={writeRunning || !exactProject || !isAuthenticated} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">{writeRunning ? 'Aguarde...' : '1. Criar fixture fictícia própria'}</button>
            <button type="button" onClick={verifyOwnFixture} disabled={writeRunning || !fixture || !exactProject || !isAuthenticated} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">Verificar fixture própria após teste cruzado</button>
          </div>
          {fixture && <p className="mt-3 break-all text-xs text-cyan-200">Fixture local: tenant {fixture.company} · ID {fixture.id} · marcador {fixture.marker}. Compartilhe apenas esses identificadores fictícios com o outro admin.</p>}
          <label className="mt-4 block text-sm">Fixture do outro admin (ID e marcador fictícios)
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={targetFixture.id} onChange={(event) => setTargetFixture((value) => ({ ...value, id: event.target.value }))} placeholder="UUID da fixture do outro tenant" className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-xs" />
              <input value={targetFixture.marker} onChange={(event) => setTargetFixture((value) => ({ ...value, marker: event.target.value }))} placeholder="F7_HOMOLOG_REST_A/B_..." className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-xs" />
            </div>
          </label>
          <button type="button" onClick={runCrossTenantWrites} disabled={writeRunning || !exactProject || !isAuthenticated} className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">2. Testar INSERT, PATCH e DELETE cruzados</button>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={runSellerAdministrativeChecks} disabled={writeRunning || identity?.role !== 'vendedor' || !exactProject} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">Testar negação de APIs administrativas (Vendedor A)</button>
            <button type="button" onClick={runCancelledSaleIdempotency} disabled={writeRunning || identity?.label !== 'Admin A' || !exactProject} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">Testar idempotência da venda fictícia cancelada</button>
          </div>
        </section>

        {finished && <p className="mt-4 text-sm text-slate-300">Resumo: {counts.PASS || 0} aprovados · {counts.FAIL || 0} reprovados · {counts.PENDING || 0} pendentes · {counts.BLOCKED || 0} bloqueados. Resultados mantidos apenas nesta página.</p>}

        {rows.length > 0 && <div className="mt-5 overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-800 text-xs uppercase text-slate-300"><tr><th className="p-3">Identidade</th><th className="p-3">Recurso</th><th className="p-3">Operação</th><th className="p-3">Esperado</th><th className="p-3">Resultado</th><th className="p-3">HTTP</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${row.resource}-${row.operation}-${index}`} className="border-t border-slate-800"><td className="p-3">{row.identity} / {row.company}</td><td className="p-3">{row.resource}</td><td className="p-3">{row.operation}</td><td className="p-3">{row.expected}</td><td className={`p-3 font-semibold ${row.state === 'PASS' ? 'text-emerald-300' : row.state === 'FAIL' ? 'text-rose-300' : 'text-amber-300'}`}>{row.state}{row.detail ? ` · ${row.detail}` : ''}</td><td className="p-3">{row.status ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>}

        <p className="mt-6 border-t border-slate-700 pt-4 text-xs text-slate-400">
          Esta rota só é montada no Vercel Preview da branch autorizada, apontando ao URL exato do Supabase de homologação, e só aceita as três contas de teste. O token permanece no cliente Supabase da sessão normal; não é exibido, copiado, gravado ou enviado para relatório.
        </p>
      </section>
    </main>
  );
}
