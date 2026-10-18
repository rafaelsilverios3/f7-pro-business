import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { billingService } from '@/services/billingService';
import MercadoPagoCardTokenBrick from '@/components/billing/MercadoPagoCardTokenBrick';
import { useAuth } from '@/lib/AuthContext';
import { priceForBillingPeriod } from '@/services/billingPricing';

const money = (minor, currency = 'BRL') => minor == null ? 'Preço a definir' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(minor) / 100);

export default function Checkout() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [billingModel, setBillingModel] = useState('one_time');
  const [billingPeriod, setBillingPeriod] = useState('month');
  const [method, setMethod] = useState('pix');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const code = params.get('plan') || 'pro';
  const plan = plans.find((item) => item.code === code);
  const amountMinor = priceForBillingPeriod(plan, billingPeriod);

  useEffect(() => {
    if (plan?.billing_period === 'year') setBillingPeriod('year');
    else setBillingPeriod('month');
  }, [plan?.code, plan?.billing_period]);

  useEffect(() => {
    if (billingModel === 'recurring') setMethod('card');
  }, [billingModel]);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError('');
    try {
      const availablePlans = await billingService.listPlans();
      setPlans(Array.isArray(availablePlans) ? availablePlans : []);
    } catch {
      setPlansError('Não foi possível carregar os planos agora. Tente novamente.');
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => { void loadPlans(); }, [loadPlans]);

  const startPayment = async () => {
    if (!plan || amountMinor == null || !company?.id) return;
    setLoading(true); setError('');
    try { setResult(await billingService.createCheckout(company.id, plan.code, billingModel, billingPeriod, method)); }
    catch (cause) { setError(cause.message || 'Não foi possível iniciar o checkout.'); }
    finally { setLoading(false); }
  };

  const submitCardToken = useCallback(async (cardPayment) => {
    if (!plan || !company?.id) throw new Error('Não foi possível vincular o plano à empresa atual.');
    setLoading(true); setError('');
    try {
      // The single-use token is passed directly to the backend and is never
      // retained in React state, storage, analytics, or URL parameters.
      const response = await billingService.createCheckout(company.id, plan.code, billingModel, billingPeriod, 'card', cardPayment);
      setResult(response);
      return response;
    } catch (cause) { setError(cause.message || 'Não foi possível iniciar a assinatura.'); throw cause; }
    finally { setLoading(false); }
  }, [billingModel, billingPeriod, company?.id, plan]);

  const onCardError = useCallback((cause) => setError(cause?.message || 'O formulário seguro de cartão não está disponível.'), []);
  const copy = async () => { if (result?.pix?.qr_code) await navigator.clipboard?.writeText(result.pix.qr_code); };

  if (plansLoading) return <div className="mx-auto max-w-3xl px-5 py-10" role="status" aria-live="polite"><p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Carregando planos…</p></div>;
  if (plansError) return <div className="mx-auto max-w-3xl px-5 py-10" role="alert"><p>{plansError}</p><div className="mt-4 flex gap-3"><Button onClick={() => void loadPlans()}>Tentar novamente</Button><Button variant="ghost" onClick={() => navigate('/planos')}>Voltar aos planos</Button></div></div>;
  if (!plan) return <div className="mx-auto max-w-3xl px-5 py-10"><p>Plano não encontrado.</p><Button className="mt-4" onClick={() => navigate('/planos')}>Voltar aos planos</Button></div>;
  if (!company?.id) return <div className="mx-auto max-w-3xl px-5 py-10"><PageHeader title="Prepare sua empresa" subtitle="Antes do checkout, precisamos criar o espaço seguro da sua empresa." /><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm leading-6 text-slate-600">Você escolheu o plano <strong>{plan.name}</strong>. Crie sua empresa para manter a contratação vinculada ao tenant correto.</p><Button className="mt-5 w-full" onClick={() => navigate(`/onboarding?returnTo=${encodeURIComponent(`/checkout?plan=${plan.code}`)}`)}>Criar empresa e continuar</Button><Button variant="ghost" className="mt-2 w-full" onClick={() => navigate('/planos')}>Voltar aos planos</Button></section></div>;

  return <div className="mx-auto max-w-3xl px-5 py-8">
    <PageHeader title="Checkout F7 Business" subtitle="O plano só é liberado após confirmação server-side do pagamento." />
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-indigo-600">Plano selecionado</p>
      <h2 className="mt-1 text-2xl font-bold">{plan.name}</h2>
      <p className="mt-2 text-sm text-slate-500">{plan.description}</p>
      <p className="mt-5 text-3xl font-bold text-slate-900">{money(amountMinor, plan.currency)} <span className="text-sm font-normal text-slate-500">/ {billingPeriod === 'year' ? 'ano' : 'mês'}</span></p>

      {plan.code === 'free' ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">O plano FREE não gera cobrança. Você pode começar sem pagamento.</p>
        : amountMinor == null ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Este período ainda não possui um preço definido no catálogo oficial. Escolha outro período ou solicite a configuração comercial.</p>
          : result?.pix ? <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <p className="font-semibold text-indigo-900">Pagamento via PIX</p>
            {result.pix.qr_code_base64 && <img src={`data:image/png;base64,${result.pix.qr_code_base64}`} alt="QR Code PIX" className="mx-auto my-4 h-48 w-48 rounded bg-white p-2" />}
            {result.pix.qr_code && <div className="flex gap-2"><input readOnly value={result.pix.qr_code} className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs" /><Button type="button" variant="outline" onClick={copy}><Copy className="h-4 w-4" /></Button></div>}
            <p className="mt-3 text-xs text-indigo-800">Aguardando pagamento avulso de {billingPeriod === 'year' ? '12 meses' : '1 mês'}. O plano só ativa após confirmação do webhook; não há renovação automática.</p>
          </div> : result?.subscription ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="font-semibold text-emerald-900">Autorização recorrente iniciada</p>
            <p className="mt-2 text-sm text-emerald-800">Status: {result.subscription.status}. O acesso só será liberado após confirmação server-side do primeiro pagamento.</p>
            {result.subscription.init_point && <a className="mt-4 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700" href={result.subscription.init_point} target="_blank" rel="noopener noreferrer">Continuar no Mercado Pago</a>}
          </div> : result?.payment ? <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><p className="font-semibold text-indigo-900">Pagamento avulso enviado</p><p className="mt-2 text-sm text-indigo-800">Status: {result.payment.status}. O acesso será liberado somente após confirmação do Mercado Pago. Esta compra não autoriza cobranças futuras.</p></div> : <>
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold text-slate-800">Como deseja pagar?</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className={`cursor-pointer rounded-xl border p-3 ${billingModel === 'one_time' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}><input type="radio" name="billingModel" value="one_time" checked={billingModel === 'one_time'} onChange={() => { setBillingModel('one_time'); setMethod('pix'); setResult(null); }} /> <span className="ml-2 font-medium">Pagamento avulso</span><span className="mt-1 block text-xs text-slate-600">Acesso por período, sem renovação automática.</span></label>
                <label className={`cursor-pointer rounded-xl border p-3 ${billingModel === 'recurring' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}><input type="radio" name="billingModel" value="recurring" checked={billingModel === 'recurring'} onChange={() => { setBillingModel('recurring'); setMethod('card'); setResult(null); }} /> <span className="ml-2 font-medium">Assinatura recorrente</span><span className="mt-1 block text-xs text-slate-600">Cartão cobrado automaticamente a cada período; cancele quando quiser.</span></label>
              </div>
            </fieldset>
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-slate-800">Período</legend>
              <div className="mt-2 flex gap-4 text-sm"><label><input type="radio" name="billingPeriod" value="month" checked={billingPeriod === 'month'} disabled={plan.billing_period === 'year'} onChange={() => { setBillingPeriod('month'); setResult(null); }} /> <span className="ml-1">Mensal</span></label><label><input type="radio" name="billingPeriod" value="year" checked={billingPeriod === 'year'} onChange={() => { setBillingPeriod('year'); setResult(null); }} /> <span className="ml-1">Anual</span></label></div>
              {plan.billing_period === 'month' && billingPeriod === 'year' && <p className="mt-2 text-xs text-slate-500">Total anual equivalente a 12 mensalidades, sem desconto. O valor final é recalculado e validado pelo backend.</p>}
            </fieldset>
            <div className="mt-4 flex gap-3">
              {billingModel === 'one_time' && <label className="text-sm">Forma de pagamento<select className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2" value={method} onChange={(event) => { setMethod(event.target.value); setResult(null); }}><option value="pix">PIX</option><option value="card">Cartão</option></select></label>}
              {billingModel === 'recurring' && <p className="text-sm text-slate-600">Forma de pagamento: cartão com tokenização segura do Mercado Pago.</p>}
            </div>
            {method === 'pix' ? <><p className="mt-2 text-xs text-slate-500">Pagamento único; o período contratado expira e poderá ser renovado manualmente.</p><Button className="mt-5 w-full" onClick={startPayment} disabled={loading || amountMinor == null}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Gerar PIX</Button></>
              : <MercadoPagoCardTokenBrick amountMinor={amountMinor} email={user?.email} onToken={submitCardToken} onError={onCardError} />}
          </>}

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <p className="mt-5 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Dados de cartão são tokenizados pelo Mercado Pago; a F7 não recebe nem armazena número ou CVV.</p>
    </section>
  </div>;
}
