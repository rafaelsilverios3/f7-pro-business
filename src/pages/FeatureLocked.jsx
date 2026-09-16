import React from 'react';
import { Link } from 'react-router-dom';
import { FEATURE_REQUIREMENTS } from '@/services/subscriptionService';

export default function FeatureLocked({ path, state = 'feature_not_entitled', onRetry }) {
  const [plan, feature] = FEATURE_REQUIREMENTS[path] || ['PRO', 'Este recurso'];
  const unavailable = state === 'subscription_unavailable';
  const error = state === 'error';
  const eyebrow = error ? 'Acesso temporariamente indisponível' : unavailable ? 'Plano não confirmado' : 'Recurso indisponível no plano atual';
  const title = error ? 'Não foi possível validar seu acesso' : feature;
  const description = error
    ? 'A assinatura não pôde ser consultada agora. Tente novamente; nenhum recurso protegido foi liberado por fallback.'
    : unavailable
      ? 'A empresa não possui uma assinatura ativa confirmada. Escolha um plano para continuar; o acesso não é liberado sem validação.'
      : 'Conheça este recurso e continue quando sua empresa escolher um plano compatível.';
  return <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-5 py-12"><section className="w-full rounded-3xl border border-slate-700/70 bg-[#0e1a2b] p-8 text-white shadow-xl"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-300">{eyebrow}</p><h1 className="mt-3 text-3xl font-semibold">{title}</h1><p className="mt-4 leading-7 text-slate-300">{description}</p>{!error && (unavailable ? <p className="mt-4 rounded-xl border border-blue-400/30 bg-blue-500/10 p-4 text-sm text-blue-100">Uma assinatura ativa é necessária para validar este acesso.</p> : <p className="mt-4 rounded-xl border border-blue-400/30 bg-blue-500/10 p-4 text-sm text-blue-100">Disponível a partir do plano <strong>{plan}</strong>.</p>)}{error && onRetry && <button type="button" onClick={onRetry} className="mt-5 inline-flex rounded-xl border border-blue-300/40 px-5 py-2.5 text-sm font-semibold text-blue-100 hover:bg-blue-500/10">Tentar novamente</button>}<Link to="/planos" className="mt-6 inline-flex rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-semibold hover:bg-blue-400">Conhecer planos</Link></section></div>;
}
