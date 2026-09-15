import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, CircleHelp, LockKeyhole, Map, PlayCircle, Search } from 'lucide-react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/useCompany';
import { can } from '@/lib/permissions';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { canUseSubscriptionFeature } from '@/services/planService';
import { loadSubscription } from '@/services/subscriptionService';
import { getJourney, ONBOARDING_JOURNEYS, setJourney } from '@/services/onboardingService';
import {
  FUTURE_TRAINING_GUIDES, TRAINING_GUIDES, getNextTrainingGuide, getSeenTrainingGuides, getTrainingForJourney,
  getTrainingGuide, markTrainingGuideSeen, searchTrainingGuides,
} from '@/content/training/trainingContent';

const GROUPS = [
  { id: 'start', label: 'Comece aqui', ids: ['dashboard'] },
  { id: 'cadastros', label: 'Cadastros', ids: ['clientes', 'catalogo', 'precificacao'] },
  { id: 'operacao', label: 'Operação', ids: ['estoque', 'compras', 'orcamentos', 'vendas', 'pdv', 'producao'] },
  { id: 'gestao', label: 'Gestão', ids: ['financeiro', 'metas'] },
  { id: 'inteligencia', label: 'Inteligência', ids: FUTURE_TRAINING_GUIDES.map((item) => item.id) },
];

const PERMISSIONS = {
  dashboard: 'dashboard.view', clientes: 'customers.view', catalogo: 'products.view', precificacao: 'pricing.view', estoque: 'inventory.view', compras: 'purchases.view', orcamentos: 'quotes.view', vendas: 'sales.view', pdv: 'pdv.use', producao: 'production.view', financeiro: 'finance.view', metas: 'goals.view',
};
const PLAN_FEATURES = { intelligence: 'intelligence', 'opportunity-radar': 'opportunity_radar', automacoes: 'automations', 'supplier-intelligence': 'supplier_intelligence', 'sales-hub': 'advanced_reports', relatorios: 'advanced_reports', marketing: 'advanced_reports', crm: 'atendimento' };
const FAQS = [
  ['Orçamento movimenta estoque?', 'Não. O orçamento organiza a proposta; a venda confirmada é que pode produzir os efeitos operacionais previstos.'],
  ['Qual a diferença entre Venda e PDV?', 'O PDV é um caminho rápido para registrar a mesma venda oficial. Ele não cria um histórico paralelo.'],
  ['Como funciona a margem?', 'A margem é calculada a partir do custo e do preço de venda informados, preservando os centavos do valor determinado.'],
  ['Uma venda altera o estoque?', 'Quando o item é estocável e a venda é válida, o estoque segue as regras oficiais do fluxo de vendas.'],
];

function StatusPill({ children, tone = 'blue' }) {
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone === 'green' ? 'bg-emerald-500/15 text-emerald-300' : tone === 'amber' ? 'bg-amber-400/15 text-amber-200' : 'bg-blue-500/15 text-blue-200'}`}>{children}</span>;
}

function AcademyCard({ guide, seen, locked, onOpen }) {
  return <article className="flex h-full flex-col rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5 shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:border-blue-400/60">
    <div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300"><BookOpen className="h-5 w-5" /></div>{locked ? <StatusPill tone="amber"><LockKeyhole className="mr-1 inline h-3 w-3" /> Plano superior</StatusPill> : seen ? <StatusPill tone="green">Visto</StatusPill> : null}</div>
    <h3 className="mt-4 text-base font-semibold text-white">{guide.module}</h3><p className="mt-1 flex-1 text-sm leading-6 text-slate-300">{guide.shortDescription || 'Conteúdo de treinamento será disponibilizado quando este módulo estiver publicado.'}</p>
    <div className="mt-4 flex flex-wrap gap-2">{guide.videoUrl ? <StatusPill><PlayCircle className="mr-1 inline h-3 w-3" /> Vídeo</StatusPill> : <StatusPill>Guia rápido</StatusPill>}</div>
    <Button type="button" variant={locked ? 'outline' : 'default'} className="mt-4 w-full" onClick={() => onOpen(guide, locked)}>{locked ? 'Conhecer recurso' : seen ? 'Revisar treinamento' : 'Aprender'}<ArrowRight className="h-4 w-4" /></Button>
  </article>;
}

export default function Academy() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const { company } = useCompany();
  const { user } = useAuth();
  const { subscription: contextSubscription } = useOutletContext() || {};
  const [subscription, setSubscription] = useState(contextSubscription || null);
  const [role, setRole] = useState(user?.role || '');
  const [journey, setJourneyState] = useState(() => getJourney(company?.id));
  const [seen, setSeen] = useState(() => getSeenTrainingGuides(company?.id, user?.id));
  const [query, setQuery] = useState('');

  useEffect(() => { setSeen(getSeenTrainingGuides(company?.id, user?.id)); }, [company?.id, user?.id]);
  useEffect(() => { if (contextSubscription) setSubscription(contextSubscription); }, [contextSubscription]);
  useEffect(() => {
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return undefined;
    let cancelled = false;
    getSupabaseClient().from('company_users').select('role').eq('company_id', company.id).eq('user_id', user?.id).eq('active', true).maybeSingle().then(({ data }) => { if (!cancelled) setRole(String(data?.role || '')); }).catch(() => {});
    return () => { cancelled = true; };
  }, [company?.id, user?.id]);
  useEffect(() => {
    if (!contextSubscription && company?.id && import.meta.env.VITE_DATA_PROVIDER === 'supabase') loadSubscription(company.id).then(setSubscription).catch(() => {});
  }, [company?.id, contextSubscription]);

  const currentGuide = moduleId ? getTrainingGuide(moduleId) : null;
  useEffect(() => { if (currentGuide && company?.id && user?.id) { markTrainingGuideSeen(company.id, user.id, currentGuide.id); setSeen((value) => ({ ...value, [currentGuide.id]: { seenAt: new Date().toISOString() } })); } }, [currentGuide?.id, company?.id, user?.id]);
  const effectiveJourney = journey || 'commerce';
  const journeyGuides = useMemo(() => getTrainingForJourney(effectiveJourney), [effectiveJourney]);
  const canAccessGuide = (guide) => can({ role }, PERMISSIONS[guide.id] || guide.requiredFeature || 'dashboard.view');
  const lockedByPlan = (guide) => { const feature = PLAN_FEATURES[guide.id]; return Boolean(feature && import.meta.env.VITE_DATA_PROVIDER === 'supabase' && !canUseSubscriptionFeature(subscription, feature, { fallbackPlan: 'free' })); };
  const availableGuides = useMemo(() => TRAINING_GUIDES.filter(canAccessGuide), [role]);
  const futureGuides = useMemo(() => FUTURE_TRAINING_GUIDES.filter(canAccessGuide), [role]);
  const searched = useMemo(() => searchTrainingGuides(query, [...availableGuides, ...futureGuides]), [query, availableGuides, futureGuides]);
  const continueGuide = journeyGuides.find((guide) => !seen[guide.id]) || journeyGuides[0];

  const openGuide = (guide, locked = false) => { if (locked) { navigate('/planos'); return; } if (!guide.stepByStep) { navigate(guide.route); return; } navigate(`/treinamento/${guide.id}`); };
  const chooseJourney = (value) => { if (company?.id) setJourney(company.id, value); setJourneyState(value); };

  if (currentGuide && !currentGuide.stepByStep) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"><button type="button" onClick={() => navigate('/treinamento')} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200"><ArrowLeft className="h-4 w-4" /> Voltar para a Academia F7</button><article className="rounded-3xl border border-slate-700/70 bg-[#0e1a2b] p-6 shadow-xl"><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">Recurso em preparação</p><h1 className="mt-2 text-3xl font-bold text-white">{currentGuide.module}</h1><p className="mt-3 text-sm leading-6 text-slate-300">Este módulo já está mapeado para a Academia, mas o conteúdo guiado será publicado junto com a experiência oficial.</p><Link to={currentGuide.route} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Abrir módulo real <ArrowRight className="h-4 w-4" /></Link></article></main>;
  }
  if (currentGuide) {
    const next = getNextTrainingGuide(currentGuide.id, effectiveJourney);
    return <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10"><button type="button" onClick={() => navigate('/treinamento')} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200"><ArrowLeft className="h-4 w-4" /> Voltar para a Academia F7</button><article className="rounded-3xl border border-slate-700/70 bg-[#0e1a2b] p-5 shadow-xl sm:p-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">Treinamento do módulo</p><h1 className="mt-2 text-3xl font-bold text-white">{currentGuide.title}</h1><p className="mt-2 max-w-2xl text-slate-300">{currentGuide.shortDescription}</p></div><Link to={currentGuide.route} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Abrir {currentGuide.module}<ArrowRight className="h-4 w-4" /></Link></div><div className="mt-8 grid gap-5 md:grid-cols-2"><section><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">O que você vai aprender</h2><p className="mt-2 text-sm leading-6 text-slate-300">{currentGuide.whyItMatters}</p></section><section><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Antes de começar</h2><p className="mt-2 text-sm leading-6 text-slate-300">{currentGuide.beforeYouStart}</p></section><section><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Passo a passo</h2><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-300">{currentGuide.stepByStep.map((step) => <li key={step}>{step}</li>)}</ol></section><section><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Como funciona</h2><p className="mt-2 text-sm leading-6 text-slate-300">{currentGuide.whenToUse}</p><p className="mt-3 text-xs text-slate-400">{currentGuide.whatHappensNext}</p></section><section><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Dicas</h2><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">{currentGuide.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></section><section><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Evite estes erros</h2><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">{currentGuide.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul></section></div>{currentGuide.videoUrl && <div className="mt-7 rounded-2xl border border-blue-400/30 bg-blue-500/10 p-4"><p className="font-semibold text-white">Treinamento em vídeo</p><a href={currentGuide.videoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-200"><PlayCircle className="h-4 w-4" /> Assistir treinamento</a></div>}<div className="mt-7 rounded-2xl border border-slate-700 bg-slate-950/20 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Este módulo se conecta com</p><p className="mt-2 text-sm text-slate-200">{currentGuide.connections.join(' → ')}</p></div><div className="mt-7 flex flex-wrap justify-between gap-3 border-t border-slate-700 pt-5"><Button type="button" variant="outline" onClick={() => navigate(currentGuide.route)}>Abrir módulo real</Button>{next && <Button type="button" onClick={() => navigate(`/treinamento/${next.id}`)}>Próximo: {next.module}<ArrowRight className="h-4 w-4" /></Button>}</div></article></main>;
  }

  const grouped = GROUPS.map((group) => ({ ...group, guides: [...availableGuides, ...futureGuides].filter((guide) => group.ids.includes(guide.id)) })).filter((group) => group.guides.length);
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10"><header className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-300">Academia F7</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Aprenda a usar o F7 Business</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Treinamentos rápidos para configurar sua empresa e aproveitar melhor cada módulo.</p></div><div className="flex items-center gap-2 text-xs text-slate-400"><BookOpen className="h-4 w-4 text-blue-300" /> Conteúdo determinístico, sempre disponível</div></header>
    <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-3 sm:flex-row sm:items-center"><Search className="ml-2 h-4 w-4 shrink-0 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Como posso ajudar? Ex.: como alterar preço" aria-label="Buscar conteúdo da Academia F7" className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-slate-500" />{query && <button type="button" onClick={() => setQuery('')} className="px-2 text-xs font-semibold text-blue-300">Limpar</button>}</div>
    {query ? <section className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold text-white">Resultados da Academia</h2><span className="text-xs text-slate-400">{searched.length} guia(s)</span></div>{searched.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{searched.map((guide) => <AcademyCard key={guide.id} guide={guide} seen={Boolean(seen[guide.id])} locked={lockedByPlan(guide)} onOpen={openGuide} />)}</div> : <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Não encontrei esse tema nos guias ainda. Tente “preço”, “venda”, “estoque” ou “orçamento”.</div>}</section> : <>
      <section className="mt-8 rounded-3xl border border-blue-400/30 bg-gradient-to-br from-blue-600/20 to-indigo-500/10 p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-200">Continuar aprendendo</p><h2 className="mt-2 text-xl font-semibold text-white">{continueGuide ? continueGuide.title : 'Escolha um treinamento'}</h2><p className="mt-1 text-sm text-slate-300">{continueGuide?.shortDescription || 'Explore os módulos abaixo.'}</p></div>{continueGuide && <Button type="button" onClick={() => openGuide(continueGuide)}>Continuar <ArrowRight className="h-4 w-4" /></Button>}</div><p className="mt-4 text-xs text-blue-100/80">Progresso de treinamento: {Object.keys(seen).filter((id) => TRAINING_GUIDES.some((guide) => guide.id === id)).length} de {TRAINING_GUIDES.length} guias vistos · Configuração da operação é acompanhada separadamente.</p></section>
      <section className="mt-8"><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">Primeiros passos</p><h2 className="mt-2 text-2xl font-semibold text-white">Uma jornada no seu ritmo</h2></div><div className="flex flex-wrap gap-2">{ONBOARDING_JOURNEYS.map((item) => <button key={item.id} type="button" onClick={() => chooseJourney(item.id)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${effectiveJourney === item.id ? 'border-blue-400 bg-blue-500/20 text-blue-100' : 'border-slate-700 text-slate-400 hover:border-blue-400/50'}`}>{item.label}</button>)}</div></div><div className="grid gap-3 md:grid-cols-2">{journeyGuides.slice(0, 6).map((guide, index) => <Link key={guide.id} to={`/treinamento/${guide.id}`} className="flex items-center gap-3 rounded-xl border border-slate-700/70 bg-[#0e1a2b] p-4 transition hover:border-blue-400/60"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-sm font-bold text-blue-200">{seen[guide.id] ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : index + 1}</span><span className="min-w-0"><span className="block text-sm font-semibold text-white">{guide.module}</span><span className="block truncate text-xs text-slate-400">{guide.shortDescription}</span></span><ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-500" /></Link>)}</div></section>
      <section className="mt-10 space-y-8">{grouped.map((group) => <div key={group.id}><div className="mb-4 flex items-center gap-2"><h2 className="text-xs font-bold uppercase tracking-[.2em] text-slate-400">{group.label}</h2><span className="h-px flex-1 bg-slate-800" /></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.guides.map((guide) => <AcademyCard key={guide.id} guide={guide} seen={Boolean(seen[guide.id])} locked={lockedByPlan(guide)} onOpen={openGuide} />)}</div></div>)}</section>
      <section className="mt-10 grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><div className="rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5"><div className="flex items-center gap-2"><Map className="h-4 w-4 text-blue-300" /><h2 className="text-lg font-semibold text-white">Como o F7 se conecta</h2></div><div className="mt-5 grid gap-2 text-center text-xs font-semibold text-slate-200 sm:grid-cols-4"><span className="rounded-lg bg-blue-500/15 p-3">Clientes</span><span className="hidden self-center text-slate-500 sm:block">→</span><span className="rounded-lg bg-blue-500/15 p-3">Orçamentos</span><span className="rounded-lg bg-blue-500/15 p-3">Vendas → Estoque → Financeiro</span></div><p className="mt-4 text-xs text-slate-400">As conexões mostram os fluxos oficiais; a Academia não executa nenhuma operação.</p></div><div className="rounded-2xl border border-slate-700/70 bg-[#0e1a2b] p-5"><div className="flex items-center gap-2"><CircleHelp className="h-4 w-4 text-blue-300" /><h2 className="text-lg font-semibold text-white">Dúvidas frequentes</h2></div><div className="mt-4 space-y-3">{FAQS.map(([question, answer]) => <details key={question} className="rounded-xl border border-slate-700 bg-slate-950/20 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">{question}</summary><p className="mt-2 text-xs leading-5 text-slate-400">{answer}</p></details>)}</div></div></section>
    </>}</main>;
}
