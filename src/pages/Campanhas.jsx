import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useOutletContext } from 'react-router-dom';
import { buildTenantCampaignPreview, parseWorkbookFile } from '@/services/commercialCampaignService';

const QUEUE_FILTERS = ['Todos', 'P1', 'P2', 'P3', 'Não contatados', 'Retorno hoje', 'Atrasados', 'Em negociação', 'Cotação', 'Recuperados', 'Perdidos'];
const money = (value) => value == null ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Campanhas() {
  const { company } = useOutletContext();
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('Todos');
  const [reviewed, setReviewed] = useState({});

  const loadPreview = async (file) => {
    if (!file || !company?.id) return;
    setLoading(true); setError(''); setFileName(file.name); setReviewed({});
    try {
      const rows = await parseWorkbookFile(file);
      const result = await buildTenantCampaignPreview({ companyId: company.id, rows });
      setPreview(result);
    } catch (cause) {
      setPreview(null); setError(cause?.message || 'Não foi possível gerar a prévia da planilha.');
    } finally { setLoading(false); }
  };

  const rows = useMemo(() => (preview?.facts || []).filter((fact) => {
    if (filter === 'Todos') return true;
    if (['P1', 'P2', 'P3'].includes(filter)) return fact.source.priority?.toString().includes(filter);
    if (filter === 'Não contatados') return true;
    return false;
  }), [preview, filter]);
  const counts = preview?.counts || {};
  const totalPotential = (preview?.facts || []).reduce((sum, fact) => sum + (fact.reconciliation.potential || 0), 0);
  const reviewDecision = (key, decision) => setReviewed((current) => ({ ...current, [key]: decision }));

  return <div className="mx-auto w-full max-w-[1760px] min-w-0 px-3 py-5 sm:px-5 sm:py-7 xl:px-8">
    <PageHeader title="Campanhas comerciais" subtitle="Matching de origem, fila de recuperação e prévia para revisão humana." />
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><strong>Prévia não confirmada.</strong> Os valores da planilha permanecem como origem; o F7 recalcula diferenças, percentuais e potencial. Nenhum cliente, fato ou alvo desta planilha é gravado até uma autorização de importação real.</div></div>
    </div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-900">Importar planilha para prévia</h2><p className="mt-1 text-xs text-slate-500">A aba esperada é “Plano de Acao”. O catálogo atual do tenant é consultado somente para matching.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><UploadCloud className="h-4 w-4" />Selecionar XLSX<input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(event) => loadPreview(event.target.files?.[0])} /></label></div>
      {fileName && <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><FileSpreadsheet className="h-4 w-4" />{fileName}</p>}
      {loading && <div className="mt-5 flex items-center gap-2 text-sm text-blue-700"><Loader2 className="h-4 w-4 animate-spin" />Consultando clientes e produtos do tenant para gerar a prévia...</div>}
      {error && <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    </section>
    {preview && <>
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="Linhas" value={preview.total} />
        <Metric label="Exatos" value={counts.exact || 0} tone="green" />
        <Metric label="Prováveis" value={counts.probable || 0} tone="amber" />
        <Metric label="Ambíguos" value={counts.ambiguous || 0} tone="rose" />
        <Metric label="Novos" value={counts.new || 0} tone="blue" />
        <Metric label="Divergências" value={counts.divergences || 0} tone="amber" />
      </section>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Campanha Lubrificantes FY2025 x FY2026</h2><p className="mt-1 text-xs text-slate-500">Potencial canônico recalculado pelo F7: <strong>{money(totalPotential)}</strong>. Prioridade importada é apenas referência; prioridade F7 ainda não foi inventada.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">IMPORTAÇÃO NÃO CONFIRMADA</span></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{QUEUE_FILTERS.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${filter === item ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{item}</button>)}</div></section>
      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-3">Cliente / produto</th><th className="px-4 py-3">Match</th><th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Potencial F7</th><th className="px-4 py-3">Divergência</th><th className="px-4 py-3">Revisão</th></tr></thead><tbody>{rows.slice(0, 100).map((fact) => { const key = fact.idempotencyKey; const decision = reviewed[key]; return <tr key={key} className="border-t border-slate-100 align-top"><td className="px-4 py-3"><p className="font-medium text-slate-800">{fact.source.customer || 'Cliente ausente'}</p><p className="mt-1 text-xs text-slate-500">{fact.source.code || '—'} · {fact.source.product || 'Produto ausente'}</p></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${fact.matchStatus === 'exact' ? 'bg-emerald-100 text-emerald-700' : fact.matchStatus === 'probable' ? 'bg-amber-100 text-amber-700' : fact.matchStatus === 'ambiguous' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{fact.matchStatus}</span><p className="mt-1 max-w-xs text-[11px] text-slate-500">{fact.customerMatch.reason}; {fact.productMatch.reason}</p></td><td className="px-4 py-3 text-xs font-semibold text-slate-700">{fact.source.priority || '—'}</td><td className="px-4 py-3 font-semibold text-slate-800">{money(fact.reconciliation.potential)}</td><td className="px-4 py-3">{fact.reconciliation.divergence ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Recalcular</span> : <span className="text-xs text-slate-400">Sem divergência</span>}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">{[['existing', 'Usar cadastro existente'], ['new', 'Criar novo'], ['ignore', 'Ignorar']].map(([id, label]) => <button key={id} type="button" onClick={() => reviewDecision(key, id)} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${decision === id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div>{decision && <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3 w-3" />Decisão apenas na prévia</p>}</td></tr>; })}</tbody></table></div>{rows.length > 100 && <p className="border-t border-slate-100 p-3 text-center text-xs text-slate-500">Mostrando 100 de {rows.length} linhas; nenhuma foi persistida.</p>}{!rows.length && <p className="p-8 text-center text-sm text-slate-500">Nenhuma linha para este filtro.</p>}</section>
    </>}
  </div>;
}

function Metric({ label, value, tone = 'slate' }) {
  const tones = { slate: 'border-slate-200 text-slate-800', green: 'border-emerald-200 text-emerald-700', amber: 'border-amber-200 text-amber-700', rose: 'border-rose-200 text-rose-700', blue: 'border-blue-200 text-blue-700' };
  return <div className={`rounded-xl border bg-white p-4 shadow-sm ${tones[tone]}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
