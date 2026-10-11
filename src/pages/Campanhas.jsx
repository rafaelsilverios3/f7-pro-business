import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useOutletContext } from 'react-router-dom';
import { buildFullCampaignPreview, importCommercialCampaign, listCampaigns, listSuccessfulCampaignImports, parseCampaignWorkbook, resumeCommercialCampaignImport } from '@/services/commercialCampaignService';
import { supabaseProvider } from '@/data/providers/supabaseProvider';

const QUEUE_FILTERS = ['Todos', 'P1', 'P2', 'P3', 'Não contatados', 'Retorno hoje', 'Atrasados', 'Em negociação', 'Cotação', 'Recuperados', 'Perdidos'];
const money = (value) => value == null ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Campanhas() {
  const { company } = useOutletContext();
  const [preview, setPreview] = useState(null);
  const [parsedWorkbook, setParsedWorkbook] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('Todos');
  const [reviewedCustomers, setReviewedCustomers] = useState({});
  const [reviewedProducts, setReviewedProducts] = useState({});
  const [persisted, setPersisted] = useState(null);
  const [importing, setImporting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [importState, setImportState] = useState('preview');
  const parseControllerRef = useRef(null);
  const previewRequestRef = useRef(0);

  const loadPersisted = async () => {
    if (!company?.id) return;
    try {
      const imports = await listSuccessfulCampaignImports(company.id);
      const imported = imports[0];
      if (!imported?.campaign_id) { setPersisted(null); return; }
      const campaigns = await listCampaigns(company.id);
      const campaign = campaigns.find((item) => item.id === imported.campaign_id);
      if (!campaign) { setPersisted(null); return; }
      const [facts, targets] = await Promise.all([
        supabaseProvider.entity('CommercialCampaignFact').filter({ company_id: company.id, campaign_id: campaign.id }, 'source_row', 1000),
        supabaseProvider.entity('CommercialCampaignTarget').filter({ company_id: company.id, campaign_id: campaign.id }, 'source_row', 1000),
      ]);
      const entities = await supabaseProvider.entity('commercial_campaign_import_entities').filter({ company_id: company.id, import_id: imported.id }, 'source_key', 5000);
      const partial = Number(imported.rows_total || 0) > 0 && (facts.length === 0 || targets.length === 0);
      setPersisted({ campaign, importRecord: imported, facts, targets, entities, partial });
      setImportState(partial ? 'partial' : 'success');
      if (partial) setError(`O batch ${imported.id} foi registrado, mas os registros derivados estão incompletos (fatos: ${facts.length}; targets: ${targets.length}). Nenhum dado é considerado pronto para operação.`);
    } catch (cause) { setError(cause?.message || 'Não foi possível carregar a campanha persistida.'); }
  };

  useEffect(() => {
    setPreview(null); setParsedWorkbook(null); setSelectedFile(null); setFileName(''); setError('');
    loadPersisted();
    return () => {
      previewRequestRef.current += 1;
      parseControllerRef.current?.abort();
    };
  }, [company?.id]);

  const loadPreview = async (file) => {
    if (!file || !company?.id) return;
    parseControllerRef.current?.abort();
    const controller = new AbortController();
    parseControllerRef.current = controller;
    const requestId = ++previewRequestRef.current;
    setSelectedFile(file); setParsedWorkbook(null); setPreview(null);
    setLoading(true); setError(''); setImportState('preview'); setFileName(file.name); setReviewedCustomers({}); setReviewedProducts({});
    try {
      const workbook = await parseCampaignWorkbook(file, { signal: controller.signal });
      if (requestId !== previewRequestRef.current) return;
      setParsedWorkbook(workbook);
      const result = await buildFullCampaignPreview({ companyId: company.id, workbook });
      if (requestId !== previewRequestRef.current) return;
      setPreview(result);
    } catch (cause) {
      if (requestId === previewRequestRef.current && cause?.name !== 'AbortError') {
        setParsedWorkbook(null); setPreview(null); setError(cause?.message || 'Não foi possível gerar a prévia da planilha.');
      }
    } finally { if (requestId === previewRequestRef.current) setLoading(false); }
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
    if (!company?.id || !fileName || !preview || !parsedWorkbook || !selectedFile) return;
    const phrase = window.prompt('Para importar dados reais, digite: AUTORIZO IMPORTAÇÃO REAL NO F7 TESTE BETA');
    if (phrase !== 'AUTORIZO IMPORTAÇÃO REAL NO F7 TESTE BETA') return;
    setImporting(true); setImportState('importing'); setError('');
    try {
      const result = await importCommercialCampaign({ company, file: selectedFile, workbook: parsedWorkbook });
      await loadPersisted();
      if (!result?.importId) throw new Error('A importação não retornou um batch confirmado.');
      if (result.status === 'already_imported') setImportState('partial');
      if (result.status === 'imported' && Number(result.counts?.facts_blocked || 0) === 0 && Number(result.counts?.targets_blocked || 0) === 0) setImportState('success');
    } catch (cause) { setImportState('error'); setError(cause?.message || 'A importação não foi concluída.'); }
    finally { setImporting(false); }
  };

  const resumeImport = async () => {
    if (!company?.id || !persisted?.partial) return;
    if (!selectedFile || !parsedWorkbook) { setError('Selecione novamente o mesmo XLSX usado no batch parcial antes de concluir.'); return; }
    const phrase = window.prompt('Para concluir o batch parcial, digite: CONCLUIR IMPORTAÇÃO PENDENTE');
    if (phrase !== 'CONCLUIR IMPORTAÇÃO PENDENTE') return;
    setResuming(true); setImportState('importing'); setError('');
    try {
      const result = await resumeCommercialCampaignImport({ company, file: selectedFile, workbook: parsedWorkbook, importRecord: persisted.importRecord });
      if (!result?.importId) throw new Error('A continuação não retornou um batch confirmado.');
      await loadPersisted();
    } catch (cause) { setImportState('error'); setError(cause?.message || 'Não foi possível concluir a campanha pendente.'); }
    finally { setResuming(false); }
  };

  const statusBanner = importState === 'partial'
    ? { tone: 'error', title: 'Importação parcial detectada.', detail: 'O batch existe, mas fatos históricos e/ou targets não foram persistidos. A fila permanece bloqueada até revisão técnica; não tente importar novamente.' }
    : importState === 'success' && persisted
    ? { tone: 'success', title: 'Campanha importada com sucesso.', detail: 'O batch foi confirmado; a origem permanece preservada e cálculos, fila e recuperação usam os valores canônicos do F7.' }
    : importState === 'importing'
      ? { tone: 'loading', title: 'Importando campanha...', detail: 'A operação é atômica. Nenhum dado é considerado confirmado até o batch ser persistido.' }
      : importState === 'error'
        ? { tone: 'error', title: 'Importação não concluída.', detail: 'Nenhuma confirmação de import batch foi registrada. Verifique o erro técnico abaixo antes de tentar novamente.' }
        : { tone: 'preview', title: 'Prévia · sem gravação.', detail: 'Os valores da planilha permanecem como origem; o F7 recalcula diferenças, percentuais e potencial. Nenhum registro é gravado nesta etapa.' };
  const bannerTone = {
    success: 'border-emerald-400/30 bg-emerald-950/40 text-emerald-100',
    error: 'border-rose-400/30 bg-rose-950/40 text-rose-100',
    loading: 'border-blue-400/30 bg-blue-950/40 text-blue-100',
    preview: 'border-amber-400/30 bg-amber-950/40 text-amber-100',
  }[statusBanner.tone];
  const iconTone = {
    success: 'text-emerald-300',
    error: 'text-rose-300',
    loading: 'text-blue-300',
    preview: 'text-amber-300',
  }[statusBanner.tone];

  return <div className="campaigns-page mx-auto w-full max-w-[1760px] min-w-0 px-3 py-5 sm:px-5 sm:py-7 xl:px-8">
    <PageHeader title="Campanhas comerciais" subtitle="Matching de origem, fila de recuperação e prévia para revisão humana." />
    {persisted && !persisted.partial && <PersistedQueue data={persisted} filter={filter} setFilter={setFilter} />}
    <div className={`campaign-status-banner mt-4 rounded-2xl border p-4 text-sm ${bannerTone}`}>
      <div className="flex items-start gap-3"><ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} /><div><strong>{statusBanner.title}</strong> {statusBanner.detail}</div></div>
    </div>
    {persisted?.partial && <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-950/20 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-rose-100">Concluir campanha pendente</h2><p className="mt-1 text-xs text-rose-200/80">Clientes e produtos já estão preservados. Esta ação cria somente os fatos históricos e as oportunidades ainda ausentes, usando o mesmo arquivo e o mesmo batch.</p></div><button type="button" onClick={resumeImport} disabled={resuming || importing} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{resuming ? 'Concluindo...' : 'Concluir importação pendente'}</button></div>
      <p className="mt-3 text-xs text-rose-200/70">Nenhuma venda, orçamento, atividade CRM, estoque ou financeiro será criado.</p>
    </section>}
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-900">Importar planilha para prévia</h2><p className="mt-1 text-xs text-slate-500">A aba esperada é “Plano de Acao”. O catálogo atual do tenant é consultado somente para matching.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><UploadCloud className="h-4 w-4" />Selecionar XLSX<input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(event) => loadPreview(event.target.files?.[0])} /></label></div>
      {fileName && <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><FileSpreadsheet className="h-4 w-4" />{fileName}</p>}
      {loading && <div className="mt-5 flex items-center gap-2 text-sm text-blue-700"><Loader2 className="h-4 w-4 animate-spin" />Consultando clientes e produtos do tenant para gerar a prévia...</div>}
      {error && <div className="mt-4 rounded-lg border border-rose-400/30 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>}
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
  // A completed batch is authoritative for the campaign dashboard. Import
  // entities are only the catalog-audit trail and may not contain rows when a
  // partial batch was resumed. Derive the related universes from the
  // persisted, canonical facts/targets instead of showing misleading zeros.
  const customerIds = new Set((data.targets || []).map((target) => target.customer_id).filter(Boolean));
  const productIds = new Set((data.targets || []).map((target) => target.product_id).filter(Boolean));
  (data.facts || []).forEach((fact) => {
    if (fact.customer_id) customerIds.add(fact.customer_id);
    if (fact.product_id) productIds.add(fact.product_id);
  });
  const customerCount = customerIds.size || new Set((data.entities || []).filter((row) => row.entity_type === 'customer').map((row) => row.entity_id)).size;
  const productCount = productIds.size || new Set((data.entities || []).filter((row) => row.entity_type === 'product').map((row) => row.entity_id)).size;
  const priorityCounts = (data.targets || []).reduce((acc, target) => { if (target.imported_priority) acc[target.imported_priority] = (acc[target.imported_priority] || 0) + 1; return acc; }, {});
  const canonicalPotential = (data.targets || []).reduce((sum, target) => sum + Math.max(0, Number(target.canonical_potential || 0)), 0);
  const grouped = (data.targets || []).filter((target) => filter === 'Todos' || (['P1', 'P2', 'P3'].includes(filter) ? target.imported_priority === filter : filter === 'Não contatados' ? target.status === 'NOT_CONTACTED' : true)).sort((a, b) => ({ P1: 1, P2: 2, P3: 3 }[a.imported_priority] || 9) - ({ P1: 1, P2: 2, P3: 3 }[b.imported_priority] || 9) || potential(factsById[b.fact_id]) - potential(factsById[a.fact_id])).reduce((map, target) => { const fact = factsById[target.fact_id] || {}; const key = target.customer_id || fact.source_customer_name || target.id; const item = map.get(key) || { name: fact.source_customer_name || 'Cliente', priority: target.imported_priority, items: [] }; item.items.push({ target, fact }); map.set(key, item); return map; }, new Map());
  return <section className="campaign-active mt-5 rounded-2xl border p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">Campanha ativa</p><h2 className="mt-1 text-xl font-semibold text-slate-900">{data.campaign.name}</h2><p className="mt-1 text-xs text-slate-300">Batch confirmado · nenhum contato automático.</p></div><span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">{data.campaign.status}</span></div><div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-4"><span>Clientes relacionados: <strong>{customerCount}</strong></span><span>Produtos relacionados: <strong>{productCount}</strong></span><span>Fatos históricos: <strong>{data.facts.length}</strong></span><span>Oportunidades: <strong>{data.targets.length}</strong></span><span>P1: <strong>{priorityCounts.P1 || 0}</strong></span><span>P2: <strong>{priorityCounts.P2 || 0}</strong></span><span>P3: <strong>{priorityCounts.P3 || 0}</strong></span><span>Potencial F7: <strong>{money(canonicalPotential)}</strong></span></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{QUEUE_FILTERS.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${filter === item ? 'bg-indigo-600 text-white' : 'border border-blue-400/30 bg-[#10213a] text-blue-200 hover:bg-[#17345b]'}`}>{item}</button>)}</div><div className="mt-4 space-y-3">{[...grouped.values()].slice(0, 100).map((group) => <article key={group.name} className="rounded-xl border border-blue-400/20 bg-[#0d1b2e] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-slate-100">{group.name}</h3><p className="text-xs text-slate-400">{group.items.length} produto(s) · prioridade {group.priority || '—'} · NÃO TRABALHADA</p></div><span className="font-semibold text-slate-100">{money(group.items.reduce((sum, item) => sum + potential(item.fact), 0))}</span></div><div className="mt-3 divide-y divide-blue-200/10">{group.items.map(({ target, fact }) => <div key={target.id} className="grid gap-2 py-2 text-xs sm:grid-cols-[1.5fr_.7fr_.7fr_.7fr] sm:items-center"><span className="font-medium text-slate-200">{fact.source_product_code || '—'} · {fact.source_product_name || 'Produto'}</span><span className="text-slate-400">FY25 {money(fact.canonical_base_value)}</span><span className="text-slate-400">FY26 {money(fact.canonical_compare_value)}</span><span className="font-semibold text-blue-300">Potencial {money(potential(fact))}</span></div>)}</div></article>)}{!grouped.size && <p className="p-6 text-center text-sm text-slate-400">Nenhum target neste filtro.</p>}</div></section>;
}

function UniverseMetric({ label, value, detail }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function UniverseSection({ title, subtitle, counts }) {
  const items = [['Exatos', counts.exact], ['Prováveis', counts.probable], ['Ambíguos', counts.ambiguous], ['Novos', counts.new], ['Inválidos', counts.invalid]];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{items.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>)}</div></section>;
}

function SummaryPanel({ title, value, items, tone = 'slate' }) {
  return <section className={`rounded-2xl border p-5 shadow-sm ${tone === 'amber' ? 'campaign-source-divergence border-amber-400/30 bg-amber-950/40' : 'border-slate-200 bg-white'}`}><div className="flex items-baseline justify-between gap-2"><h2 className="font-semibold text-slate-900">{title}</h2>{value !== '' && <strong className="text-xl text-slate-900">{value}</strong>}</div><div className="mt-3 space-y-2">{items.map(([label, item]) => <div key={label} className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">{label}</span><strong className="text-right text-slate-900">{item}</strong></div>)}</div></section>;
}

function ReviewSection({ title, rows, valueKey, reviewed, onDecision, renderLabel, renderMeta }) {
  return <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">Uma decisão por registro; todas as relações e oportunidades reutilizam este matching.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{rows.length} registros</span></div><div className="mt-4 max-h-[32rem] overflow-y-auto divide-y divide-slate-100">{rows.map((row) => { const key = valueKey(row); const decision = reviewed[key]; return <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium text-slate-800">{renderLabel(row)}</p><p className="mt-1 text-xs text-slate-500">{renderMeta(row)}</p></div><div className="flex flex-wrap gap-1.5">{[['existing', 'Usar cadastro existente'], ['new', 'Criar novo'], ['ignore', 'Ignorar']].map(([id, label]) => <button key={id} type="button" onClick={() => onDecision(key, id)} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${decision === id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}{decision && <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3 w-3" />Prévia</span>}</div></div>; })}</div></section>;
}
