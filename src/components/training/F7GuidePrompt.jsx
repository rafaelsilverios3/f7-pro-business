import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Lightweight placeholder for the future F7 visual guide. It intentionally
 * contains no avatar, automation or operational write: the next step remains
 * a normal navigation action chosen by the user.
 */
export default function F7GuidePrompt({ message = 'Olá! Quer que eu te mostre como começar no F7?', to = '/onboarding', label = 'Ver primeiros passos' }) {
  return <aside aria-label="Guia F7" className="rounded-2xl border border-blue-400/25 bg-blue-500/10 p-4">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">Guia F7</p><p className="mt-1 text-xs leading-5 text-blue-100/80">{message}</p><Link to={to} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500">{label}<ArrowRight className="h-3.5 w-3.5" /></Link></div>
    </div>
  </aside>;
}
