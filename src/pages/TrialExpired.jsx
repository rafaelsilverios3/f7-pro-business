import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingService } from '@/services/billingService';

export default function TrialExpired() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    billingService.listPlans()
      .then((items) => { if (active) setPlans(items.filter((plan) => plan.code !== 'free')); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);
  const money = (minor, currency = 'BRL') => minor == null ? 'Preço a definir' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(minor) / 100);
  return <div className="flex min-h-screen items-center justify-center bg-slate-950 p-5"><main className="w-full max-w-4xl rounded-3xl border border-slate-700 bg-[#0e1a2b] p-6 text-white shadow-2xl sm:p-10"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-300">F7 Business</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Seu teste gratuito terminou</h1><p className="mt-4 max-w-2xl leading-7 text-slate-300">Obrigado por experimentar o F7 Business. Para continuar utilizando a plataforma, escolha o plano que mais combina com a sua empresa.</p>
    {loading ? <p role="status" className="mt-8 text-sm text-slate-300">Carregando catálogo de preços…</p>
      : error ? <div role="alert" className="mt-8 rounded-xl border border-amber-700 bg-amber-950/40 p-5 text-sm text-amber-100"><p>Não foi possível carregar o catálogo de preços. Nenhum valor estimado será exibido.</p><button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-3 rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white">Tentar novamente</button></div>
        : plans.length === 0 ? <p className="mt-8 text-sm text-slate-300">Não há planos pagos disponíveis no momento.</p>
          : <div className="mt-8 grid gap-4 md:grid-cols-3">{plans.map((plan) => <article key={plan.code} className={`rounded-2xl border p-5 ${plan.highlighted ? 'border-blue-400 bg-blue-500/10' : 'border-slate-700'}`}><div className="flex items-center justify-between"><h2 className="font-semibold">{plan.name}</h2>{plan.highlighted && <span className="rounded-full bg-blue-400/20 px-2 py-1 text-[10px] text-blue-200">Mais escolhido</span>}</div><p className="mt-4 text-2xl font-bold">{money(plan.price_minor, plan.currency)}<span className="text-xs font-normal text-slate-400"> / {plan.billing_period === 'year' ? 'ano' : 'mês'}</span></p><Link to={`/checkout?plan=${encodeURIComponent(plan.code)}`} className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold hover:bg-blue-400">Escolher {plan.name}</Link></article>)}</div>}
    <p className="mt-8 text-center text-xs text-slate-500">Seus produtos, clientes, vendas e configurações foram preservados.</p></main></div>;
}
