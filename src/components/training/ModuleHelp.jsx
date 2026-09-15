import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleHelp, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getTrainingGuide, getNextTrainingGuide } from '@/content/training/trainingContent';

function Section({ title, children }) {
  return <section className="border-b border-slate-200/80 pb-4 last:border-0 last:pb-0"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">{title}</h3>{children}</section>;
}

export default function ModuleHelp({ moduleId, route, compact = false }) {
  const guide = getTrainingGuide(moduleId || route);
  const next = guide ? getNextTrainingGuide(guide.id) : null;
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!guide) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-400 hover:text-blue-700 ${compact ? '' : 'mt-1'}`} aria-label={`Como funciona esta tela: ${guide.module}`}>
      <CircleHelp className="h-3.5 w-3.5 text-blue-600" /> Como funciona esta tela?
    </button>
    {open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="module-help-title" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">Guia rápido</p><h2 id="module-help-title" className="mt-1 text-lg font-bold text-slate-900">{guide.title}</h2><p className="mt-1 text-sm text-slate-600">{guide.shortDescription}</p></div><button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Fechar ajuda" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X className="h-4 w-4" /></button></div>
        <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 text-sm text-slate-700">
          <Section title="Sobre este módulo"><p>{guide.whyItMatters}</p></Section>
          <Section title="Para que serve"><p>{guide.whenToUse}</p></Section>
          <Section title="Como começar"><p>{guide.beforeYouStart}</p><div className="mt-3 flex flex-wrap gap-2">{guide.mainActions.map((action) => <span key={action} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">{action}</span>)}</div></Section>
          <Section title="Passo a passo"><ol className="list-decimal space-y-1.5 pl-5">{guide.stepByStep.map((step) => <li key={step}>{step}</li>)}</ol></Section>
          <Section title="O que acontece depois"><p>{guide.whatHappensNext}</p><p className="mt-2 text-xs text-slate-500"><span className="font-semibold">Conexões reais:</span> {guide.connections.join(' · ')}</p></Section>
          <Section title="Dicas e erros comuns"><div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-1 font-semibold text-slate-800">Dicas</p><ul className="list-disc space-y-1 pl-4">{guide.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div><div><p className="mb-1 font-semibold text-slate-800">Evite</p><ul className="list-disc space-y-1 pl-4">{guide.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul></div></div></Section>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">Este guia é educativo e separado da conclusão operacional do onboarding. Apenas salvar registros reais conclui tarefas operacionais.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3"><button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-600 hover:text-slate-900">Continuar depois</button>{next && <button type="button" onClick={() => { setOpen(false); navigate(next.route); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">Próximo: {next.module}<ArrowRight className="h-3.5 w-3.5" /></button>}</div>
      </div>
    </div>}
  </>;
}
