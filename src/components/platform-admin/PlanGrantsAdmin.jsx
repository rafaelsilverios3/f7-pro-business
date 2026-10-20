import { useEffect, useMemo, useState } from 'react';
import { platformAdminService } from '@/services/platformAdminService';

const planOptions = [
  ['free', 'Starter'], ['pro', 'Pro'], ['business', 'Business'], ['premium', 'Premium'],
];
const formatDate = (value) => value ? new Date(value).toLocaleString('pt-BR') : '—';
const billingState = (value) => {
  if (!value) return 'sem registro';
  const deadline = value.status === 'trial' ? value.trial_ends_at : value.current_period_end;
  if (['active', 'trial'].includes(value.status) && deadline && new Date(deadline).getTime() <= Date.now()) return 'expirada';
  return value.status || 'sem registro';
};
const toLocalInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function PlanGrantsAdmin({ companies = [], role = 'readonly' }) {
  const [companyId, setCompanyId] = useState('');
  const [company, setCompany] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [planCode, setPlanCode] = useState('premium');
  const [grantType, setGrantType] = useState('courtesy');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [duration, setDuration] = useState('30');
  const [customDays, setCustomDays] = useState('');
  const [reason, setReason] = useState('');
  const canManage = ['owner', 'admin'].includes(role);
  const canGrantLifetime = role === 'owner';
  const companyOptions = useMemo(() => [...companies].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR')), [companies]);
  const subscription = company?.subscription || companyOptions.find((item) => item.id === companyId)?.subscription;
  const accessOrigin = company?.subscription?.manual_grant?.grant_type === 'lifetime'
    ? 'Concessão vitalícia'
    : company?.subscription?.manual_grant ? 'Cortesia administrativa'
      : company?.subscription?.billing_model ? 'Assinatura paga'
        : 'Plano/trial legado';

  const load = async (selectedId = companyId) => {
    if (!selectedId) { setRows([]); setCompany(null); return; }
    setLoading(true); setError('');
    try {
      const [grantResult, companyResult] = await Promise.all([
        platformAdminService.planGrants(selectedId), platformAdminService.company(selectedId),
      ]);
      setRows(grantResult.rows || []);
      setCompany(companyResult.company || null);
    } catch (cause) { setError(cause.message || 'Não foi possível carregar as concessões.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(companyId); }, [companyId]);

  const createGrant = async (event) => {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const startDate = new Date(startsAt);
      const days = duration === 'custom' ? Number(customDays) : Number(duration);
      if (!Number.isFinite(startDate.getTime()) || (grantType !== 'lifetime' && (!Number.isInteger(days) || days < 1 || days > 1825))) {
        throw new Error('Informe uma data inicial e uma duração válida (1 a 1.825 dias).');
      }
      const endDate = grantType === 'lifetime' ? null : new Date(startDate.getTime() + days * 86_400_000);
      await platformAdminService.createPlanGrant({
        company_id: companyId, plan_code: planCode, grant_type: grantType,
        starts_at: startDate.toISOString(), ends_at: endDate?.toISOString() || null, reason,
      });
      setNotice('Concessão registrada no histórico.'); setReason(''); await load(companyId);
    } catch (cause) { setError(cause.message || 'Não foi possível criar a concessão.'); }
    finally { setSaving(false); }
  };
  const revokeGrant = async (grant) => {
    const explanation = window.prompt('Motivo do encerramento desta concessão:');
    if (!explanation?.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await platformAdminService.revokePlanGrant(grant.id, explanation.trim());
      setNotice('Concessão encerrada.'); await load(companyId);
    } catch (cause) { setError(cause.message || 'Não foi possível encerrar a concessão.'); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600">Acesso administrativo</p><h2 className="mt-1 text-2xl font-semibold text-slate-900">Concessões de plano</h2></div>
      <button type="button" onClick={() => load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Atualizar</button>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <label className="block text-sm font-medium text-slate-700">Empresa
        <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Selecionar empresa</option>{companyOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(0, 8)}</option>)}
        </select>
      </label>
      {companyId && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-5">
        <div><p className="text-xs text-slate-500">Plano contratado</p><strong>{subscription?.paid_subscription?.plan || subscription?.plan || 'Starter'}</strong></div>
        <div><p className="text-xs text-slate-500">Plano efetivo</p><strong className={subscription?.manual_grant?.grant_type === 'lifetime' ? 'text-amber-700' : ''}>{subscription?.plan === 'free' ? 'Starter' : subscription?.plan || 'Starter'}{subscription?.manual_grant?.grant_type === 'lifetime' ? ' — VITALÍCIO' : ''}</strong></div>
        <div><p className="text-xs text-slate-500">Status de cobrança</p><strong>{billingState(subscription?.paid_subscription || subscription)}</strong></div>
        <div><p className="text-xs text-slate-500">Origem do acesso</p><strong>{accessOrigin}</strong></div>
        <div><p className="text-xs text-slate-500">Validade do acesso</p><strong>{formatDate(subscription?.current_period_end)}</strong></div>
      </div>}
    </section>
    {companyId && <>
      <form onSubmit={createGrant} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <div className="md:col-span-2"><h3 className="font-semibold text-slate-900">Nova concessão manual</h3><p className="mt-1 text-xs text-slate-500">Não cria cobrança nem altera a assinatura ou o histórico de pagamentos.</p></div>
        <label className="text-sm">Plano<select value={planCode} onChange={(event) => setPlanCode(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2">{planOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <label className="text-sm">Tipo<select value={grantType} onChange={(event) => setGrantType(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="trial">Teste temporário</option><option value="courtesy">Cortesia administrativa</option><option value="lifetime" disabled={!canGrantLifetime}>Vitalício (somente Owner Global)</option></select></label>
        <label className="text-sm">Início<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        {grantType !== 'lifetime' && <div className="grid grid-cols-2 gap-2"><label className="text-sm">Duração<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="custom">Personalizada</option></select></label>{duration === 'custom' && <label className="text-sm">Dias<input type="number" min="1" max="1825" value={customDays} onChange={(event) => setCustomDays(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>}</div>}
        {grantType === 'lifetime' && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 md:col-span-2">O acesso vitalício é permanente, auditado e só pode ser concedido pelo Owner Global.</div>}
        <label className="text-sm md:col-span-2">Motivo obrigatório<textarea minLength={8} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        {!canManage && <p className="text-sm text-rose-700 md:col-span-2">Seu perfil pode consultar concessões, mas não pode alterá-las.</p>}
        {error && <p role="alert" className="text-sm text-rose-700 md:col-span-2">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700 md:col-span-2">{notice}</p>}
        <div className="md:col-span-2"><button disabled={!canManage || saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Registrar concessão'}</button></div>
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900">Histórico de concessões</h3>
        {loading ? <p className="mt-4 text-sm text-slate-500">Carregando…</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Plano', 'Tipo', 'Início', 'Validade', 'Estado', 'Administrador', 'Motivo', 'Ação'].map((item) => <th key={item} className="px-3 py-2">{item}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-3 py-3 font-medium">{row.plan_code === 'free' ? 'Starter' : row.plan_code}</td><td className="px-3 py-3">{row.grant_type === 'lifetime' ? 'Vitalício' : row.grant_type === 'trial' ? 'Teste' : 'Cortesia'}</td><td className="px-3 py-3">{formatDate(row.starts_at)}</td><td className="px-3 py-3">{row.ends_at ? formatDate(row.ends_at) : 'Permanente'}</td><td className="px-3 py-3">{row.state === 'active' ? 'Ativa' : row.state === 'scheduled' ? 'Agendada' : row.state === 'expired' ? 'Expirada' : 'Revogada'}</td><td className="px-3 py-3 font-mono text-xs">{row.granted_by.slice(0, 8)}</td><td className="max-w-56 px-3 py-3">{row.reason}</td><td className="px-3 py-3">{canManage && ['active','scheduled'].includes(row.state) && <button type="button" disabled={saving} onClick={() => revokeGrant(row)} className="text-xs font-semibold text-rose-700 disabled:opacity-50">Encerrar</button>}</td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-slate-500">Nenhuma concessão registrada para esta empresa.</p>}</div>}
      </section>
    </>}
  </div>;
}
