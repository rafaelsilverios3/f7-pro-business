import React, { useMemo, useState } from 'react';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/useCompany';

const HOMOLOG_REF = 'vwylnjmapixtzhryiutt';
const COMPANIES = {
  A: '65fcb6d2-444a-416a-9185-0614ad2c8cbe',
  B: '00810923-89d7-435b-bf14-af8db490b65f',
};
const CUSTOMER_FIXTURES = {
  A: 'Cliente Fictício Auditoria Tenant A 20261011',
  B: 'Cliente Fictício Auditoria Tenant B 20261011',
};
const A_PRODUCT_SKU = 'HOMOLOG-A-QA-20261011';
const A_PRODUCT_NAME = 'Produto fictício F7 A - teste de rascunho 0087';

function safeError(error) {
  return { code: error?.code || null, status: error?.status || null };
}

function rowCount(result) {
  return Array.isArray(result?.data) ? result.data.length : result?.data ? 1 : 0;
}

export default function TenantIsolationAuditTemporary() {
  const { user } = useAuth();
  const { company, loading: companyLoading } = useCompany();
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const projectMatches = useMemo(() => {
    try { return new URL(import.meta.env.VITE_SUPABASE_URL).hostname === `${HOMOLOG_REF}.supabase.co`; }
    catch { return false; }
  }, []);
  const ownKey = company?.id === COMPANIES.A ? 'A' : company?.id === COMPANIES.B ? 'B' : null;
  const otherKey = ownKey === 'A' ? 'B' : ownKey === 'B' ? 'A' : null;
  const otherCompanyId = otherKey ? COMPANIES[otherKey] : null;

  const add = (items, name, result, expected, passed) => items.push({
    name,
    outcome: passed ? 'APROVADO' : 'REPROVADO',
    expected,
    observed: result,
  });

  const runAudit = async () => {
    if (!projectMatches || !ownKey || !user?.id || companyLoading) return;
    setRunning(true);
    setMessage('');
    setResults([]);
    const checks = [];
    const db = getSupabaseClient();
    try {
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData?.user?.id || authData.user.id !== user.id) throw new Error('Sessão Auth não corresponde ao usuário do app.');
      const member = await db.from('company_users').select('company_id,role,active').eq('company_id', company.id).eq('user_id', user.id).maybeSingle();
      if (member.error || !member.data?.active) throw new Error('Membership ativa não confirmada.');
      add(checks, 'Sessão autenticada e membership', { authenticated: true, active: member.data.active, role: member.data.role, company: ownKey }, 'Usuário real ativo somente no contexto corrente.', true);

      const tables = ['customers', 'products', 'product_variants', 'stock_movements', 'sales', 'sale_items', 'purchases', 'purchase_items', 'suppliers', 'company_subscriptions'];
      for (const table of tables) {
        const response = await db.from(table).select('id').eq('company_id', otherCompanyId).limit(2);
        const count = rowCount(response);
        const denied = Boolean(response.error && [401, 403].includes(response.error.status));
        const pass = !response.error && count === 0 || denied;
        add(checks, `REST SELECT ${table} da outra empresa`, { rowsReturned: count, error: safeError(response.error) }, 'HTTP lógico sem erro e zero linhas, ou acesso negado.', pass);
      }

      const feature = await db.rpc('company_has_feature', { target_company: otherCompanyId, feature: 'ai_sales' });
      add(checks, 'RPC company_has_feature cross-tenant', { value: feature.data ?? null, error: safeError(feature.error) }, 'false ou acesso negado.', !feature.error && feature.data === false || Boolean(feature.error && [401, 403].includes(feature.error.status)));

      const foreignInsertName = `F7_TENANT_AUDIT_CROSS_INSERT_${ownKey}_20261011`;
      const insert = await db.from('customers').insert({ company_id: otherCompanyId, name: foreignInsertName }).select('id');
      if (!insert.error && rowCount(insert) > 0) {
        const insertedId = insert.data[0]?.id;
        const cleanup = insertedId ? await db.from('customers').delete().eq('id', insertedId) : { error: { code: 'MISSING_CREATED_ID', status: null } };
        add(checks, 'REST INSERT customer com company_id alheio', { insertedRows: rowCount(insert), cleanupRows: rowCount(cleanup), cleanupError: safeError(cleanup.error) }, 'Negado; nenhum registro cross-tenant criado.', false);
      } else {
        const denied = Boolean(insert.error && [401, 403].includes(insert.error.status));
        add(checks, 'REST INSERT customer com company_id alheio', { insertedRows: 0, error: safeError(insert.error) }, 'Negado; nenhum registro cross-tenant criado.', denied);
      }

      const foreignFixture = CUSTOMER_FIXTURES[otherKey];
      const update = await db.from('customers').update({ name: foreignFixture }).eq('company_id', otherCompanyId).eq('name', foreignFixture).select('id');
      const updateRows = rowCount(update);
      const updateDenied = Boolean(update.error && [401, 403].includes(update.error.status));
      add(checks, 'REST UPDATE do cliente fictício alheio (no-op)', { affectedRows: updateRows, error: safeError(update.error) }, 'Zero linhas alteradas ou acesso negado.', !update.error && updateRows === 0 || updateDenied);

      const remove = await db.from('customers').delete().eq('company_id', otherCompanyId).eq('name', foreignFixture).select('id');
      const deleteRows = rowCount(remove);
      const deleteDenied = Boolean(remove.error && [401, 403].includes(remove.error.status));
      add(checks, 'REST DELETE do cliente fictício alheio', { deletedRows: deleteRows, error: safeError(remove.error) }, 'Zero linhas excluídas ou acesso negado.', !remove.error && deleteRows === 0 || deleteDenied);

      setResults(checks);
      const failures = checks.filter((check) => check.outcome !== 'APROVADO');
      setMessage(failures.length ? `${failures.length} verificação(ões) reprovada(s).` : 'Todas as tentativas cross-tenant previstas foram negadas; os retornos REST foram registrados sem expor tokens.');
    } catch (error) {
      setResults(checks);
      setMessage(error?.message || 'Não foi possível concluir o teste.');
    } finally {
      setRunning(false);
    }
  };

  const createOwnFixture = async () => {
    if (!projectMatches || !ownKey || !user?.id || companyLoading) return;
    setRunning(true);
    setMessage('');
    try {
      const db = getSupabaseClient();
      const fixtureName = CUSTOMER_FIXTURES[ownKey];
      const existing = await db.from('customers').select('id').eq('company_id', company.id).eq('name', fixtureName).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        setMessage('O registro fictício próprio já existe.');
        return;
      }
      const created = await db.from('customers').insert({ company_id: company.id, name: fixtureName }).select('id').single();
      if (created.error) throw created.error;
      setMessage('Registro fictício próprio criado pela Data API autenticada. Nenhum dado de cliente real foi usado.');
    } catch (error) {
      setMessage(`Criação própria negada/falhou: ${error?.code || error?.status || 'erro'}; nenhum segredo foi lido ou exibido.`);
    } finally {
      setRunning(false);
    }
  };

  if (!projectMatches) return <main className="mx-auto max-w-3xl p-8"><h1 className="text-xl font-bold">Diagnóstico indisponível</h1><p>O Preview não corresponde ao projeto homolog autorizado.</p></main>;
  return <main className="mx-auto max-w-5xl space-y-5 p-6">
    <header><p className="text-xs font-semibold uppercase text-amber-700">Ferramenta temporária de homologação</p><h1 className="mt-2 text-2xl font-bold">Auditoria REST multiempresa</h1><p className="mt-2 text-sm text-slate-600">Projeto fixado na homologação. Chamadas usam a sessão atual do usuário, sem exibir ou copiar JWT.</p></header>
    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><p>Empresa atual: <strong>{ownKey ? `Homolog ${ownKey}` : 'não autorizada'}</strong></p><p>Papel atual: <strong>{user?.id ? 'membership será conferida no teste' : 'não autenticado'}</strong></p></section>
    <div className="flex flex-wrap gap-3"><button disabled={running || !ownKey || companyLoading} onClick={createOwnFixture} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Criar fixture própria (cliente fictício)</button><button disabled={running || !ownKey || companyLoading} onClick={runAudit} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Executar testes REST cross-tenant</button></div>
    {message && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</p>}
    {!!results.length && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-slate-50"><th className="p-3">Operação</th><th className="p-3">Resultado</th><th className="p-3">Esperado</th><th className="p-3">Observado</th></tr></thead><tbody>{results.map((item) => <tr key={item.name} className="border-b last:border-0"><td className="p-3 font-medium">{item.name}</td><td className={`p-3 font-semibold ${item.outcome === 'APROVADO' ? 'text-emerald-700' : 'text-rose-700'}`}>{item.outcome}</td><td className="p-3">{item.expected}</td><td className="p-3 font-mono">{JSON.stringify(item.observed)}</td></tr>)}</tbody></table></div>}
  </main>;
}
