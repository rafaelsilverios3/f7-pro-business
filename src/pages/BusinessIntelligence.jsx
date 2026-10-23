import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Activity, AlertTriangle, Archive, BarChart3, Check, ClipboardList, FileSpreadsheet, FileUp, History, Link2, Loader2, Plus, Printer, RefreshCw, Search, ShieldCheck, TrendingUp, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageHeader from '@/components/layout/PageHeader';
import { useAuth } from '@/lib/AuthContext';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';
import { can } from '@/lib/permissions';
import { buildBIAnalysis, hashBIFile, parseBIWorkbook, parseBIGenericSheet, validateBIItems } from '@/lib/businessIntelligence';
import { callBIShare, createBIStudy, loadBIAudit, listBIImports, listBIStudies, loadBIDecisions, loadBIItems, persistBIImport, recordBIDecision, updateBIStudy } from '@/services/businessIntelligenceService';

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const MONTH_COLORS = ['#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f472b6', '#a78bfa'];
const STATUS_LABEL = { recommended: 'Recomendado', review: 'Exige revisão', approved: 'Aprovado', adjusted: 'Ajustado', discarded: 'Descartado', waiting: 'Aguardando dados' };
const SECTION_LABELS = { summary: 'Resumo executivo', charts: 'Gráficos de consumo', alerts: 'Itens para revisão', recommendations: 'Recomendações', methodology: 'Metodologia e limitações' };

function Card({ children, className = '' }) { return <section className={`rounded-2xl border border-border bg-card text-card-foreground shadow-sm ${className}`}>{children}</section>; }
function Metric({ label, value, detail, icon: Icon, color = 'text-primary', onClick }) { return <button type="button" onClick={onClick} className="min-w-0 rounded-2xl border border-border bg-card p-4 text-left text-card-foreground shadow-sm transition hover:border-primary/50"><div className="flex items-start justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">{label}</span>{Icon && <Icon className={`h-4 w-4 shrink-0 ${color}`} />}</div><div className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>{detail && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}</button>; }
function Field({ label, children, className = '' }) { return <label className={`block min-w-0 text-xs font-medium text-foreground ${className}`}><span className="mb-1.5 block">{label}</span>{children}</label>; }
function TextInput(props) { return <input {...props} className={`w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 ${props.className || ''}`} />; }
function SelectInput(props) { return <select {...props} className={`w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${props.className || ''}`} />; }
function ActionButton({ children, disabled, secondary = false, onClick, type = 'button' }) { return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-border bg-background text-foreground hover:bg-accent' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>{children}</button>; }
function Modal({ title, onClose, children }) { return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-label={title} className="f7-dialog-content max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl"><div className="mb-4 flex items-start justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Fechar" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-5 w-5" /></button></div>{children}</div></div>; }

function AutoMapping({ sheet }) {
  const values = sheet?.headers || [];
  const find = (regexp) => values.findIndex((value) => regexp.test(String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()));
  return { code: find(/^(CODIGO|COD|SKU|ITEM|PART NUMBER|REFERENCIA)$/), description: find(/^(DESCRICAO|PRODUTO|NOME)$/), unit: find(/^(UNIDADE|FILIAL|PLANTA|LOCAL|SITE)$/), period: find(/^(COMPETENCIA|MES|MES REF|MONTH|PERIODO)$/), quantity: find(/^(QUANTIDADE|QTD|CONSUMO|VOLUME)$/), abc: find(/^ABC/), turn: find(/^GIRO/), historicalValue: find(/^(VALOR HIST|VALOR FINANCEIRO|VALOR TOTAL)/), stock: find(/^(ESTOQUE|SALDO)/), openOrders: find(/^(PEDIDOS ABERTOS|ORDEM ABERTA|OPEN ORDERS)/), substitution: find(/^(SUBSTITUICAO|CODIGO SUBSTITUTO)/) };
}

export default function BusinessIntelligence() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const membership = useCompanyMembership(company?.id);
  const role = String(membership?.role || user?.role || '').toLowerCase();
  const canManage = can({ role }, 'business_intelligence.manage');
  const [studies, setStudies] = useState([]);
  const [study, setStudy] = useState(null);
  const [imports, setImports] = useState([]);
  const [activeImport, setActiveImport] = useState(null);
  const [items, setItems] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showStudyForm, setShowStudyForm] = useState(false);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parsedWorkbook, setParsedWorkbook] = useState(null);
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState({});
  const [unitFallback, setUnitFallback] = useState('');
  const [dataCutoff, setDataCutoff] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [unitFilter, setUnitFilter] = useState('Todas');
  const [abcFilter, setAbcFilter] = useState('Todos');
  const [turnFilter, setTurnFilter] = useState('Todos');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [query, setQuery] = useState('');
  const [detailItem, setDetailItem] = useState(null);
  const [decisionItem, setDecisionItem] = useState(null);
  const [decisionStatus, setDecisionStatus] = useState('review');
  const [decisionReason, setDecisionReason] = useState('');
  const [adjustedQuantity, setAdjustedQuantity] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSections, setShareSections] = useState(['summary', 'charts', 'recommendations', 'methodology']);
  const [shareDays, setShareDays] = useState('30');
  const [sharePassword, setSharePassword] = useState('');
  const [createdShare, setCreatedShare] = useState(null);
  const [shares, setShares] = useState([]);

  const loadStudies = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true); setError('');
    try {
      const rows = await listBIStudies(company.id);
      setStudies(rows);
      setStudy((current) => rows.find((item) => item.id === current?.id) || rows[0] || null);
    } catch (cause) { setError(cause.message || 'Não foi possível carregar a área de BI.'); }
    finally { setLoading(false); }
  }, [company?.id]);

  const loadStudyData = useCallback(async (selectedStudy, requestedImportId = null) => {
    if (!company?.id || !selectedStudy?.id) return;
    setError('');
    try {
      const [versions, auditRows] = await Promise.all([listBIImports(company.id, selectedStudy.id), loadBIAudit(company.id, selectedStudy.id)]);
      setImports(versions); setAudit(auditRows);
      const imported = versions.find((entry) => entry.status === 'complete' && (!requestedImportId || entry.id === requestedImportId)) || null;
      setActiveImport(imported);
      if (imported) {
        const [itemRows, decisionRows] = await Promise.all([loadBIItems(company.id, imported.id), loadBIDecisions(company.id, imported.id)]);
        setItems(itemRows); setDecisions(decisionRows);
      } else { setItems([]); setDecisions([]); }
      setShares((await callBIShare({ action: 'list', study_id: selectedStudy.id })).shares || []);
    } catch (cause) { setError(cause.message || 'Não foi possível carregar esta versão do estudo.'); }
  }, [company?.id]);

  useEffect(() => { loadStudies(); }, [loadStudies]);
  useEffect(() => {
    setImports([]); setActiveImport(null); setItems([]); setDecisions([]); setAudit([]); setShares([]);
    if (study) loadStudyData(study);
  }, [study?.id, company?.id, loadStudyData]);

  const analysis = useMemo(() => buildBIAnalysis(items, decisions, { unit: unitFilter, query, abc: abcFilter, turn: turnFilter, status: statusFilter }), [items, decisions, unitFilter, query, abcFilter, turnFilter, statusFilter]);
  const [form, setForm] = useState({ name: '', client_name: '', description: '' });

  const createStudy = async (event) => {
    event.preventDefault();
    if (!company?.id || !user?.id) return;
    setBusy(true); setError('');
    try {
      const created = await createBIStudy({ companyId: company.id, userId: user.id, ...form });
      setShowStudyForm(false); setForm({ name: '', client_name: '', description: '' });
      const rows = await listBIStudies(company.id); setStudies(rows); setStudy(created); setNotice('Estudo criado. Importe uma planilha para gerar a primeira versão.');
    } catch (cause) { setError(cause.message || 'Não foi possível criar o estudo.'); }
    finally { setBusy(false); }
  };

  const handleFile = async (selected) => {
    if (!selected) return;
    setFile(selected); setParsed(null); setParsedWorkbook(null); setError(''); setNotice(''); setImportPreviewOpen(true); setBusy(true);
    try {
      const result = await parseBIWorkbook(selected);
      setDataCutoff(result.source_metadata?.cutoff_hint || '');
      if (result.model === 'generic') {
        const firstSheet = result.sheets.find((candidate) => candidate.headers.length > 0);
        const defaultMap = AutoMapping(firstSheet);
        setParsed(result); setParsedWorkbook(result.workbook); setSheetName(firstSheet?.name || ''); setMapping(defaultMap);
        setUnitFallback('');
      } else { setParsed(result); setParsedWorkbook(null); }
    } catch (cause) { setError(cause.message || 'Falha ao ler a planilha.'); }
    finally { setBusy(false); }
  };

  const genericPreview = useMemo(() => {
    if (!parsed || parsed.model !== 'generic' || !parsedWorkbook || !sheetName) return null;
    const selectedSheet = parsed.sheets.find((entry) => entry.name === sheetName);
    const values = { ...mapping };
    if (values.code < 0) values.code = selectedSheet?.headers.findIndex((header) => /cod|sku|refer/i.test(header)) ?? -1;
    if (values.description < 0) values.description = selectedSheet?.headers.findIndex((header) => /descr|produto|nome/i.test(header)) ?? -1;
    try { return parseBIGenericSheet(parsedWorkbook, { sheetName, mapping: values, unitFallback, sourceMetadata: { source: file?.name || '' }, dataCutoff }); }
    catch (cause) { return { error: cause.message }; }
  }, [parsed, parsedWorkbook, sheetName, mapping, unitFallback, dataCutoff, file?.name]);
  const previewDataset = parsed?.model === 'generic' ? (genericPreview && !genericPreview.error ? genericPreview : null) : parsed;
  const previewErrors = useMemo(() => previewDataset ? validateBIItems(previewDataset.items) : [], [previewDataset]);

  const saveImport = async () => {
    if (!study || !file || !previewDataset || previewErrors.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const digest = await hashBIFile(file);
      const saved = await persistBIImport({ companyId: company.id, userId: user.id, studyId: study.id, file, parsed: { ...previewDataset, source_sha256: digest }, dataCutoff, sourceNote });
      setImportPreviewOpen(false); setFile(null); setParsed(null); setParsedWorkbook(null); setNotice(`Versão ${saved.version} importada com ${number(saved.row_count)} itens. A versão anterior permanece disponível.`);
      await loadStudyData(study, saved.id);
    } catch (cause) { setError(cause.message || 'Não foi possível concluir a importação.'); }
    finally { setBusy(false); }
  };

  const saveDecision = async (event) => {
    event.preventDefault();
    if (!decisionItem || !study || !activeImport || !user?.id) return;
    setBusy(true); setError('');
    try {
      await recordBIDecision({ companyId: company.id, userId: user.id, studyId: study.id, importId: activeImport.id, item: decisionItem, status: decisionStatus, reason: decisionReason, adjustedQuantity });
      const [nextDecisions, nextAudit] = await Promise.all([loadBIDecisions(company.id, activeImport.id), listBIAudit(company.id, study.id)]);
      setDecisions(nextDecisions); setAudit(nextAudit); setDecisionItem(null); setDecisionReason(''); setNotice('Decisão registrada no histórico auditável do estudo.');
    } catch (cause) { setError(cause.message || 'Não foi possível registrar a decisão.'); }
    finally { setBusy(false); }
  };

  const makeShare = async (event) => {
    event.preventDefault();
    if (!study || !activeImport || !shareSections.length) return;
    setBusy(true); setError('');
    try {
      const result = await callBIShare({ action: 'create', study_id: study.id, import_id: activeImport.id, sections: shareSections, expires_in_days: Number(shareDays), password: sharePassword || null });
      setCreatedShare(result); setSharePassword(''); setShares((current) => [result.share, ...current]); setNotice('Link externo criado para esta versão fixa do estudo.');
    } catch (cause) { setError(cause.message || 'Não foi possível criar o link.'); }
    finally { setBusy(false); }
  };

  const revokeShare = async (shareId) => {
    if (!study || !window.confirm('Revogar imediatamente este link externo?')) return;
    setBusy(true); setError('');
    try {
      await callBIShare({ action: 'revoke', study_id: study.id, share_id: shareId });
      setShares((current) => current.map((share) => share.id === shareId ? { ...share, revoked_at: new Date().toISOString() } : share));
      setNotice('O link foi revogado.');
    } catch (cause) { setError(cause.message || 'Não foi possível revogar o link.'); }
    finally { setBusy(false); }
  };

  const archiveStudy = async () => {
    if (!study || study.status === 'archived' || !window.confirm('Arquivar este estudo? Os dados e versões permanecerão preservados.')) return;
    setBusy(true); setError('');
    try { const updated = await updateBIStudy(company.id, study.id, { status: 'archived' }); setStudy(updated); setStudies((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice('Estudo arquivado; histórico preservado.'); }
    catch (cause) { setError(cause.message || 'Não foi possível arquivar o estudo.'); }
    finally { setBusy(false); }
  };

  const dataSourceLabel = activeImport?.source_metadata?.source || activeImport?.source_metadata?.model || 'Importação tabular';
  const byUnit = analysis.byUnit;
  const selectedUnitSummary = unitFilter === 'Todas' ? null : byUnit.find((entry) => entry.unit === unitFilter);
  const pieData = Object.entries(analysis.totals.abc).map(([name, value]) => ({ name: `Curva ${name}`, value }));
  const forecastChart = selectedUnitSummary ? selectedUnitSummary.forecast.map((row) => ({ month: row.month, [selectedUnitSummary.unit]: row.codes })) : analysis.forecast.map((row) => ({ month: row.month, códigos: row.codes, unidades: row.quantity }));

  if (loading) return <div className="flex min-h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando F7 BI…</div>;

  return <div className="mx-auto w-full max-w-[1760px] min-w-0 px-3 py-5 sm:px-5 sm:py-7 xl:px-8">
    <PageHeader title="F7 Business Intelligence" subtitle="Transforme planilhas em estudos versionados, análises rastreáveis e painéis seguros para compartilhar." action={canManage ? <><ActionButton secondary onClick={() => setShowStudyForm(true)}><Plus className="h-4 w-4" />Novo estudo</ActionButton>{study && <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><FileUp className="h-4 w-4" />Importar dados<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => { handleFile(event.target.files?.[0]); event.target.value = ''; }} /></label>}</> : null} />

    {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span><button className="ml-auto" onClick={() => setError('')} aria-label="Dispensar"><X className="h-4 w-4" /></button></div>}
    {notice && <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-foreground"><Check className="h-4 w-4 text-emerald-500" />{notice}<button className="ml-auto text-muted-foreground" onClick={() => setNotice('')} aria-label="Dispensar"><X className="h-4 w-4" /></button></div>}

    {!study ? <Card className="p-6 sm:p-10"><div className="mx-auto max-w-xl text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BarChart3 className="h-7 w-7" /></div><h2 className="text-xl font-semibold">Comece um estudo de BI</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Crie um projeto para uma análise empresarial. Os arquivos são lidos no navegador e apenas os dados normalizados, sua origem e a versão são salvos no espaço isolado da empresa.</p>{canManage && <div className="mt-5"><ActionButton onClick={() => setShowStudyForm(true)}><Plus className="h-4 w-4" />Criar estudo</ActionButton></div>}</div></Card> : <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SelectInput aria-label="Estudo selecionado" className="max-w-lg" value={study.id} onChange={(event) => setStudy(studies.find((item) => item.id === event.target.value) || null)}>{studies.map((item) => <option key={item.id} value={item.id}>{item.name}{item.client_name ? ` · ${item.client_name}` : ''}{item.status === 'archived' ? ' · Arquivado' : ''}</option>)}</SelectInput>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{imports.filter((entry) => entry.status === 'complete').length} versões</span>
        {study.status === 'archived' && <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Arquivado</span>}
        {canManage && study.status !== 'archived' && <ActionButton secondary onClick={archiveStudy}><Archive className="h-4 w-4" />Arquivar estudo</ActionButton>}
        {activeImport && <div className="ml-auto flex flex-wrap items-center gap-2"><SelectInput aria-label="Versão do estudo" className="w-auto min-w-[150px]" value={activeImport.id} onChange={(event) => loadStudyData(study, event.target.value)}>{imports.filter((entry) => entry.status === 'complete').map((entry) => <option key={entry.id} value={entry.id}>Versão {entry.version} · {new Date(entry.completed_at || entry.created_at).toLocaleDateString('pt-BR')}</option>)}</SelectInput><ActionButton secondary onClick={() => loadStudyData(study)}><RefreshCw className="h-4 w-4" />Atualizar</ActionButton>{canManage && <ActionButton onClick={() => { setCreatedShare(null); setShareOpen(true); }}><Link2 className="h-4 w-4" />Compartilhar análise</ActionButton>}</div>}
      </div>

      {!activeImport ? <Card className="p-6 sm:p-9"><div className="mx-auto max-w-xl text-center"><FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-primary" /><h2 className="text-lg font-semibold">Este estudo ainda não tem uma importação confirmada</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Selecione um arquivo XLSX, XLS ou CSV. A prévia identifica a estrutura antes de salvar uma nova versão. Importações anteriores nunca são sobrescritas.</p>{canManage && <div className="mt-4"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><FileUp className="h-4 w-4" />Selecionar arquivo<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => { handleFile(event.target.files?.[0]); event.target.value = ''; }} /></label></div>}</div>{imports.some((entry) => entry.status === 'failed') && <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">{imports.filter((entry) => entry.status === 'failed').length} importação(ões) incompleta(s) mantida(s) fora da análise ativa.</p>}</Card> : <>
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3 text-xs"><div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground"><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-500" />Versão imutável {activeImport.version}</span><span>Origem: {dataSourceLabel}</span><span>Data de corte: {activeImport.data_cutoff ? new Date(`${activeImport.data_cutoff}T12:00:00`).toLocaleDateString('pt-BR') : 'não informada'}</span><span>{number(activeImport.row_count)} códigos/unidades importados</span></div><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-foreground hover:bg-accent"><Printer className="h-4 w-4" />Imprimir / PDF</button></Card>

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Códigos distintos" value={number(analysis.totals.distinctCodes)} detail="Unidade filtrada ou conjunto consolidado" icon={ClipboardList} onClick={() => { setStatusFilter('Todos'); setQuery(''); }} />
          <Metric label="Elegíveis à sugestão" value={number(analysis.totals.suggested)} detail="Prévia analítica, sem gerar compra" icon={Check} color="text-emerald-500" onClick={() => setStatusFilter('Sugestão')} />
          <Metric label="Em revisão" value={number(analysis.totals.review)} detail="Alertas ou dados para conferir" icon={AlertTriangle} color="text-amber-500" onClick={() => setStatusFilter('Revisão')} />
          <Metric label="Aprovados / ajustados" value={number(analysis.totals.approved)} detail="Decisões humanas registradas" icon={ShieldCheck} color="text-violet-500" />
          <Metric label="Valor histórico" value={money(analysis.totals.historicalValue)} detail="Valores importados da origem" icon={Activity} />
          <Metric label="Quantidade sugerida" value={number(analysis.totals.suggestedQuantity)} detail="Unidades físicas; não é compra líquida" icon={TrendingUp} color="text-sky-500" onClick={() => setStatusFilter('Sugestão')} />
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <Card className="p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Curva ABC e giro</h2><p className="text-xs text-muted-foreground">Contagem de códigos distintos no recorte atual</p></div><SelectInput aria-label="Filtrar unidade" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} className="w-auto min-w-40"><option>Todas</option>{byUnit.map((entry) => <option key={entry.unit}>{entry.unit}</option>)}</SelectInput></div><div className="grid gap-4 sm:grid-cols-[1fr_1fr]"><div className="h-52 min-w-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={76} paddingAngle={3}>{pieData.map((row, index) => <Cell key={row.name} fill={MONTH_COLORS[index]} />)}</Pie><Tooltip formatter={(value) => number(value)} /><Legend /></PieChart></ResponsiveContainer></div><div className="grid grid-cols-2 gap-2 content-center">{byUnit.filter((entry) => unitFilter === 'Todas' || entry.unit === unitFilter).map((entry) => <div key={entry.unit} className="rounded-xl border border-border bg-background p-3"><p className="text-xs font-semibold">{entry.unit}</p><p className="mt-1 text-xs text-muted-foreground">{number(entry.itemCount)} códigos · ABC {entry.abcs.A}/{entry.abcs.B}/{entry.abcs.C}</p><p className="mt-1 text-xs text-muted-foreground">Giro alto/médio/baixo: {entry.turns.alto}/{entry.turns.medio}/{entry.turns.baixo}</p><p className="mt-1 text-xs text-muted-foreground">Sugestões: {number(entry.suggested)} · Revisão: {number(entry.review)}</p></div>)}</div></div></Card>
          <Card className="p-4"><div className="mb-2"><h2 className="font-semibold">Consumo e previsão</h2><p className="text-xs text-muted-foreground">Códigos distintos e quantidade física aparecem em séries separadas.</p></div><div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={analysis.monthlyHistory.slice(-24)} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis yAxisId="codes" tick={{ fontSize: 10 }} /><YAxis yAxisId="quantity" orientation="right" tick={{ fontSize: 10 }} /><Tooltip /><Legend /><Line yAxisId="codes" type="monotone" dataKey="codes" name="Códigos distintos" stroke="#38bdf8" dot={false} strokeWidth={2} /><Line yAxisId="quantity" type="monotone" dataKey="quantity" name="Consumo físico" stroke="#818cf8" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div></Card>
        </div>
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <Card className="p-4"><div className="mb-2"><h2 className="font-semibold">Giro, riscos e decisões</h2><p className="text-xs text-muted-foreground">Giro importado da fonte; alertas permanecem rastreáveis por código.</p></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Alto giro</p><p className="text-xl font-semibold">{number(analysis.totals.turns.alto)}</p></div><div className="rounded-xl border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Médio giro</p><p className="text-xl font-semibold">{number(analysis.totals.turns.medio)}</p></div><div className="rounded-xl border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Baixo giro</p><p className="text-xl font-semibold">{number(analysis.totals.turns.baixo)}</p></div><div className="rounded-xl border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Não classificado</p><p className="text-xl font-semibold">{number(analysis.totals.turns.nao_informado)}</p></div></div></Card>
          <Card className="p-4"><div className="mb-2"><h2 className="font-semibold">Previsão mensal</h2><p className="text-xs text-muted-foreground">Quantidade física prevista e referências distintas na versão ativa.</p></div><div className="h-56 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={forecastChart} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend />{selectedUnitSummary ? <Bar dataKey={selectedUnitSummary.unit} name="Códigos distintos" fill="#38bdf8" radius={[5,5,0,0]} /> : <><Bar dataKey="códigos" name="Códigos distintos" fill="#38bdf8" radius={[5,5,0,0]} /><Bar dataKey="unidades" name="Quantidade física" fill="#818cf8" radius={[5,5,0,0]} /></>}</BarChart></ResponsiveContainer></div></Card>
        </div>

        <Card className="mb-4 overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4"><div><h2 className="font-semibold">Detalhamento por código</h2><p className="mt-1 text-xs text-muted-foreground">Estoque e pedidos abertos só são considerados quando vierem identificados na origem; importação não cria movimentações.</p></div><div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:grid-cols-4"><label className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código ou descrição" className="pl-8" /></label><SelectInput value={abcFilter} onChange={(event) => setAbcFilter(event.target.value)}><option>Todos</option><option>A</option><option>B</option><option>C</option></SelectInput><SelectInput value={turnFilter} onChange={(event) => setTurnFilter(event.target.value)}><option>Todos</option><option value="alto">Giro alto</option><option value="medio">Giro médio</option><option value="baixo">Giro baixo</option></SelectInput><SelectInput value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Todos</option><option>Sugestão</option><option>Revisão</option><option>Sem sugestão</option></SelectInput></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{['Código','Descrição','Unidade','ABC / Giro','Histórico','Tendência Jan–Set','Sugestão física','Compra líquida','Estoque / pedidos','Situação',''].map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 font-semibold">{header}</th>)}</tr></thead><tbody className="divide-y divide-border">{analysis.filtered.slice(0, 300).map((item) => { const decision = analysis.decisionByItem.get(item.id); return <tr key={item.id} className="hover:bg-muted/30"><td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold">{item.code}</td><td className="max-w-64 truncate px-3 py-3">{item.description || '—'}</td><td className="px-3 py-3">{item.unit_name}</td><td className="whitespace-nowrap px-3 py-3">{item.abc_class || '—'} · {item.turn_class || '—'}</td><td className="whitespace-nowrap px-3 py-3">{item.historical_value == null ? '—' : money(item.historical_value)}</td><td className="whitespace-nowrap px-3 py-3">{item.trend_percent == null ? '—' : `${number(item.trend_percent)}%`}</td><td className="whitespace-nowrap px-3 py-3">{item.suggested_quantity == null ? '—' : number(item.suggested_quantity)}</td><td className="whitespace-nowrap px-3 py-3">{item.net_suggested_quantity == null ? '—' : number(item.net_suggested_quantity)}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">{item.stock_available == null ? 'Estoque —' : `Estoque ${number(item.stock_available)}`}<br />{item.open_orders == null ? 'Pedidos —' : `Pedidos ${number(item.open_orders)}`}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${decision ? 'bg-violet-500/10 text-violet-600' : item.eligible_for_suggestion ? 'bg-emerald-500/10 text-emerald-600' : item.review_reasons?.length ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground'}`}>{decision ? STATUS_LABEL[decision.status] : item.eligible_for_suggestion ? 'Recomendado' : item.review_reasons?.length ? 'Revisão' : 'Sem sugestão'}</span></td><td className="whitespace-nowrap px-3 py-3"><button className="text-xs font-semibold text-primary hover:underline" onClick={() => setDetailItem(item)}>Detalhes</button>{canManage && <button className="ml-3 text-xs font-semibold text-primary hover:underline" onClick={() => { setDecisionItem(item); setDecisionStatus(decision?.status || (item.eligible_for_suggestion ? 'recommended' : 'review')); setDecisionReason(''); setAdjustedQuantity(item.suggested_quantity ?? ''); }}>Decidir</button>}</td></tr>; })}</tbody></table></div>{analysis.filtered.length > 300 && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Exibindo os primeiros 300 de {number(analysis.filtered.length)} códigos. Refine os filtros para localizar outros itens.</p>}{analysis.filtered.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Nenhum código corresponde aos filtros.</p>}</Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]"><Card className="p-4"><h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary" />Versões e origem</h2><div className="mt-3 space-y-2">{imports.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"><div><p className="text-sm font-semibold">Versão {entry.version} · {entry.source_filename}</p><p className="mt-1 text-xs text-muted-foreground">{entry.status === 'complete' ? 'Confirmada' : entry.status === 'failed' ? 'Falhou · fora da análise' : 'Importação incompleta'} · {number(entry.row_count)} registros · {new Date(entry.created_at).toLocaleString('pt-BR')}</p></div>{entry.status === 'complete' && <ActionButton secondary onClick={() => loadStudyData(study, entry.id)}>{activeImport.id === entry.id ? 'Versão ativa' : 'Abrir versão'}</ActionButton>}</div>)}</div></Card><Card className="p-4"><h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="h-4 w-4 text-primary" />Auditoria recente</h2><div className="mt-3 max-h-72 space-y-2 overflow-auto">{audit.map((event) => <div key={event.id} className="rounded-xl border border-border bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold">{event.event_type}</span><time className="text-[11px] text-muted-foreground">{new Date(event.created_at).toLocaleString('pt-BR')}</time></div>{event.metadata?.source_filename && <p className="mt-1 text-xs text-muted-foreground">{event.metadata.source_filename} · {event.metadata.rows ?? 0} registros</p>}{event.metadata?.reason && <p className="mt-1 text-xs text-muted-foreground">{event.metadata.reason}</p>}</div>)}{audit.length === 0 && <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>}</div></Card></div>
      </>}
    </>}

    {showStudyForm && <Modal title="Novo estudo de BI" onClose={() => setShowStudyForm(false)}><form onSubmit={createStudy} className="space-y-4"><Field label="Nome do estudo *"><TextInput required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Planejamento de compras 2027" /></Field><Field label="Cliente"><TextInput maxLength={160} value={form.client_name} onChange={(event) => setForm({ ...form, client_name: event.target.value })} placeholder="Nome do cliente exibido nos links selecionados" /></Field><Field label="Descrição"><textarea maxLength={2000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" placeholder="Objetivo, escopo e observações do estudo" /></Field><div className="flex justify-end gap-2"><ActionButton secondary onClick={() => setShowStudyForm(false)}>Cancelar</ActionButton><ActionButton type="submit" disabled={busy || !form.name.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Criar estudo</ActionButton></div></form></Modal>}

    {importPreviewOpen && <Modal title="Prévia de importação — sem gravação" onClose={() => { if (!busy) setImportPreviewOpen(false); }}><div className="space-y-4"><p className="text-sm text-muted-foreground">O arquivo bruto permanece no navegador. A importação salva somente dados normalizados, nome/hash da origem e a versão; não altera produtos, compras, estoque ou financeiro.</p>{file && <div className="rounded-xl border border-border bg-background p-3 text-xs"><p className="font-semibold">{file.name}</p><p className="mt-1 text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB · SHA-256 será registrado como identificador da origem</p></div>}{busy && !parsed && <p className="flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" />Lendo arquivo…</p>}
      {parsed?.model === 'generic' && <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3"><p className="text-xs font-semibold">Selecione a aba e confira o mapeamento automático das colunas.</p><Field label="Aba"><SelectInput value={sheetName} onChange={(event) => { const sheet = parsed.sheets.find((entry) => entry.name === event.target.value); setSheetName(event.target.value); setMapping(AutoMapping(sheet)); }} >{parsed.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</SelectInput></Field>{(() => { const sheet = parsed.sheets.find((entry) => entry.name === sheetName); const fields = [['code','Código *'],['description','Descrição *'],['unit','Unidade'],['period','Mês (formato longo)'],['quantity','Quantidade (formato longo)'],['abc','Curva ABC'],['turn','Giro'],['historicalValue','Valor histórico'],['stock','Estoque disponível'],['openOrders','Pedidos abertos'],['substitution','Substituições']]; return <div className="grid gap-2 sm:grid-cols-2">{fields.map(([key,label]) => <Field key={key} label={label}><SelectInput value={mapping[key] ?? -1} onChange={(event) => setMapping({ ...mapping, [key]: Number(event.target.value) })}><option value={-1}>Não mapeada</option>{sheet?.headers.map((header,index) => <option key={`${header}-${index}`} value={index}>{header || `Coluna ${index + 1}`}</option>)}</SelectInput></Field>)}</div>; })()}<Field label="Unidade padrão, se a coluna Unidade não estiver mapeada"><TextInput value={unitFallback} onChange={(event) => setUnitFallback(event.target.value)} placeholder="Ex.: Filial Centro" /></Field>{genericPreview?.error && <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{genericPreview.error}</div>}</div>}
      {previewDataset && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Linhas</p><p className="text-lg font-semibold">{number(previewDataset.items.length)}</p></div><div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Unidades</p><p className="truncate text-sm font-semibold">{[...new Set(previewDataset.items.map((item) => item.unit_name))].join(', ')}</p></div><div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Sugestões</p><p className="text-lg font-semibold">{number(previewDataset.items.filter((item) => item.eligible_for_suggestion).length)}</p></div><div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground">Em revisão</p><p className="text-lg font-semibold">{number(previewDataset.items.filter((item) => item.review_reasons?.length).length)}</p></div></div><div className="max-h-48 overflow-auto rounded-lg border border-border"><table className="w-full min-w-[500px] text-xs"><thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="p-2 text-left">Unidade</th><th className="p-2 text-left">Código</th><th className="p-2 text-left">Descrição</th><th className="p-2 text-left">ABC</th><th className="p-2 text-right">Qtd. sugerida</th></tr></thead><tbody>{previewDataset.items.slice(0,50).map((item,index) => <tr key={`${item.unit_name}-${item.code}-${index}`} className="border-t border-border"><td className="p-2">{item.unit_name}</td><td className="p-2 font-mono">{item.code}</td><td className="max-w-48 truncate p-2">{item.description || '—'}</td><td className="p-2">{item.abc_class || '—'}</td><td className="p-2 text-right">{item.suggested_quantity == null ? '—' : number(item.suggested_quantity)}</td></tr>)}</tbody></table></div>{previewDataset.items.length > 50 && <p className="text-xs text-muted-foreground">A prévia detalhada mostra 50 itens. A validação considera todos os {number(previewDataset.items.length)} códigos.</p>}</>}
      {previewErrors.length > 0 && <div className="max-h-32 overflow-auto rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><p className="mb-1 font-semibold">Corrija os problemas antes de importar ({previewErrors.length}+)</p>{previewErrors.slice(0,12).map((message,index) => <p key={index}>{message}</p>)}</div>}
      {parsed && <div className="grid gap-3 sm:grid-cols-2"><Field label="Data de corte dos dados"><TextInput type="date" value={dataCutoff} onChange={(event) => setDataCutoff(event.target.value)} /></Field><Field label="Origem / observação"><TextInput maxLength={200} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} placeholder="Sistema de origem, data ou referência" /></Field></div>}
      {parsed?.model === 'adecoagro_buying_plan' && <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs leading-5 text-foreground">Modelo reconhecido: unidades Angélica e Ivinhema permanecem separadas. A sugestão de quantidade é uma previsão física da fonte; não representa compra líquida e não altera estoque.</div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><ActionButton secondary onClick={() => setImportPreviewOpen(false)}>Fechar</ActionButton><ActionButton disabled={busy || !previewDataset || previewErrors.length > 0} onClick={saveImport}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Confirmar nova versão</ActionButton></div>
    </div></Modal>}

    {detailItem && <Modal title={`Código ${detailItem.code}`} onClose={() => setDetailItem(null)}><div className="space-y-4"><div><p className="font-medium">{detailItem.description || 'Descrição não informada'}</p><p className="mt-1 text-xs text-muted-foreground">Unidade {detailItem.unit_name} · ABC {detailItem.abc_class || 'não informado'} · Giro {detailItem.turn_class || 'não informado'}</p></div><div className="grid grid-cols-2 gap-2"><div className="rounded-lg border border-border bg-background p-3 text-xs"><p className="text-muted-foreground">Valor histórico</p><strong className="mt-1 block text-sm">{detailItem.historical_value == null ? 'Não informado' : money(detailItem.historical_value)}</strong></div><div className="rounded-lg border border-border bg-background p-3 text-xs"><p className="text-muted-foreground">Previsão física</p><strong className="mt-1 block text-sm">{detailItem.suggested_quantity == null ? 'Não informada' : number(detailItem.suggested_quantity)}</strong></div><div className="rounded-lg border border-border bg-background p-3 text-xs"><p className="text-muted-foreground">Compra líquida calculada</p><strong className="mt-1 block text-sm">{detailItem.net_suggested_quantity == null ? 'Sem base de estoque/pedidos' : number(detailItem.net_suggested_quantity)}</strong></div><div className="rounded-lg border border-border bg-background p-3 text-xs"><p className="text-muted-foreground">Tendência Jan–Set 2025/2026</p><strong className="mt-1 block text-sm">{detailItem.trend_percent == null ? 'Sem base comparável' : `${number(detailItem.trend_percent)}%`}</strong><p className="mt-1 text-muted-foreground">Jul–Set: {detailItem.trend_3m_percent == null ? 'Sem base' : `${number(detailItem.trend_3m_percent)}%`}</p></div><div className="rounded-lg border border-border bg-background p-3 text-xs"><p className="text-muted-foreground">Estoque</p><strong className="mt-1 block text-sm">{detailItem.stock_available == null ? 'Não informado' : number(detailItem.stock_available)}</strong></div><div className="rounded-lg border border-border bg-background p-3 text-xs"><p className="text-muted-foreground">Pedidos abertos</p><strong className="mt-1 block text-sm">{detailItem.open_orders == null ? 'Não informado' : number(detailItem.open_orders)}</strong></div></div><div><h3 className="mb-2 text-sm font-semibold">Consumo e previsão mensal</h3><div className="max-h-44 overflow-auto rounded-lg border border-border"><table className="w-full text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Competência</th><th className="p-2 text-right">Consumo</th><th className="p-2 text-right">Previsão</th></tr></thead><tbody>{[...new Set([...Object.keys(detailItem.historical_months || {}), ...Object.keys(detailItem.forecast_months || {})])].sort().map((month) => <tr key={month} className="border-t border-border"><td className="p-2">{month}</td><td className="p-2 text-right">{detailItem.historical_months?.[month] == null ? '—' : number(detailItem.historical_months[month])}</td><td className="p-2 text-right">{detailItem.forecast_months?.[month] == null ? '—' : number(detailItem.forecast_months[month])}</td></tr>)}</tbody></table></div></div><div><h3 className="mb-2 text-sm font-semibold">Motivos e fonte</h3><ul className="space-y-1 text-xs text-muted-foreground">{(detailItem.review_reasons || []).map((reason,index) => <li key={index}>• {reason}</li>)}{detailItem.source_reference?.worksheet && <li>Fonte: aba {detailItem.source_reference.worksheet}, linha {detailItem.source_reference.row || '—'}.</li>}{Object.keys(detailItem.seasonality || {}).length > 0 && <li>Sazonalidade média mensal (competência: unidades): {Object.entries(detailItem.seasonality).map(([month,value]) => `${month}: ${number(value)}`).join(' · ')}</li>}{detailItem.substitutions?.length > 0 && <li>Substituições: {detailItem.substitutions.join(', ')}</li>}</ul></div><div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">O cálculo de compra líquida exige dados confirmados de estoque disponível, pedidos abertos, prazo de entrega e critérios do cliente. A importação não cria ordens nem atualiza o estoque.</div></div></Modal>}

    {decisionItem && <Modal title={`Registrar decisão · ${decisionItem.code}`} onClose={() => setDecisionItem(null)}><form onSubmit={saveDecision} className="space-y-4"><p className="text-sm text-muted-foreground">A recomendação original ficará preservada. Cada decisão gera um novo registro de auditoria.</p><Field label="Situação"><SelectInput value={decisionStatus} onChange={(event) => setDecisionStatus(event.target.value)}>{Object.entries(STATUS_LABEL).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</SelectInput></Field>{decisionStatus === 'adjusted' && <Field label="Quantidade ajustada"><TextInput type="number" min="0" step="any" required value={adjustedQuantity} onChange={(event) => setAdjustedQuantity(event.target.value)} /></Field>}<Field label="Justificativa *"><textarea required minLength={3} maxLength={2000} rows={4} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" placeholder="Explique a decisão e a evidência considerada." /></Field><div className="flex justify-end gap-2"><ActionButton secondary onClick={() => setDecisionItem(null)}>Cancelar</ActionButton><ActionButton type="submit" disabled={busy || decisionReason.trim().length < 3}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Salvar decisão auditada</ActionButton></div></form></Modal>}

    {shareOpen && <Modal title="Compartilhar uma versão do estudo" onClose={() => { setShareOpen(false); setCreatedShare(null); }}><div className="space-y-4">{createdShare ? <><div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">Link criado para a versão {activeImport?.version}. A URL contém um token exclusivo e expira em {new Date(createdShare.share.expires_at).toLocaleDateString('pt-BR')}.</div><div className="break-all rounded-lg border border-border bg-background p-3 font-mono text-xs">{createdShare.url}</div><div className="flex flex-wrap gap-2"><ActionButton onClick={() => navigator.clipboard.writeText(createdShare.url).then(() => setNotice('Link copiado.'))}><Link2 className="h-4 w-4" />Copiar link</ActionButton><ActionButton secondary onClick={() => setCreatedShare(null)}>Gerar outro link</ActionButton></div></> : <form onSubmit={makeShare} className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">O cliente verá apenas o retrato imutável da versão ativa e as seções selecionadas. Nenhuma sessão F7, arquivo bruto ou outra análise será exposta.</p><fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold">Seções públicas</legend>{Object.entries(SECTION_LABELS).map(([key,label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shareSections.includes(key)} onChange={(event) => setShareSections((current) => event.target.checked ? [...current,key] : current.filter((value) => value !== key))} />{label}</label>)}</fieldset><Field label="Validade"><SelectInput value={shareDays} onChange={(event) => setShareDays(event.target.value)}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></SelectInput></Field><Field label="Senha adicional (opcional, mínimo 12 caracteres)"><TextInput type="password" minLength={12} maxLength={200} autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} placeholder="Deixe vazio para usar apenas o link" /></Field><div className="flex justify-end gap-2"><ActionButton secondary onClick={() => setShareOpen(false)}>Cancelar</ActionButton><ActionButton type="submit" disabled={busy || !shareSections.length || Boolean(sharePassword && sharePassword.length < 12)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Criar link seguro</ActionButton></div></form>}</div>{shares.length > 0 && <div className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-semibold">Links do estudo</h3><div className="mt-2 space-y-2">{shares.map((share) => <div key={share.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-3 text-xs"><div><p className="font-medium">{share.revoked_at ? 'Revogado' : new Date(share.expires_at) <= new Date() ? 'Expirado' : 'Ativo'} · {share.password_protected ? 'Com senha' : 'Link privado'}</p><p className="mt-1 text-muted-foreground">Expira em {new Date(share.expires_at).toLocaleString('pt-BR')}</p></div>{!share.revoked_at && new Date(share.expires_at) > new Date() && <ActionButton secondary onClick={() => revokeShare(share.id)}>Revogar</ActionButton>}</div>)}</div></div>}</Modal>}
  </div>;
}
