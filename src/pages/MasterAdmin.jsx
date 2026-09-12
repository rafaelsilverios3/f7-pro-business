import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Users, ShieldAlert, Activity, RefreshCw, LockKeyhole, Database, Bot, PlugZap } from 'lucide-react';

const API = import.meta.env.VITE_MASTER_ADMIN_API_URL || 'http://127.0.0.1:8787';
const empty = { companies: [], metrics: {} };
const cards = [
  ['companies', 'Empresas', Building2], ['activeCompanies', 'Ativas', Activity], ['users', 'Usuários', Users], ['whatsapp', 'WhatsApps conectados', PlugZap], ['ai', 'IA ativa', Bot], ['errors', 'Erros recentes', ShieldAlert],
];

export default function MasterAdmin() {
  const [data, setData] = useState(empty); const [localToken, setLocalToken] = useState(() => sessionStorage.getItem('f7_master_admin_token') || ''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [selected, setSelected] = useState(null);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(API + '/overview', { headers: { Accept: 'application/json', 'x-master-admin-token': localToken } });
      if (!response.ok) {
        if (response.status === 401) { sessionStorage.removeItem('f7_master_admin_token'); setLocalToken(''); throw new Error('Token local inválido. Informe novamente o token do servidor.'); }
        let detail = '';
        try { const body = await response.json(); detail = typeof body?.message === 'string' ? body.message : ''; } catch { /* resposta não JSON */ }
        throw new Error(detail ? `API local respondeu HTTP ${response.status}: ${detail}` : `API administrativa local respondeu HTTP ${response.status}.`);
      }
      setData(await response.json());
    } catch (cause) {
      const message = cause instanceof TypeError ? 'Não foi possível conectar à API local. Em outro terminal, execute: npm run master-admin' : (cause.message || 'Inicie o servidor administrativo local.');
      setError(message); setData(empty);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (localToken) { sessionStorage.setItem('f7_master_admin_token', localToken); load(); } else setLoading(false); }, [localToken]);
  const metrics = data.metrics || {};
  const companies = useMemo(() => data.companies || [], [data.companies]);
  return <div className="min-h-screen bg-[#07111f] px-5 py-6 text-slate-100 md:px-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-300">F7 MASTER ADMIN</p><h1 className="mt-1 text-2xl font-semibold">Painel administrativo da plataforma</h1></div><div className="flex items-center gap-3"><span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">LOCAL ONLY</span><button type="button" onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-blue-400"><RefreshCw className="mr-2 inline h-4 w-4"/>Atualizar</button></div></header>
    {!localToken && <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-[#0e1a2b] p-3"><LockKeyhole className="h-4 w-4 text-blue-300"/><input type="password" value={localToken} onChange={(event) => setLocalToken(event.target.value)} placeholder="Token administrativo local" className="min-w-64 flex-1 rounded-lg border border-slate-700 bg-[#07111f] px-3 py-2 text-sm text-white outline-none focus:border-blue-400"/><span className="text-xs text-slate-500">O token fica somente nesta sessão do navegador.</span></div>}<div className="mb-6 flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100"><LockKeyhole className="h-4 w-4 shrink-0"/>Painel administrativo local — não disponível publicamente. O navegador nunca recebe service role.</div>
    {error && <div role="alert" className="mb-6 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error} <span className="text-rose-300/70">Configure MASTER_ADMIN_LOCAL_TOKEN no servidor local.</span></div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([key,label,Icon]) => <div key={key} className="rounded-2xl border border-slate-700/80 bg-[#0e1a2b] p-5"><Icon className="h-5 w-5 text-blue-300"/><p className="mt-4 text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-semibold">{loading ? '—' : (metrics[key] ?? 0)}</p></div>)}</div>
    <section className="rounded-2xl border border-slate-700/80 bg-[#0e1a2b] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Empresas</h2><p className="mt-1 text-xs text-slate-400">Visão resumida e isolada por empresa.</p></div><Database className="h-5 w-5 text-slate-500"/></div>{companies.length === 0 ? <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">{loading ? 'Carregando empresas...' : 'Nenhuma empresa retornada pela API local.'}</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-700 text-xs text-slate-400"><tr><th className="px-3 py-3">Empresa</th><th className="px-3 py-3">Plano</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Usuários</th></tr></thead><tbody>{companies.map((company) => <tr key={company.id} onClick={() => setSelected(company)} className="cursor-pointer border-b border-slate-800 hover:bg-blue-500/10"><td className="px-3 py-3"><p className="font-medium">{company.name || 'Sem nome'}</p><p className="text-xs text-slate-500">{company.id}</p></td><td className="px-3 py-3 text-slate-300">{company.plan || '—'}</td><td className="px-3 py-3">{company.status || '—'}</td><td className="px-3 py-3">{company.user_count ?? '—'}</td></tr>)}</tbody></table></div>}</section>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0e1a2b] p-6" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{selected.name || 'Empresa'}</h2><button onClick={() => setSelected(null)} className="text-slate-400">×</button></div><dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-slate-500">Company ID</dt><dd className="mt-1 break-all">{selected.id}</dd></div><div><dt className="text-xs text-slate-500">Plano</dt><dd className="mt-1">{selected.plan || '—'}</dd></div><div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1">{selected.status || '—'}</dd></div><div><dt className="text-xs text-slate-500">Criada em</dt><dd className="mt-1">{selected.created_at ? new Date(selected.created_at).toLocaleDateString('pt-BR') : '—'}</dd></div></dl><p className="mt-6 text-xs text-slate-500">Ações administrativas serão habilitadas somente após a API local autenticada.</p></div></div>}
  </div>;
}
