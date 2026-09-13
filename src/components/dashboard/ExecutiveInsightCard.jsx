import React from 'react';

export function InsightEmptyState({ message = 'Nenhum dado acionável no período.' }) {
  return <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">{message}</div>;
}

export default function ExecutiveInsightCard({ title, description, children, empty = false, error = false, emptyMessage, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`} aria-label={title}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
      </div>
      {error ? <InsightEmptyState message="Não foi possível carregar este bloco." /> : empty ? <InsightEmptyState message={emptyMessage} /> : children}
    </section>
  );
}
