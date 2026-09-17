import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useOutletContext } from 'react-router-dom';
import { buildFullCampaignPreview, importCommercialCampaign, listCampaigns, parseCampaignWorkbook } from '@/services/commercialCampaignService';
import { supabaseProvider } from '@/data/providers/supabaseProvider';

const QUEUE_FILTERS = ['Todos', 'P1', 'P2', 'P3', 'Não contatados', 'Retorno hoje', 'Atrasados', 'Em negociação', 'Cotação', 'Recuperados', 'Perdidos'];
const money = (value) => value == null ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Campanhas() {
  const { company } = useOutletContext();
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('Todos');
  const [reviewedCustomers, setReviewedCustomers] = useState({});
  const [reviewedProducts, setReviewedProducts] = useState({});
  const [persisted, setPersisted] = useState(null);
  const [importing, setImporting] = useState(false);

  const loadPersisted = async () => {
    if (!company?.id) return;
    try {
      const campaigns = await listCampaigns(company.id);
      const campaign = campaigns[0];
      if (!campaign) { setPersisted(null); return; }
      const [facts, targets] = await Promise.all([
        supabaseProvider.entity('CommercialCampaignFact').filter({ company_id: company.id, campaign_id: campaign.id }, 'source_row', 1000),
        supabaseProvider.entity('CommercialCampaignTarget').filter({ company_id: company.id, campaign_id: campaign.id }, 'source_row', 1000),
      ]);
      setPersisted({ campaign, facts, targets });
    } catch (cause) { setError(cause?.message || 'Não foi possível carregar a campanha persistida.'); }
  };

  useEffect(() => { loadPersisted(); }, [company?.id]);

  const loadPreview = async (file) => {
    if (!file || !company?.id) return;
    setLoading(true); setError(''); setFileName(file.name); setReviewedCustomers({}); setReviewedProducts({});
    try {
      const workbook = await parseCampaignWorkbook(file);
      const result = await buildFullCampaignPreview({ companyId: company.id, workbook });
      setPreview(result);
    } catch (cause) {
      setPreview(null); setError(cause?.message || 'Não foi possível gerar a prévia da planilha.');
    } finally { setLoading(false); }
  };

  const rows = useMemo(() => (preview?.action?.preview?.facts || []).filter((fact) => {
    if (filter === 'Todos') return true;
    if (['P1', 'P2', 'P3'].includes(filter)) return fact.source.priority?.toString().includes(filter);
    if (filter === 'Não contatados') return true;
    return false;
  }), [preview, filter]);
  const totalPotential = preview?.action?.potential || 0;
  const reviewDecision = (scope, key, decision) => {
    const setter = scope === 'customers' ? setReviewedCustomers : setReviewedProducts;
    setter((current) => ({ ...current, [key]: decision }));
  };
  const confirmImport = async () => {
    if (!company?.id || !fileName || !preview) return;
    const phrase = window.prompt('Para importar dados reais, digite: AUTORIZO IMPORTAÇÃO REAL NO F7 TESTE BETA');
    if (phrase !== 'AUTORIZO IMPORTAÇÃO REAL NO F7 TESTE BETA') return;
    const input = document.querySelector('input[type="file"]');
    const file = input?.files?.[0];
    if (!file) return;
    setImporting(true); setError('');
    try { await importCommercialCampaign({ company, file }); await loadPersisted(); }
    catch (cause) { setError(cause?.message || 'A importação não foi concluída.'); }
    finally { setImporting(false); }
  };

  return <div className="mx-auto w-full max-w-[1760px] min-w-0 px-3 py-5 sm:px-5 sm:py-7 xl:px-8">
    <PageHeader title="Campanhas comerciais" subtitle="Matching de origem, fila de recuperação e prévia para revisão humana." />
    {persisted && <PersistedQueue data={persisted} filter={filter} setFilter={setFilter} />}
    <div className={`mt-4 rounded-2xl border p-4 text-sm ${persisted ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <div className="flex items-start gap-3"><ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${persisted ? 'text-emerald-700' : 'text-amber-700'}`} /><div>{persisted ? <><strong>Campanha importada.</strong> A origem permanece preservada; cálculos, fila e recuperação usam os valores canônicos do F7.</> : <><strong>Prévia não confirmada.</strong> Os valores da planilha permanecem como origem; o F7 recalcula diferenças, percentuais e potencial. Nenhum cliente, fato ou alvo desta planilha é gravado até uma autorização de importação real.</>}</div></div>
    </div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-900">Importar planilha para prévia</h2><p className="mt-1 text-xs text-slate-500">A aba esperada é “Plano de Acao”. O catálogo atual do tenant é consultado somente para matching.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><UploadCloud className="h-4 w-4" />Selecionar XLSX<input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(event) => loadPreview(event.target.files?.[0])} /></label></div>
      {fileName && <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><FileSpreadsheet className="h-4 w-4" />{fileName}</p>}
      {loading && <div className="mt-5 flex items-center gap-2 text-sm text-blue-700"><Loader2 className="h-4 w-4 animate-spin" />Consultando clientes e produtos do tenant para gerar a prévia...</div>}
      {error && <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    </section>
    {preview && <>
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UniverseMetric label="Clientes da planilha" value={preview.customers.total} detail="cadastros únicos para matching" />
        <UniverseMetric label="Produtos da planilha" value={preview.products.total} detail="códigos/descrições para matching" />
        <UniverseMetric label="Relações cliente × produto" value={preview.history.total} detail={`${preview.history.ready} prontas · ${preview.history.blocked} bloqueadas`} />
        <UniverseMetric label="Oportunidades analíticas" value={preview.action.total} detail={`P1 ${preview.action.counts.P1} · P2 ${preview.action.counts.P2} · P3 ${preview.action.counts.P3}`} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <UniverseSection title="Clientes da planilha" subtitle={`Total: ${preview.customers.total}. O matching é resolvido uma vez por cliente.`} counts={preview.customers.counts} />
        <UniverseSection title="Produtos da planilha" subtitle={`Total: ${preview.products.total}. Código/SKU tem prioridade antes da descrição.`} counts={preview.products.counts} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <SummaryPanel title="Histórico / matching" value={preview.history.total} items={[["Prontas para importação", preview.history.ready], ["Bloqueadas", preview.history.blocked], ["Divergências de matching", preview.history.divergences]]} />
        <SummaryPanel title="Plano de ação" value={preview.action.total} items={[["P1", preview.action.counts.P1], ["P2", preview.action.counts.P2], ["P3", preview.action.counts.P3], ["Potencial canônico F7", money(totalPotential)]]} />
        <SummaryPanel title="Divergência da fonte" value="" items={[["Gestão Campanha", `${preview.management.opportunities} · ${money(preview.management.potential)}`], ["Plano de ação analítico", `${preview.action.total} · ${money(totalPotential)}`], ["Divergência", `${preview.divergence.opportunities} · ${money(preview.divergence.potential)}`]]} tone="amber" />
      </section>

      <ReviewSection title="Revisão de clientes" rows={preview.customers.rows} valueKey={(row) => row.name} reviewed={reviewedCustomers} onDecision={(key, decision) => reviewDecision('customers', key, decision)} renderLabel={(row) => row.name} renderMeta={(row) => row.match.reason} />
      <ReviewSection title="Revisão de produtos" rows={preview.products.rows} valueKey={(row) => row.sku || row.name} reviewed={reviewedProducts} onDecision={(key, decision) => reviewDecision('products', key, decision)} renderLabel={(row) => row.name || 'Produto sem descrição'} renderMeta={(row) => `${row.sku || 'Sem SKU'} · ${row.match.reason}`} />

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Fila da campanha</h2><p className="mt-1 text-xs text-slate-500">329 oportunidades analíticas. O matching é resolvido nos blocos acima e reutilizado por todas as relações.</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">PRÉVIA · SEM GRAVAÇÃO</span><button type="button" onClick={confirmImport} disabled={importing} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{importing ? 'Importando...' : 'Importar dados reais'}</button></div></div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{QUEUE_FILTERS.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${filter === item ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{item}</button>)}</div>
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200"><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Produto</th><th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Potencial F7</th><th className="px-4 py-3">Divergência</th></tr></thead><tbody>{rows.slice(0, 100).map((fact) => <tr key={fact.idempotencyKey} className="border-t border-slate-100 align-top"><td className="px-4 py-3 font-medium text-slate-800">{fact.source.customer || 'Cliente ausente'}</td><td className="px-4 py-3 text-xs text-slate-600">{fact.source.code || '—'} · {fact.source.product || 'Produto ausente'}</td><td className="px-4 py-3 text-xs font-semibold text-slate-700">{fact.source.priority || '—'}</td><td className="px-4 py-3 font-semibold text-slate-800">{money(fact.reconciliation.potential)}</td><td className="px-4 py-3">{fact.reconciliation.divergence ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Recalcular</span> : <span className="text-xs text-slate-400">Sem divergência</span>}</td></tr>)}</tbody></table></div>{rows.length > 100 && <p className="border-t border-slate-100 p-3 text-center text-xs text-slate-500">Mostrando 100 de {rows.length} oportunidades; nenhuma foi persistida.</p>}{!rows.length && <p className="p-8 text-center text-sm text-slate-500">Nenhuma oportunidade para este filtro.</p>}</div>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Confirmação final</h2><p className="mt-1 text-xs text-slate-500">Esta importação não cria vendas, orçamentos, atividades CRM, altera estoque/financeiro ou toca outros tenants.</p><div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3"><p>Criar <strong>{preview.customers.counts.new}</strong> clientes</p><p>Relacionar <strong>{preview.customers.total - preview.customers.counts.new}</strong> clientes existentes</p><p>Criar <strong>{preview.products.counts.new}</strong> produtos</p><p>Relacionar <strong>{preview.products.total - preview.products.counts.new}</strong> produtos existentes</p><p>Criar <strong>{preview.history.ready}</strong> fatos históricos válidos</p><p>Criar <strong>{preview.action.total}</strong> targets válidos</p><p>Criar <strong>1</strong> campanha</p></div>{preview.history.blocked > 0 && <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />{preview.history.blocked} relações bloqueadas por matching de cliente/produto não exato. O botão de importação permanece desabilitado.</p>}</section>
    </>}
  </div>;
}

function PersistedQueue({ data, filter, setFilter }) {
  const factsById = Object.fromEntries((data.facts || []).map((fact) => [fact.id, fact]));
  const potential = (fact) => Math.max(0, Number(fact?.canonical_base_value || 0) - Number(fact?.canonical_compare_value || 0));
  const grouped = (data.targets || []).filter((target) => filter === 'Todos' || (['P1', 'P2', 'P3'].includes(filter) ? target.imported_priority === filter : filter === 'Não contatados' ? target.status === 'NOT_CONTACTED' : true)).sort((a, b) => ({ P1: 1, P2: 2, P3: 3 }[a.imported_priority] || 9) - ({ P1: 1, P2: 2, P3: 3 }[b.imported_priority] || 9) || potential(factsById[b.fact_id]) - potential(factsById[a.fact_id])).reduce((map, target) => { const fact = factsById[target.fact_id] || {}; const key = target.customer_id || fact.source_customer_name || target.id; const item = map.get(key) || { name: fact.source_customer_name || 'Cliente', priority: target.imported_priority, items: [] }; item.items.push({ target, fact }); map.set(key, item); return map; }, new Map());
  return <section className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">Campanha ativa</p><h2 className="mt-1 text-xl font-semibold text-slate-900">{data.campaign.name}</h2><p className="mt-1 text-xs text-slate-600">Fila real agrupada por cliente · {data.targets.length} targets · nenhum contato automático.</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{data.campaign.status}</span></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{QUEUE_FILTERS.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${filter === item ? 'bg-indigo-700 text-white' : 'border border-indigo-200 bg-white text-indigo-700'}`}>{item}</button>)}</div><div className="mt-4 space-y-3">{[...grouped.values()].slice(0, 100).map((group) => <article key={group.name} className="rounded-xl border border-indigo-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{group.name}</h3><p className="text-xs text-slate-500">{group.items.length} produto(s) · prioridade {group.priority || '—'} · NÃO TRABALHADA</p></div><span className="font-semibold text-slate-800">{money(group.items.reduce((sum, item) => sum + potential(item.fact), 0))}</span></div><div className="mt-3 divide-y divide-slate-100">{group.items.map(({ target, fact }) => <div key={target.id} className="grid gap-2 py-2 text-xs sm:grid-cols-[1.5fr_.7fr_.7fr_.7fr] sm:items-center"><span className="font-medium text-slate-700">{fact.source_product_code || '—'} · {fact.source_product_name || 'Produto'}</span><span className="text-slate-500">FY25 {money(fact.canonical_base_value)}</span><span className="text-slate-500">FY26 {money(fact.canonical_compare_value)}</span><span className="font-semibold text-indigo-700">Potencial {money(potential(fact))}</span></div>)}</div></article>)}{!grouped.size && <p className="p-6 text-center text-sm text-slate-500">Nenhum target neste filtro.</p>}</div></section>;
}

function UniverseMetric({ label, value, detail }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function UniverseSection({ title, subtitle, counts }) {
  const items = [['Exatos', counts.exact], ['Prováveis', counts.probable], ['Ambíguos', counts.ambiguous], ['Novos', counts.new], ['Inválidos', counts.invalid]];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{items.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>)}</div></section>;
}

function SummaryPanel({ title, value, items, tone = 'slate' }) {
  return <section className={`rounded-2xl border p-5 shadow-sm ${tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}><div className="flex items-baseline justify-between gap-2"><h2 className="font-semibold text-slate-900">{title}</h2>{value !== '' && <strong className="text-xl text-slate-900">{value}</strong>}</div><div className="mt-3 space-y-2">{items.map(([label, item]) => <div key={label} className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">{label}</span><strong className="text-right text-slate-900">{item}</strong></div>)}</div></section>;
}

function ReviewSection({ title, rows, valueKey, reviewed, onDecision, renderLabel, renderMeta }) {
  return <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">Uma decisão por registro; todas as relações e oportunidades reutilizam este matching.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{rows.length} registros</span></div><div className="mt-4 max-h-[32rem] overflow-y-auto divide-y divide-slate-100">{rows.map((row) => { const key = valueKey(row); const decision = reviewed[key]; return <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium text-slate-800">{renderLabel(row)}</p><p className="mt-1 text-xs text-slate-500">{renderMeta(row)}</p></div><div className="flex flex-wrap gap-1.5">{[['existing', 'Usar cadastro existente'], ['new', 'Criar novo'], ['ignore', 'Ignorar']].map(([id, label]) => <button key={id} type="button" onClick={() => onDecision(key, id)} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${decision === id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}{decision && <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3 w-3" />Prévia</span>}</div></div>; })}</div></section>;
}
