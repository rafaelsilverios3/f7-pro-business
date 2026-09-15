import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, Check, ChevronLeft, Factory, Package, ShoppingBag, Sparkles, Users, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompany } from '@/lib/useCompany';
import { useAuth } from '@/lib/AuthContext';
import { can } from '@/lib/permissions';
import { customersRepository } from '@/data/repositories/customersRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { salesRepository } from '@/data/repositories/salesRepository';
import { quotesRepository } from '@/data/repositories/quotesRepository';
import { purchasesRepository } from '@/data/repositories/purchasesRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { safeReturnTo } from '@/lib/authReturnTo';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { loadSubscription } from '@/services/subscriptionService';
import { canUseSubscriptionFeature } from '@/services/planService';
import { ONBOARDING_JOURNEYS, buildOnboardingProgress, getJourney, getSeenEducativeSteps, isNewCompany, markEducativeStepSeen, setJourney, setOnboardingDismissed, visibleOnboardingSteps } from '@/services/onboardingService';

const JOURNEY_ICONS = { commerce: ShoppingBag, services: Wrench, production: Factory };
const FALLBACK_ROLE = import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? '' : 'admin';

export default function Onboarding() {
  const { company, createCompany } = useCompany();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [journey, setJourneyState] = useState(() => getJourney(company?.id));
  const [snapshot, setSnapshot] = useState({ company, customers: [], products: [], sales: [], quotes: [], purchases: [], movements: [] });
  const [seen, setSeen] = useState(() => getSeenEducativeSteps(company?.id));
  const [role, setRole] = useState(user?.role || FALLBACK_ROLE);
  const [loading, setLoading] = useState(Boolean(company?.id));
  const [error, setError] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyError, setCompanyError] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => { setJourneyState(getJourney(company?.id)); setSeen(getSeenEducativeSteps(company?.id)); }, [company?.id]);

  useEffect(() => {
    if (!company?.id) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError('');
    Promise.allSettled([
      customersRepository.list(company.id, '-created_date', 500), productsRepository.list(company.id, '-created_date', 500), salesRepository.list(company.id, '-sale_date', 500),
      quotesRepository.list(company.id, '-created_date', 500), purchasesRepository.list(company.id, '-created_date', 500), inventoryRepository.list(company.id, '-created_date', 500),
    ]).then((results) => {
      if (cancelled) return;
      const value = (index) => results[index]?.status === 'fulfilled' ? results[index].value || [] : [];
      setSnapshot({ company, customers: value(0), products: value(1), sales: value(2), quotes: value(3), purchases: value(4), movements: value(5) });
      if (results.every((result) => result.status === 'rejected')) setError('Não foi possível carregar o progresso agora. Você ainda pode abrir os módulos diretamente.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [company]);

  useEffect(() => {
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { setSubscription(null); return undefined; }
    let cancelled = false;
    loadSubscription(company.id).then((value) => { if (!cancelled) setSubscription(value); }).catch(() => { if (!cancelled) setSubscription(null); });
    return () => { cancelled = true; };
  }, [company?.id]);

  useEffect(() => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id || !user?.id) return undefined;
    let cancelled = false;
    getSupabaseClient().from('company_users').select('role').eq('company_id', company.id).eq('user_id', user.id).eq('active', true).maybeSingle().then(({ data }) => { if (!cancelled) setRole(data?.role || ''); }).catch(() => { if (!cancelled) setRole(''); });
    return () => { cancelled = true; };
  }, [company?.id, user?.id]);

  const newCompany = isNewCompany(company, snapshot);
  const steps = useMemo(() => visibleOnboardingSteps(journey, { canAccess: (permission) => !permission || can({ role }, permission), featureEnabled: (feature) => canUseSubscriptionFeature(subscription, feature, { provider: import.meta.env.VITE_DATA_PROVIDER, fallbackPlan: 'free' }) }), [journey, role, subscription]);
  const progress = useMemo(() => buildOnboardingProgress(steps, snapshot, seen), [steps, snapshot, seen]);
  const chooseJourney = (value) => { setJourney(company?.id, value); setJourneyState(value); };
  const dismiss = () => { setOnboardingDismissed(company?.id); navigate(safeReturnTo()); };
  const openStep = (step) => { if (step.completionRule === 'seen') { markEducativeStepSeen(company.id, step.id); setSeen((current) => ({ ...current, [step.id]: true })); } navigate(step.route); };

  if (!company) return (
    <div className="mx-auto max-w-lg px-5 py-16"><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-900">Crie sua empresa</h1><p className="mt-2 text-sm text-slate-500">Sua conta ainda não possui uma empresa. Informe o nome para iniciar o F7 PRO BUSINESS.</p>{companyError && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{companyError}</p>}<form className="mt-5 space-y-3" onSubmit={async (event) => { event.preventDefault(); setCompanyError(''); setCreatingCompany(true); try { await createCompany(companyName); } catch (cause) { setCompanyError(cause.message || 'Não foi possível criar a empresa.'); } finally { setCreatingCompany(false); } }}><Label htmlFor="company-name">Nome da empresa</Label><Input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Ex: F7 Comércio" required minLength={2} /><Button type="submit" className="w-full" disabled={creatingCompany}>{creatingCompany ? 'Criando...' : 'Criar empresa e continuar'}</Button></form></div></div>
  );

  if (!journey) return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-12"><div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-500">F7 PRO BUSINESS</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Bem-vindo ao F7 Business</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Vamos preparar sua empresa para começar a operar. Escolha a jornada que mais se aproxima do seu trabalho; você pode continuar usando o sistema e mudar essa escolha depois.</p></div><Button variant="ghost" onClick={dismiss} className="self-start text-sm text-slate-500">Pular por enquanto</Button></div><div className="grid gap-4 md:grid-cols-3">{ONBOARDING_JOURNEYS.map((item) => { const Icon = JOURNEY_ICONS[item.id]; return <button key={item.id} type="button" onClick={() => chooseJourney(item.id)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="h-5 w-5" /></span><h2 className="mt-4 font-semibold text-slate-900">{item.label}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p><span className="mt-4 inline-flex items-center text-sm font-semibold text-blue-600">Começar jornada <ArrowRight className="ml-1 h-4 w-4" /></span></button>; })}</div><p className="mt-6 text-center text-xs text-slate-400">As orientações são opcionais e não bloqueiam o acesso aos módulos.</p></div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 lg:py-10"><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-500">Primeiros passos no F7</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{newCompany ? 'Vamos preparar sua operação' : 'Treinamento inicial da operação'}</h1><p className="mt-2 text-sm leading-6 text-slate-500">Aprenda, faça no módulo certo e volte para confirmar o próximo passo. O progresso abaixo é baseado nos dados reais da sua empresa.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setJourneyState(null)}><ChevronLeft className="mr-1 h-4 w-4" /> Trocar jornada</Button><Button variant="ghost" onClick={dismiss}>Ocultar primeiros passos</Button></div></div>{error && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}<div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-slate-900">Jornada: {ONBOARDING_JOURNEYS.find((item) => item.id === journey)?.label}</p><p className="mt-1 text-xs text-slate-500">{progress.count} de {progress.total} etapas concluídas</p></div><span className="text-2xl font-bold text-blue-600">{progress.percent}%</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Progresso dos primeiros passos" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent}><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress.percent}%` }} /></div></div>{!loading && progress.count === progress.total && progress.total > 0 && <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="font-semibold text-emerald-900">Seu F7 está pronto para trabalhar.</h2><p className="mt-1 text-sm text-emerald-800">Agora o Dashboard começará a refletir a operação real da sua empresa.</p><Button className="mt-4 bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('/f7probusiness')}>Ir para o Dashboard <ArrowRight className="ml-1 h-4 w-4" /></Button></div></div></div>}<div className="grid gap-4">{loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Carregando evidências reais da empresa...</div> : steps.map((step) => { const done = progress.completed[step.id]; const Icon = step.id === 'dashboard' ? BarChart3 : step.id === 'customer' ? Users : step.id === 'product' || step.id === 'service' || step.id === 'raw_material' ? Package : step.id === 'production' ? Factory : Sparkles; return <article key={step.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${done ? 'border-emerald-200' : 'border-slate-200'}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-600'}`}>{done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-900">{step.title}</h2>{done && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Concluída</span>}</div><p className="mt-1 text-sm text-slate-600">{step.shortDescription}</p><p className="mt-2 text-xs leading-5 text-slate-500"><strong>Por que importa:</strong> {step.whyItMatters}</p>{!done && <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">O F7 confirma esta etapa quando encontrar a evidência correspondente na empresa.</p>}</div><Button type="button" variant={done ? 'outline' : 'default'} className="w-full shrink-0 sm:w-auto" onClick={() => openStep(step)}>{done ? 'Revisar módulo' : step.actionLabel}<ArrowRight className="ml-1 h-4 w-4" /></Button></div></article>; })}</div><p className="mt-6 text-center text-xs text-slate-400">Você pode ocultar estes primeiros passos a qualquer momento e continuar usando o F7 normalmente.</p></div>
  );
}
