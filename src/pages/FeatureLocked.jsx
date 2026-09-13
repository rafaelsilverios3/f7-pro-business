import React from 'react';
import { Link } from 'react-router-dom';
import { FEATURE_REQUIREMENTS } from '@/services/subscriptionService';

export default function FeatureLocked({ path }) {
  const [plan, feature] = FEATURE_REQUIREMENTS[path] || ['PRO', 'Este recurso'];
  return <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-5 py-12"><section className="w-full rounded-3xl border border-slate-700/70 bg-[#0e1a2b] p-8 text-white shadow-xl"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-300">Recurso indisponível no teste atual</p><h1 className="mt-3 text-3xl font-semibold">{feature}</h1><p className="mt-4 leading-7 text-slate-300">Conheça este recurso e continue quando sua empresa escolher um plano compatível.</p><p className="mt-4 rounded-xl border border-blue-400/30 bg-blue-500/10 p-4 text-sm text-blue-100">Disponível a partir do plano <strong>{plan}</strong>.</p><Link to="/planos" className="mt-6 inline-flex rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-semibold hover:bg-blue-400">Conhecer planos</Link></section></div>;
}
