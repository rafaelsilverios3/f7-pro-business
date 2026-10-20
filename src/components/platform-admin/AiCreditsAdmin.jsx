import React, { useCallback, useEffect, useState } from 'react';
import { platformAdminService } from '@/services/platformAdminService';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const money = (minor) => `R$ ${(Number(minor || 0) / 100).toFixed(2)}`;

function Message({ children, error = false }) { return children ? <p role="status" className={`rounded-lg border p-3 text-xs ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{children}</p> : null; }
function NumberField({ label, value, onChange, ...props }) { return <label className="block text-xs font-medium text-slate-600">{label}<input className={inputClass} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>; }

export function GlobalAiCreditsAdmin({ canManage }) {
  const [catalog, setCatalog] = useState(null); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setError(''); try { setCatalog(await platformAdminService.aiCreditCatalog()); } catch (cause) { setError(cause.message || 'Catálogo de créditos indisponível.'); } }, []);
  useEffect(() => { load(); }, [load]);
  const mutate = async (action, ...args) => { const reason = window.prompt('Motivo obrigatório para auditoria (não inclua dados sensíveis):'); if (!reason?.trim()) return; setBusy(true); setError(''); setMessage(''); try { await action(...args, reason.trim()); setMessage('Configuração salva e auditada.'); await load(); } catch (cause) { setError(cause.message || 'Não foi possível salvar a configuração.'); } finally { setBusy(false); } };
  const updatePlan = async (row) => { const value = window.prompt(`Franquia mensal do plano ${row.plan_code.toUpperCase()}:`, String(row.monthly_credits)); if (value === null) return; await mutate(platformAdminService.updateAiCreditPlan, row.plan_code, Number(value)); };
  const updatePricing = async () => {
    const pricing = catalog?.pricing || {}; const fx = window.prompt('Câmbio USD → BRL. Deixe vazio para bloquear cotações em USD até configurar o câmbio:', pricing.usd_to_brl ?? ''); if (fx === null) return;
    const markup = window.prompt('Margem em pontos-base (10000 = custo de referência sem margem):', String(pricing.markup_bps ?? 10000)); if (markup === null) return;
    const threshold = window.prompt('Limite fixo de confirmação em créditos:', String(pricing.confirmation_threshold_credits ?? 20)); if (threshold === null) return;
    const percent = window.prompt('Limite de saldo em pontos-base (1000 = 10%):', String(pricing.confirmation_balance_bps ?? 1000)); if (percent === null) return;
    await mutate(platformAdminService.updateAiCreditPricing, { usd_to_brl: fx.trim() ? Number(fx) : null, markup_bps: Number(markup), confirmation_threshold_credits: Number(threshold), confirmation_balance_bps: Number(percent) });
  };
  const updatePackage = async (row) => {
    const credits = window.prompt(`Créditos do pacote ${row.package_code}:`, String(row.credits)); if (credits === null) return;
    const price = window.prompt('Preço em reais (ex.: 19,90):', (Number(row.price_minor) / 100).toFixed(2).replace('.', ',')); if (price === null) return;
    const active = window.confirm('Manter pacote disponível para compra?');
    const reason = window.prompt('Motivo obrigatório para auditoria:'); if (!reason?.trim()) return;
    setBusy(true); try { await platformAdminService.updateAiCreditPackage({ package_code: row.package_code, credits: Number(credits), price_minor: Math.round(Number(price.replace(',', '.')) * 100), active, reason: reason.trim() }); setMessage('Pacote salvo e auditado.'); await load(); } catch (cause) { setError(cause.message || 'Não foi possível salvar o pacote.'); } finally { setBusy(false); }
  };
  const updateRatePricing = async (row) => {
    const margin = window.prompt(`Margem para ${row.model_key || row.provider_key} em pontos-base (vazio = margem global):`, row.markup_bps ?? ''); if (margin === null) return;
    const fx = row.currency === 'BRL' ? '' : window.prompt(`Conversão ${row.currency} → BRL (vazio = usar câmbio global quando houver):`, row.fx_to_brl ?? ''); if (fx === null) return;
    const reason = window.prompt('Motivo obrigatório para auditoria:'); if (!reason?.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try { await platformAdminService.updateAiCreditRatePricing({ rate_card_id: row.rate_card_id, markup_bps: margin.trim() ? Number(margin) : null, fx_to_brl: fx.trim() ? Number(fx) : null, reason: reason.trim() }); setMessage('Margem/conversão da tarifa salva e auditada.'); await load(); }
    catch (cause) { setError(cause.message || 'Não foi possível salvar a margem da tarifa.'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
    <div><h3 className="font-semibold text-slate-900">F7 AI Credits · catálogo global</h3><p className="mt-1 text-xs text-slate-600">As franquias e pacotes são configuráveis aqui. O câmbio não vem fixo no código: sem taxa vigente, cotações para tarifas em USD falham fechadas.</p></div>
    {canManage && <OwnerAIUsageControls />}
    {canManage && <OwnerAICreditRecovery />}
    <Message error={Boolean(error)}>{error}</Message><Message>{message}</Message>
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold">Franquia mensal por plano</h4>{canManage && <button disabled={busy} onClick={updatePricing} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 disabled:opacity-50">Configurar câmbio, margem e confirmação</button>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(catalog?.plans || []).map((row) => <article key={row.plan_code} className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-semibold uppercase">{row.plan_code}</p><p className="mt-1 text-sm">{Number(row.monthly_credits).toLocaleString('pt-BR')} créditos/mês</p>{canManage && <button disabled={busy} onClick={() => updatePlan(row)} className="mt-3 text-xs font-semibold text-blue-700">Alterar franquia</button>}</article>)}</div>
    <div><h4 className="mb-2 text-sm font-semibold">Pacotes extras · pagamento único</h4><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-100 text-slate-600"><tr>{['Pacote','Créditos','Preço','Disponibilidade',''].map((item) => <th key={item} className="px-3 py-2">{item}</th>)}</tr></thead><tbody>{(catalog?.packages || []).map((row) => <tr key={row.package_code} className="border-t"><td className="px-3 py-2">{row.package_code}</td><td className="px-3 py-2">{Number(row.credits).toLocaleString('pt-BR')}</td><td className="px-3 py-2">{money(row.price_minor)}</td><td className="px-3 py-2">{row.active ? 'Ativo' : 'Desativado'}</td><td className="px-3 py-2">{canManage && <button disabled={busy} onClick={() => updatePackage(row)} className="font-semibold text-blue-700">Editar</button>}</td></tr>)}</tbody></table></div></div>
    <div><h4 className="mb-2 text-sm font-semibold">Margem e câmbio por tarifa</h4><p className="mb-2 text-[11px] text-slate-500">Vazio herda a margem global; câmbio EUR precisa ser definido por tarifa. Valores só valem para cotações criadas depois da vigência atual.</p><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-100 text-slate-600"><tr>{['Modelo/recurso','Versão','Moeda','Estado/vigência','Margem própria','Câmbio',''].map((item) => <th key={item} className="px-3 py-2">{item}</th>)}</tr></thead><tbody>{(catalog?.rates || []).map((row) => <tr key={row.rate_card_id} className="border-t"><td className="px-3 py-2">{row.model_key || row.provider_key}<br/><span className="text-slate-400">{row.rate_kind}</span></td><td className="px-3 py-2">{row.rate_version}</td><td className="px-3 py-2">{row.currency}</td><td className="px-3 py-2">{row.enabled ? 'Ativa' : 'Desativada'}<br/>{new Date(row.effective_from).toLocaleDateString('pt-BR')}</td><td className="px-3 py-2">{row.markup_bps ?? 'Global'}</td><td className="px-3 py-2">{row.fx_to_brl ?? (row.currency === 'BRL' ? '1' : 'Global/ausente')}</td><td className="px-3 py-2">{canManage && <button disabled={busy} onClick={() => updateRatePricing(row)} className="font-semibold text-blue-700">Configurar</button>}</td></tr>)}</tbody></table></div></div>
    <p className="text-[11px] text-slate-500">Receita confirmada por pacote: {(catalog?.revenue || []).map((item) => `${item.package_code}: ${item.sales} vendas · ${money(item.gross_minor)}`).join(' · ') || 'sem vendas registradas'}.</p>
  </section>;
}

function OwnerAIUsageControls() {
  const [data, setData] = useState(null); const [enabled, setEnabled] = useState(true);
  const [calls, setCalls] = useState('5'); const [budget, setBudget] = useState('5');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await platformAdminService.ownerAIUsagePolicy();
      const snapshot = result?.policy || {}; setData(snapshot); const policy = snapshot?.policy || {};
      setEnabled(policy.temporary_limits_enabled !== false);
      setCalls(String(policy.daily_call_limit ?? 5)); setBudget(String(policy.daily_budget_brl ?? 5));
      setError('');
    } catch (cause) { setError(cause.message || 'Limites pessoais do Owner indisponíveis.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (busy || reason.trim().length < 8) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await platformAdminService.updateOwnerAIUsagePolicy({ temporary_limits_enabled: enabled, daily_call_limit: Number(calls), daily_budget_brl: Number(budget), reason: reason.trim() });
      setMessage('Limites pessoais do Owner salvos com auditoria.'); setReason(''); await load();
    } catch (cause) { setError(cause.message || 'Não foi possível salvar os limites pessoais.'); }
    finally { setBusy(false); }
  };
  const usage = data?.usage || {}; const policy = data?.policy || {};
  return <section className="space-y-3 rounded-xl border border-violet-200 bg-white p-4">
    <div><h4 className="font-semibold text-violet-950">Isenção comercial do Owner Global</h4><p className="mt-1 text-xs text-slate-600">A autorização é confirmada no backend pelo papel Owner Global permanente. O Owner não usa franquia nem créditos extras da empresa; tokens e custo real ficam em ledger pessoal separado. Estes limites temporários não alteram os clientes.</p></div>
    {error && <Message error>{error}</Message>}{message && <Message>{message}</Message>}
    <div className="grid gap-2 sm:grid-cols-5"><Metric label="Chamadas hoje (UTC)" value={`${usage.calls ?? 0}${policy.temporary_limits_enabled ? ` / ${policy.daily_call_limit ?? 5}` : ''}`} /><Metric label="Custo real liquidado" value={`R$ ${Number(usage.actual_cost_brl ?? usage.cost_brl ?? 0).toFixed(4)}`} /><Metric label="Reservas ainda protegidas" value={`R$ ${Number(usage.reserved_brl || 0).toFixed(4)}`} /><Metric label="Tokens hoje" value={Number(usage.tokens || 0).toLocaleString('pt-BR')} /><Metric label="Pesquisa web" value="0 permitidas" /></div>
    <div className="grid gap-3 rounded-lg bg-violet-50/60 p-3 sm:grid-cols-3">
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700 sm:col-span-3"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Aplicar limites temporários pessoais de homologação</label>
      <NumberField label="Máximo de chamadas por dia" type="number" min="1" max="1000" value={calls} onChange={setCalls} />
      <NumberField label="Orçamento diário pessoal (R$)" type="number" min="0.01" max="100000" step="0.01" value={budget} onChange={setBudget} />
      <label className="block text-xs font-medium text-slate-600 sm:col-span-3">Motivo obrigatório para auditoria<textarea className={`${inputClass} min-h-16`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
      <p className="text-[11px] text-slate-500 sm:col-span-3">Pesquisa web fica em zero durante o piloto. O teto financeiro diário pessoal continua obrigatório como proteção global, mesmo quando os limites temporários de chamadas e pesquisa forem desativados. A isenção comercial permanece e nada altera os limites dos clientes.</p>
      <button disabled={busy || reason.trim().length < 8 || !Number.isInteger(Number(calls)) || Number(calls) < 1 || Number(calls) > 1000 || !Number.isFinite(Number(budget)) || Number(budget) < 0.01 || Number(budget) > 100000} onClick={save} className="w-fit rounded-lg bg-violet-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-3">{busy ? 'Salvando…' : 'Salvar limites pessoais'}</button>
    </div>
  </section>;
}

function OwnerAICreditRecovery() {
  const [rows, setRows] = useState([]); const [busyId, setBusyId] = useState('');
  const [resolutionById, setResolutionById] = useState({}); const [evidenceById, setEvidenceById] = useState({});
  const [reasonById, setReasonById] = useState({}); const [inputById, setInputById] = useState({}); const [outputById, setOutputById] = useState({});
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => { try { const result = await platformAdminService.aiCreditUncertainOperations(); setRows(result.rows || []); setError(''); } catch (cause) { setError(cause.message || 'Reservas pendentes indisponíveis.'); } }, []);
  useEffect(() => { load(); }, [load]);
  const resolve = async (row) => {
    const resolution = resolutionById[row.id] || 'provider_not_sent';
    const confirmed = resolution === 'provider_not_sent'
      ? window.confirm('Confirme somente se evidências verificáveis provam que o provedor NÃO recebeu a solicitação. Se o resultado for desconhecido, cancele e mantenha a reserva. Continuar?')
      : window.confirm('Confirme que os tokens informados vêm de registro confiável do provedor e correspondem a esta operação. Continuar?');
    if (!confirmed) return;
    setBusyId(row.id); setError(''); setMessage('');
    try {
      const result = await platformAdminService.reconcileAiCreditOperation({
        company_id: row.company_id, operation_id: row.id, resolution,
        actual_input: inputById[row.id] ?? '', actual_output: outputById[row.id] ?? '',
        evidence_ref: evidenceById[row.id] || '', reason: reasonById[row.id] || '',
      });
      if (result?.result?.ok !== true) throw new Error(result?.result?.code || 'AI_CREDIT_RECONCILIATION_FAILED');
      const status = result?.result?.status || (result?.result?.duplicate ? 'já reconciliada' : 'concluída');
      setMessage(`Reconciliação ${status}; ação auditada.`); await load();
    } catch (cause) { setError(cause.message || 'Reconciliação recusada; a reserva permanece protegida.'); }
    finally { setBusyId(''); }
  };
  return <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-amber-950">Reservas de IA sem liquidação</h4><p className="mt-1 text-xs text-slate-600">Apenas Owner Global. Resultado desconhecido permanece reservado. Libere somente com evidência de que o provedor não recebeu a solicitação; liquide somente com uso confiável confirmado.</p></div><button type="button" onClick={load} className="text-xs font-semibold text-blue-700">Atualizar</button></div>
    <Message error={Boolean(error)}>{error}</Message><Message>{message}</Message>
    {!rows.length ? <p className="text-xs text-slate-500">Nenhuma reserva pendente.</p> : rows.map((row) => {
      const resolution = resolutionById[row.id] || 'provider_not_sent';
      return <article key={row.id} className="space-y-3 rounded-lg border border-slate-200 p-3">
        <div className="grid gap-2 text-xs sm:grid-cols-4"><Metric label="Operação" value={row.id} /><Metric label="Empresa" value={row.company_id} /><Metric label="Modelo / estado" value={`${row.model_key} · ${row.status}`} /><Metric label="Reserva / máximo" value={`${Number(row.reserved_monthly) + Number(row.reserved_extra)} / ${row.max_credits} créditos`} /></div>
        {Number.isInteger(row.actual_input_tokens) && Number.isInteger(row.actual_output_tokens) && <p className="text-xs text-slate-600">Tokens registrados: entrada {row.actual_input_tokens}, saída {row.actual_output_tokens}.</p>}
        <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium text-slate-600">Resultado comprovado<select className={inputClass} value={resolution} onChange={(event) => setResolutionById((old) => ({ ...old, [row.id]: event.target.value }))}><option value="provider_not_sent">Provedor comprovadamente não recebeu — liberar reserva</option><option value="usage_confirmed">Uso confirmado — liquidar tokens reais</option></select></label>
          {resolution === 'usage_confirmed' && <div className="grid grid-cols-2 gap-2"><NumberField label="Tokens de entrada" type="number" min="0" value={inputById[row.id] ?? ''} onChange={(value) => setInputById((old) => ({ ...old, [row.id]: value }))} /><NumberField label="Tokens de saída" type="number" min="0" value={outputById[row.id] ?? ''} onChange={(value) => setOutputById((old) => ({ ...old, [row.id]: value }))} /></div>}
          <NumberField label="Referência da evidência, sem segredos" value={evidenceById[row.id] || ''} maxLength="200" onChange={(value) => setEvidenceById((old) => ({ ...old, [row.id]: value }))} />
          <label className="text-xs font-medium text-slate-600">Motivo auditável<textarea className={`${inputClass} min-h-16`} maxLength="500" value={reasonById[row.id] || ''} onChange={(event) => setReasonById((old) => ({ ...old, [row.id]: event.target.value }))} /></label>
        </div>
        <button type="button" disabled={busyId === row.id || (reasonById[row.id] || '').trim().length < 8 || (evidenceById[row.id] || '').trim().length < 8 || (resolution === 'usage_confirmed' && (inputById[row.id] === undefined || outputById[row.id] === undefined))} onClick={() => resolve(row)} className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busyId === row.id ? 'Reconciliando…' : 'Confirmar reconciliação'}</button>
      </article>;
    })}
  </section>;
}

export function CompanyAiCreditsAdmin({ companyId, canManage }) {
  const [data, setData] = useState(null); const [monthly, setMonthly] = useState(''); const [bonus, setBonus] = useState('0'); const [expires, setExpires] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => { try { const result = await platformAdminService.aiCreditCompany(companyId); setData(result); setMonthly(result.wallet?.override_monthly_allowance == null ? '' : String(result.wallet.override_monthly_allowance)); setExpires(result.wallet?.override_expires_at ? new Date(result.wallet.override_expires_at).toISOString().slice(0,16) : ''); } catch (cause) { setError(cause.message || 'Saldo de créditos indisponível.'); } }, [companyId]);
  useEffect(() => { load(); }, [load]);
  const save = async (restore = false) => { if (!canManage) return; setBusy(true); setError(''); setMessage(''); try { await platformAdminService.adjustAiCreditCompany({ company_id: companyId, monthly_allowance: restore ? '' : monthly, bonus_credits: restore ? 0 : Number(bonus), reference_key: Number(bonus) > 0 && !restore ? crypto.randomUUID() : '', expires_at: restore || !expires ? null : new Date(expires).toISOString(), reason: reason.trim() }); setMessage(restore ? 'Padrão do plano restaurado.' : 'Limites/créditos atualizados com auditoria.'); setReason(''); setBonus('0'); await load(); } catch (cause) { setError(cause.message || 'Não foi possível salvar a configuração.'); } finally { setBusy(false); } };
  const wallet = data?.wallet || {};
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div><h3 className="font-semibold">F7 AI Credits da empresa</h3><p className="mt-1 text-xs text-slate-500">Franquia, extras e histórico são separados do teto financeiro real da IA.</p></div><Message error={Boolean(error)}>{error}</Message><Message>{message}</Message>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Plano" value={wallet.cycle_plan || '—'} /><Metric label="Franquia do ciclo" value={wallet.monthly_allowance ?? '—'} /><Metric label="Franquia restante" value={wallet.monthly_remaining ?? '—'} /><Metric label="Créditos extras" value={wallet.extra_balance ?? '—'} /><Metric label="Consumo neste ciclo" value={wallet.used_this_cycle ?? '—'} /><Metric label="Renovação" value={wallet.cycle_end ? new Date(wallet.cycle_end).toLocaleDateString('pt-BR') : '—'} /></div>
    {canManage ? <div className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-2"><NumberField label="Franquia individual (vazio = padrão do plano)" type="number" min="0" max="1000000" value={monthly} onChange={setMonthly} /><NumberField label="Bônus adicional" type="number" min="0" max="100000" value={bonus} onChange={setBonus} /><NumberField label="Expiração da exceção (opcional)" type="datetime-local" value={expires} onChange={setExpires} /><label className="block text-xs font-medium text-slate-600">Motivo obrigatório<textarea className={`${inputClass} min-h-20`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label><div className="flex flex-wrap gap-2 md:col-span-2"><button disabled={busy || reason.trim().length < 8} onClick={() => save(false)} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar exceção / bônus'}</button><button disabled={busy || reason.trim().length < 8} onClick={() => save(true)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Restaurar padrão do plano</button></div></div> : <p className="text-xs text-slate-500">Somente Owner Global pode alterar limites, conceder bônus ou restaurar o padrão.</p>}
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Data','Evento','Franquia Δ','Extras Δ'].map((item) => <th key={item} className="px-3 py-2">{item}</th>)}</tr></thead><tbody>{(data?.history || []).map((row,index)=><tr key={`${row.created_at}-${index}`} className="border-t"><td className="px-3 py-2">{new Date(row.created_at).toLocaleString('pt-BR')}</td><td className="px-3 py-2">{row.entry_type}</td><td className="px-3 py-2">{Number(row.monthly_delta)>0?'+':''}{row.monthly_delta}</td><td className="px-3 py-2">{Number(row.extra_delta)>0?'+':''}{row.extra_delta}</td></tr>)}</tbody></table></div>
  </section>;
}

function Metric({label,value}) { return <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>; }
