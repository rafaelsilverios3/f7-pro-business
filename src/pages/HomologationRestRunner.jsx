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

export default function HomologationRestRunner() {
  const { isAuthenticated } = useAuth();
  const [running, setRunning] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [rows, setRows] = useState([]);
  const [finished, setFinished] = useState(false);

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
