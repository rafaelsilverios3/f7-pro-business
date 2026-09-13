import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2, ReceiptText } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const statusLabels = { trial: 'Período de teste', active: 'Ativa', pending: 'Aguardando pagamento', approved: 'Pago', past_due: 'Em atraso', cancelled: 'Cancelada', suspended: 'Suspensa', failed: 'Falhou' };
const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const money = (minor, currency = 'BRL') => minor == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(minor) / 100);

export default function SubscriptionBilling() {
  const { company } = useOutletContext();
  const [subscription, setSubscription] = useState(null); const [payments, setPayments] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { setLoading(false); return undefined; }
    Promise.all([
      getSupabaseClient().from('company_subscriptions').select('id,plan,status,trial_ends_at,current_period_start,current_period_end,created_at,updated_at').eq('company_id', company.id).maybeSingle(),
      getSupabaseClient().from('billing_payments').select('id,amount_minor,currency,status,provider_status,created_at,updated_at').eq('company_id', company.id).order('created_at', { ascending: false }).limit(25),
    ]).then(([subscriptionResult, paymentsResult]) => {
      if (cancelled) return;
      if (subscriptionResult.error || paymentsResult.error) setError('Não foi possível carregar os dados de assinatura.');
      setSubscription(subscriptionResult.data || null); setPayments(paymentsResult.data || []);
    }).catch(() => { if (!cancelled) setError('Não foi possível carregar os dados de assinatura.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [company?.id]);
  if (loading) return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;
  return <div className="mx-auto max-w-5xl px-5 py-8"><PageHeader title="Assinatura e pagamentos" subtitle="Consulte o plano da empresa e os pagamentos registrados pela plataforma." action={<Button asChild><Link to="/planos">Ver planos</Link></Button>} />
    {error && <p className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    <section className="rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 text-white shadow-sm"><div className="flex items-start gap-3"><CreditCard className="mt-1 h-5 w-5 text-blue-300" /><div><p className="text-xs uppercase tracking-wide text-blue-300">Plano atual</p><h2 className="mt-1 text-2xl font-semibold">{subscription?.plan?.toUpperCase() || 'Sem assinatura'}</h2><p className="mt-2 text-sm text-slate-300">Status: {statusLabels[subscription?.status] || subscription?.status || 'Não configurado'}</p></div></div><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-slate-400">Trial até</dt><dd>{date(subscription?.trial_ends_at)}</dd></div><div><dt className="text-slate-400">Período atual</dt><dd>{date(subscription?.current_period_start)} → {date(subscription?.current_period_end)}</dd></div><div><dt className="text-slate-400">Atualizado</dt><dd>{date(subscription?.updated_at)}</dd></div></dl></section>
    <section className="mt-6 rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 text-white"><div className="flex items-center gap-3"><ReceiptText className="h-5 w-5 text-blue-300" /><div><h2 className="font-semibold">Histórico de pagamentos</h2><p className="text-xs text-slate-400">Somente registros da assinatura desta empresa.</p></div></div>{payments.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-slate-700 text-xs text-slate-400"><tr><th className="px-3 py-2">Data</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Provedor</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-b border-slate-800"><td className="px-3 py-3">{date(payment.created_at)}</td><td className="px-3 py-3">{money(payment.amount_minor, payment.currency)}</td><td className="px-3 py-3">{statusLabels[payment.status] || payment.status || '—'}</td><td className="px-3 py-3">Mercado Pago · {payment.provider_status || '—'}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nenhum pagamento registrado para esta empresa.</p>}</section>
    <p className="mt-5 text-xs text-slate-500">A ativação, renovação e mudança de status dependem da confirmação server-side do provedor. Dados financeiros operacionais da empresa não são usados neste painel.</p>
  </div>;
}
