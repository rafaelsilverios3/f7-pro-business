import { useCallback, useEffect, useState } from 'react';
import { platformAdminService } from '@/services/platformAdminService';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 disabled:bg-slate-100';
const buttonClass = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const money = (value, currency) => value == null ? '—' : `${Number(value).toFixed(6)} ${currency || ''}`.trim();
const dt = (value) => value ? new Date(value).toLocaleString('pt-BR') : '—';
const aiCurrencies = ['BRL', 'USD', 'EUR'];

function Notice({ children, tone = 'amber' }) {
  return <p className={`rounded-lg border p-3 text-xs ${tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-800' : tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{children}</p>;
}

function Field({ label, ...props }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<input className={fieldClass} {...props} /></label>;
}

function SelectField({ label, children, ...props }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<select className={fieldClass} {...props}>{children}</select></label>;
}

export function GlobalAiFinancialAdmin({ companies = [], canRead, canManage }) {
  const [cards, setCards] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [companyQuery, setCompanyQuery] = useState('');
  const [searchedCompanies, setSearchedCompanies] = useState(null);
  const [companyLookupBusy, setCompanyLookupBusy] = useState(false);
  const [companyLookupError, setCompanyLookupError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ rate_kind: 'model_tokens', provider_key: '', model_key: '', rate_version: '', currency: '', input_cost_per_1k: '', output_cost_per_1k: '', cost_per_query: '', source_reference: '', effective_from: new Date(Date.now() + 60_000).toISOString().slice(0, 16), enabled: false, reason: '' });
  const isModel = form.rate_kind === 'model_tokens';
  const load = useCallback(async () => {
    if (!canRead) return;
    setError('');
    try { const result = await platformAdminService.aiRateCards(); setCards(result.rows || []); }
    catch (cause) { setError(cause.message || 'Não foi possível carregar as tarifas administrativas.'); }
  }, [canRead]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const query = companyQuery.trim();
    if (!query) {
      setSearchedCompanies(null);
      setCompanyLookupError('');
      setCompanyLookupBusy(false);
      return undefined;
    }
    setSearchedCompanies([]);
    setCompanyLookupBusy(true);
    let active = true;
    const timer = window.setTimeout(() => {
      setCompanyLookupBusy(true);
      setCompanyLookupError('');
      platformAdminService.companies({ search: query, page: 1, page_size: 100 })
        .then((result) => { if (active) setSearchedCompanies(result.rows || []); })
        .catch((cause) => { if (active) setCompanyLookupError(cause.message || 'Não foi possível localizar a empresa.'); })
        .finally(() => { if (active) setCompanyLookupBusy(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyQuery]);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await platformAdminService.createAiRateCard({
        ...form,
        model_key: isModel ? form.model_key : null,
        input_cost_per_1k: isModel ? Number(form.input_cost_per_1k) : null,
        output_cost_per_1k: isModel ? Number(form.output_cost_per_1k) : null,
        cost_per_query: isModel ? null : Number(form.cost_per_query),
        effective_from: new Date(form.effective_from).toISOString(),
        effective_until: null,
      });
      setMessage('Tarifa registrada. Os valores são imutáveis; para reajustar, crie nova versão com vigência não sobreposta.');
      setForm((current) => ({ ...current, rate_version: '', model_key: '', input_cost_per_1k: '', output_cost_per_1k: '', cost_per_query: '', source_reference: '', reason: '', enabled: false }));
      await load();
    } catch (cause) { setError(cause.message || 'Não foi possível registrar a tarifa.'); }
    finally { setBusy(false); }
  };
  const toggle = async (card) => {
    const enabled = !card.enabled;
    const reason = window.prompt(`Motivo para ${enabled ? 'habilitar' : 'desabilitar'} a tarifa (não inclua segredos):`);
    if (!reason?.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try { await platformAdminService.setAiRateCardEnabled(card.id, enabled, reason.trim()); setMessage(`Tarifa ${enabled ? 'habilitada' : 'desabilitada'} com auditoria.`); await load(); }
    catch (cause) { setError(cause.message || 'Não foi possível alterar a vigência da tarifa.'); }
    finally { setBusy(false); }
  };
  const companyRows = searchedCompanies ?? companies;
  if (!canRead) return <Notice>Leitura financeira de IA não está disponível para este papel.</Notice>;
  return <div className="space-y-5">
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div><h3 className="font-semibold text-slate-900">Tarifas de IA</h3><p className="mt-1 text-xs text-slate-500">O catálogo é privado. Cadastre a origem HTTPS exata do provedor usada pelo runtime e o nome exato do modelo configurado fora deste painel. Cada tarifa exige fonte pública, versão, moeda e aprovação; reajustes criam nova versão.</p></div>
      {error && <Notice tone="red">{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}
      {!canManage && <Notice>Modo somente leitura. Apenas o owner global pode cadastrar ou habilitar tarifas.</Notice>}
      {canManage && <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
        <SelectField label="Tipo de tarifa" value={form.rate_kind} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, rate_kind: event.target.value })}><option value="model_tokens">Tokens de modelo</option><option value="external_query">Consulta externa</option></SelectField>
        <Field label="Origem do provedor (sem caminho ou segredo)" value={form.provider_key} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, provider_key: event.target.value })} placeholder="https://api.provedor.com" />
        {isModel && <Field label="Modelo exato" value={form.model_key} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, model_key: event.target.value })} placeholder="Identificador do modelo" />}
        <Field label="Versão da tarifa" value={form.rate_version} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, rate_version: event.target.value })} placeholder="Ex.: 2026-10-16-v1" />
        <SelectField label="Moeda suportada" value={form.currency} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option value="">Selecione</option>{aiCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</SelectField>
        {isModel ? <><Field label="Entrada por 1.000 tokens" type="number" min="0" step="0.0000000001" value={form.input_cost_per_1k} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, input_cost_per_1k: event.target.value })} /><Field label="Saída por 1.000 tokens" type="number" min="0" step="0.0000000001" value={form.output_cost_per_1k} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, output_cost_per_1k: event.target.value })} /></> : <Field label="Custo por consulta" type="number" min="0.0000000001" step="0.0000000001" value={form.cost_per_query} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, cost_per_query: event.target.value })} />}
        <Field label="Fonte pública da tarifa (HTTPS)" type="url" value={form.source_reference} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, source_reference: event.target.value })} placeholder="https://..." />
        <Field label="Início da vigência" type="datetime-local" value={form.effective_from} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} />
        <Field label="Justificativa de auditoria" value={form.reason} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Não inclua dados sensíveis" maxLength={500} />
        <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 p-3 text-xs text-slate-700"><input type="checkbox" checked={form.enabled} disabled={!canManage || busy} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Habilitar para reservas quando entrar em vigor</label>
        <button className={`${buttonClass} self-end`} disabled={!canManage || busy}>{busy ? 'Salvando…' : 'Registrar tarifa imutável'}</button>
      </form>}
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Provedor / modelo', 'Versão', 'Moeda', 'Entrada / saída por 1k', 'Estado / vigência', 'Fonte', ''].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{cards.map((card) => <tr key={card.id} className="border-t border-slate-100"><td className="px-3 py-2">{card.provider_key}<br />{card.model_key || 'Consulta externa'}</td><td className="px-3 py-2">{card.rate_version}</td><td className="px-3 py-2">{card.currency}</td><td className="px-3 py-2">{card.rate_kind === 'model_tokens' ? `${money(card.input_cost_per_1k, card.currency)} / ${money(card.output_cost_per_1k, card.currency)}` : money(card.cost_per_query, card.currency)}</td><td className="px-3 py-2">{card.enabled ? 'Ativa' : 'Desativada'}<br />{dt(card.effective_from)}</td><td className="max-w-48 truncate px-3 py-2"><a href={card.source_reference} target="_blank" rel="noreferrer" className="text-blue-600">Fonte</a></td><td className="px-3 py-2"><button type="button" disabled={!canManage || busy} onClick={() => toggle(card)} className="font-semibold text-blue-700 disabled:opacity-50">{card.enabled ? 'Desabilitar' : 'Habilitar'}</button></td></tr>)}</tbody></table>{!cards.length && <p className="p-6 text-center text-sm text-slate-500">Nenhuma tarifa configurada.</p>}</div>
    </section>
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Controles por empresa</h3><p className="text-xs text-slate-500">Orçamentos e consumo são carregados com autorização server-side. Nenhum valor é ativado automaticamente por plano.</p><label className="block max-w-lg text-xs font-medium text-slate-600">Buscar empresa por nome ou identificador<input aria-label="Buscar empresa por nome ou identificador" value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} className={fieldClass} placeholder="Digite para pesquisar empresas" /></label>{companyLookupBusy && <p role="status" className="text-xs text-slate-500">Buscando empresas…</p>}{companyLookupError && <Notice tone="red">{companyLookupError}</Notice>}{!companyQuery.trim() && <p className="text-xs text-slate-500">A lista inicial contém as empresas recentes. Use a busca para localizar outras empresas.</p>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-slate-500"><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Ação</th></tr></thead><tbody>{companyRows.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-3 py-2">{row.name || row.company_name || row.id}</td><td className="px-3 py-2"><button type="button" onClick={() => setSelectedCompanyId(row.id)} className="font-semibold text-blue-700">Consultar orçamento e consumo</button></td></tr>)}</tbody></table>{!companyRows.length && <p className="p-5 text-center text-sm text-slate-500">Sem empresas retornadas.</p>}</div>{selectedCompanyId && <CompanyAiFinancialControls companyId={selectedCompanyId} canRead={canRead} canManage={canManage} />}</section>
  </div>;
}

export function CompanyAiFinancialControls({ companyId, canRead, canManage, onSaved }) {
  const [usage, setUsage] = useState(null);
  const [usageCompanyId, setUsageCompanyId] = useState(null);
  const [formDirty, setFormDirty] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [calls, setCalls] = useState('');
  const [webQueries, setWebQueries] = useState('');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState('');
  const [tokens, setTokens] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setUsage(null); setUsageCompanyId(null); setFormDirty(false); setError(''); setMessage(''); }, [companyId]);
  const loadUsage = useCallback(async () => { if (!canRead) return; try { const result = await platformAdminService.aiFinancialUsage(companyId); setUsage(result.usage); setUsageCompanyId(companyId); } catch (cause) { setError(cause.message || 'Não foi possível carregar consumo e reservas.'); } }, [canRead, companyId]);
  useEffect(() => { loadUsage(); }, [loadUsage]);
  useEffect(() => {
    if (!usage || usageCompanyId !== companyId || formDirty) return;
    const budgetSettings = usage.budget;
    const active = Number(budgetSettings?.max_daily_ai_calls) > 0 && Number(budgetSettings?.max_daily_ai_cost) > 0 && /^[A-Z]{3}$/.test(budgetSettings?.ai_budget_currency || '');
    setEnabled(active); setCalls(String(budgetSettings?.max_daily_ai_calls ?? 0)); setWebQueries(String(budgetSettings?.max_daily_web_queries ?? 0)); setBudget(String(budgetSettings?.max_daily_ai_cost ?? 0)); setCurrency(budgetSettings?.ai_budget_currency || ''); setTokens(String(budgetSettings?.max_tokens_per_request ?? 8000));
  }, [companyId, formDirty, usage, usageCompanyId]);
  const today = usage?.today || {};
  const reservations = usage?.reservations || [];
  if (!canRead) return <Notice>Consulta de orçamento e consumo não está disponível para este papel.</Notice>;
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await platformAdminService.updateAiFinancialBudget({ company_id: companyId, consumption_enabled: enabled, daily_calls: Number(calls), daily_web_queries: Number(webQueries), daily_budget: Number(budget), currency: currency.toUpperCase(), max_tokens_per_request: Number(tokens), reason });
      setMessage(enabled ? 'Limites financeiros salvos com auditoria.' : 'Consumo pausado. O orçamento existente foi preservado; use “Restaurar orçamento a zero” para removê-lo.'); setReason(''); setFormDirty(false); await onSaved?.(); await loadUsage();
    } catch (cause) { setError(cause.message || 'Não foi possível salvar os limites financeiros.'); }
    finally { setBusy(false); }
  };
  const clearBudget = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await platformAdminService.updateAiFinancialBudget({ company_id: companyId, consumption_enabled: false, clear_budget: true, daily_calls: 0, daily_web_queries: 0, daily_budget: 0, currency: '', max_tokens_per_request: Number(tokens) || 8000, reason });
      setEnabled(false); setBudget('0'); setCurrency(''); setCalls('0'); setWebQueries('0'); setReason(''); setFormDirty(false); setMessage('Orçamento diário restaurado para zero com auditoria.'); await onSaved?.(); await loadUsage();
    } catch (cause) { setError(cause.message || 'Não foi possível limpar o orçamento.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div><h3 className="font-semibold text-slate-900">Orçamento de geração da empresa</h3><p className="mt-1 text-xs text-slate-500">O estado abaixo controla apenas o limite da empresa. Não ativa AI_ENABLED, não altera manutenção e não configura segredos do provedor.</p></div>
      {error && <Notice tone="red">{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}
      {canManage && <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={enabled} disabled={!canManage || busy} onChange={(event) => { setEnabled(event.target.checked); setFormDirty(true); }} />Consumo por geração habilitado</label>
        <Field label="Máximo de chamadas por dia (1–1000)" type="number" min="1" max="1000" step="1" value={calls} disabled={!canManage || busy || !enabled} onChange={(event) => { setCalls(event.target.value); setFormDirty(true); }} />
        <Field label="Máximo de consultas externas/dia (0–1000)" type="number" min="0" max="1000" step="1" value={webQueries} disabled={!canManage || busy || !enabled} onChange={(event) => { setWebQueries(event.target.value); setFormDirty(true); }} />
        <Field label="Teto diário na moeda escolhida (máx. 1000)" type="number" min="0.0001" max="1000" step="0.0001" value={budget} disabled={!canManage || busy || !enabled} onChange={(event) => { setBudget(event.target.value); setFormDirty(true); }} />
        <SelectField label="Moeda do teto" value={currency} disabled={!canManage || busy} onChange={(event) => { setCurrency(event.target.value); setFormDirty(true); }}><option value="">Selecione</option>{aiCurrencies.map((supported) => <option key={supported} value={supported}>{supported}</option>)}</SelectField>
        <Field label="Tokens máximos de saída por solicitação (256–100000)" type="number" min="256" max="100000" step="1" value={tokens} disabled={!canManage || busy || !enabled} onChange={(event) => { setTokens(event.target.value); setFormDirty(true); }} />
        <Field label="Motivo de auditoria (não inclua dados sensíveis)" value={reason} maxLength={500} disabled={!canManage || busy} onChange={(event) => { setReason(event.target.value); setFormDirty(true); }} placeholder="Motivo obrigatório" />
        <div className="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-3"><button className={buttonClass} disabled={!canManage || busy || reason.trim().length < 8}>{busy ? 'Salvando…' : 'Salvar limites auditados'}</button><button type="button" onClick={clearBudget} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canManage || busy || reason.trim().length < 8}>Restaurar orçamento a zero</button></div>
      </form>}
      {!canManage && <Notice>Modo somente leitura. Alterações de orçamento e limites estão restritas ao owner global.</Notice>}
      {!canManage && <Notice>Somente o owner global pode alterar tarifas ou orçamentos.</Notice>}
      {enabled && <Notice>Habilitar orçamento por empresa não ativa o provedor global. A geração continua bloqueada até AI_ENABLED, manutenção e configuração de modelo/tarifa válidos.</Notice>}
    </section>
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between"><div><h3 className="font-semibold">Consumo e reservas</h3><p className="text-xs text-slate-500">Somente métricas sanitizadas do ledger; prompts, dados pessoais e request keys não são exibidos.</p></div><button type="button" onClick={loadUsage} className="text-xs font-semibold text-blue-700">Atualizar</button></div>
      <div className="grid gap-3 sm:grid-cols-4"><Metric label="Chamadas hoje" value={today.calls ?? '—'} /><Metric label="Tokens reservados" value={today.tokens_reserved ?? '—'} /><Metric label="Custo reservado" value={today.cost_reserved == null ? '—' : `${Number(today.cost_reserved).toFixed(6)} ${today.currency || ''}`} /><Metric label="Reservas no histórico" value={reservations.length} /></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Criada', 'Provedor / modelo', 'Estado', 'Tokens reservados', 'Custo reservado', 'Custo liquidado', 'Código seguro'].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{reservations.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-3 py-2">{dt(row.created_at)}</td><td className="px-3 py-2">{row.provider_key}<br />{row.model_key || 'Consulta externa'} · {row.rate_version}</td><td className="px-3 py-2">{row.status}</td><td className="px-3 py-2">{Number(row.reserved_input_tokens || 0) + Number(row.reserved_output_tokens || 0)}</td><td className="px-3 py-2">{money(row.reserved_cost, row.currency)}</td><td className="px-3 py-2">{money(row.actual_cost, row.currency)}</td><td className="px-3 py-2">{row.safe_reason_code || '—'}</td></tr>)}</tbody></table>{!reservations.length && <p className="p-6 text-center text-sm text-slate-500">Nenhuma reserva retornada.</p>}</div>
    </section>
  </div>;
}

function Metric({ label, value }) { return <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>; }
