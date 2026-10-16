import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2, ReceiptText } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { billingService } from '@/services/billingService';

const statusLabels = { trial: 'Período de teste', active: 'Ativa', authorized: 'Autorizada', paused: 'Pausada', pending: 'Aguardando pagamento', approved: 'Pago', past_due: 'Em atraso', cancelled: 'Cancelada', suspended: 'Suspensa', rejected: 'Recusada', expired: 'Expirada', failed: 'Falhou' };
const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const money = (minor, currency = 'BRL') => minor == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(minor) / 100);

export default function SubscriptionBilling() {
  const { company } = useOutletContext();
  const [subscription, setSubscription] = useState(null); const [recurring, setRecurring] = useState(null); const [currentPlan, setCurrentPlan] = useState(null); const [payments, setPayments] = useState([]); const [health, setHealth] = useState(null); const [healthError, setHealthError] = useState(''); const [healthLoading, setHealthLoading] = useState(true); const [healthRetry, setHealthRetry] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [manageError, setManageError] = useState(''); const [managing, setManaging] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { setLoading(false); return undefined; }
    Promise.all([
      getSupabaseClient().from('company_subscriptions').select('id,plan,status,trial_ends_at,current_period_start,current_period_end,created_at,updated_at').eq('company_id', company.id).maybeSingle(),
      getSupabaseClient().from('billing_subscriptions').select('id,status,provider_status,current_period_start,current_period_end').eq('company_id', company.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      getSupabaseClient().from('billing_payments').select('id,amount_minor,currency,status,provider_status,created_at,updated_at').eq('company_id', company.id).order('created_at', { ascending: false }).limit(25),
      getSupabaseClient().from('plans').select('code,name,price_minor,currency,billing_period').eq('active', true),
    ]).then(([subscriptionResult, recurringResult, paymentsResult, plansResult]) => {
      if (cancelled) return;
      if (subscriptionResult.error || paymentsResult.error) setError('Não foi possível carregar os dados de assinatura.');
      setSubscription(subscriptionResult.data || null); setRecurring(recurringResult.error ? null : recurringResult.data || null); setCurrentPlan((plansResult.data || []).find((plan) => plan.code === subscriptionResult.data?.plan) || null); setPayments(paymentsResult.data || []);
    }).catch(() => { if (!cancelled) setError('Não foi possível carregar os dados de assinatura.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [company?.id]);
  useEffect(() => {
    let cancelled = false;
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { setHealthLoading(false); return undefined; }
    setHealthLoading(true); setHealthError('');
    billingService.health(company.id)
      .then((result) => { if (!cancelled) { setHealth(result); setHealthError(''); } })
      .catch((cause) => {
        if (cancelled) return;
        setHealth(null);
        setHealthError(cause?.httpStatus === 404
          ? 'O endpoint de diagnóstico do provedor não está publicado neste ambiente.'
          : 'Não foi possível consultar o diagnóstico do provedor agora.');
      })
      .finally(() => { if (!cancelled) setHealthLoading(false); });
    return () => { cancelled = true; };
  }, [company?.id, healthRetry]);
  const manage = async (action) => {
    if (!company?.id || !recurring?.id || managing) return;
    setManaging(true); setManageError('');
    try {
      const result = await billingService.manageSubscription(company.id, recurring.id, action);
      setRecurring((current) => ({ ...current, status: result.status }));
      if (action === 'cancel') setSubscription((current) => current ? { ...current, status: 'cancelled' } : current);
    } catch (cause) {
      setManageError(cause.message || 'Não foi possível atualizar a assinatura.');
    } finally { setManaging(false); }
  };
  if (loading) return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;
  return <div className="mx-auto max-w-5xl px-5 py-8"><PageHeader title="Assinatura e pagamentos" subtitle="Consulte o plano da empresa e os pagamentos registrados pela plataforma." action={<Button asChild><Link to="/planos">Ver planos</Link></Button>} />
    {error && <p className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    <section className="rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 text-white shadow-sm"><div className="flex items-start gap-3"><CreditCard className="mt-1 h-5 w-5 text-blue-300" /><div><p className="text-xs uppercase tracking-wide text-blue-300">Plano atual</p><h2 className="mt-1 text-2xl font-semibold">{subscription?.plan?.toUpperCase() || 'Sem assinatura'}</h2><p className="mt-2 text-sm text-slate-300">Status: {statusLabels[subscription?.status] || subscription?.status || 'Não configurado'}</p><p className="mt-1 text-sm text-slate-300">Preço: {money(currentPlan?.price_minor, currentPlan?.currency)} / {currentPlan?.billing_period === 'year' ? 'ano' : 'mês'}</p></div></div><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-slate-400">Trial até</dt><dd>{date(subscription?.trial_ends_at)}</dd></div><div><dt className="text-slate-400">Período atual</dt><dd>{date(subscription?.current_period_start)} → {date(subscription?.current_period_end)}</dd></div><div><dt className="text-slate-400">Atualizado</dt><dd>{date(subscription?.updated_at)}</dd></div></dl></section>
    {recurring && ['authorized', 'paused', 'pending', 'past_due', 'rejected', 'expired'].includes(recurring.status) && <section className="mt-5 rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 text-white"><h2 className="font-semibold">Assinatura recorrente</h2><p className="mt-1 text-sm text-slate-300">Status no provedor: {statusLabels[recurring.status] || recurring.status}. Pausar ou cancelar é enviado ao Mercado Pago e só é confirmado após resposta do provedor.</p><div className="mt-4 flex flex-wrap gap-2">{recurring.status === 'authorized' && <Button variant="outline" disabled={managing} onClick={() => manage('pause')}>{managing ? 'Atualizando…' : 'Pausar renovação'}</Button>}{recurring.status === 'paused' && <Button variant="outline" disabled={managing} onClick={() => manage('resume')}>{managing ? 'Atualizando…' : 'Retomar renovação'}</Button>}<Button variant="destructive" disabled={managing} onClick={() => { if (window.confirm('Cancelar a renovação desta assinatura no Mercado Pago?')) manage('cancel'); }}>{managing ? 'Atualizando…' : 'Cancelar assinatura'}</Button></div>{manageError && <p role="alert" className="mt-3 text-sm text-rose-300">{manageError}</p>}</section>}
    {health && <section className="mt-6 rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 text-white shadow-sm"><p className="text-xs uppercase tracking-wide text-blue-300">Saúde do billing</p><div className="mt-3 grid gap-3 text-sm sm:grid-cols-4"><div><dt className="text-slate-400">Provedor</dt><dd>{health.provider || '—'}</dd></div><div><dt className="text-slate-400">Ambiente</dt><dd>{health.environment === 'not_configured' ? 'não configurado' : health.environment || '—'}</dd></div><div><dt className="text-slate-400">Estado</dt><dd>{({ ready: 'disponível', configuration_required: 'configuração pendente', provider_unavailable: 'indisponível', payments_disabled: 'pagamentos desativados' })[health.state] || 'indisponível'}</dd></div><div><dt className="text-slate-400">PIX sandbox</dt><dd>{health.pix_allowed ? 'disponível' : 'bloqueado'}</dd></div></div></section>}
    {healthLoading && !health && <p role="status" className="mt-6 rounded-xl border border-slate-700 bg-[#0e1a2b] p-4 text-sm text-slate-300">Verificando disponibilidade do diagnóstico de billing…</p>}
    {healthError && <section role="status" className="mt-6 rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-100"><p>{healthError} A validação de autorização e pagamento permanece no backend do checkout; este aviso não confirma disponibilidade para contratar.</p><Button variant="outline" className="mt-3" onClick={() => setHealthRetry((value) => value + 1)}>Tentar verificar novamente</Button></section>}
    <section className="mt-6 rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 text-white"><div className="flex items-center gap-3"><ReceiptText className="h-5 w-5 text-blue-300" /><div><h2 className="font-semibold">Histórico de pagamentos</h2><p className="text-xs text-slate-400">Somente registros da assinatura desta empresa.</p></div></div>{payments.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-slate-700 text-xs text-slate-400"><tr><th className="px-3 py-2">Data</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Provedor</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-b border-slate-800"><td className="px-3 py-3">{date(payment.created_at)}</td><td className="px-3 py-3">{money(payment.amount_minor, payment.currency)}</td><td className="px-3 py-3">{statusLabels[payment.status] || payment.status || '—'}</td><td className="px-3 py-3">Mercado Pago · {payment.provider_status || '—'}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nenhum pagamento registrado para esta empresa.</p>}</section>
    <p className="mt-5 text-xs text-slate-500">A ativação, renovação e mudança de status dependem da confirmação server-side do provedor. Dados financeiros operacionais da empresa não são usados neste painel.</p>
  </div>;
}
