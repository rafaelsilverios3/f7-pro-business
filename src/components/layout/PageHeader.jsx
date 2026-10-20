// F7 PRO BUSINESS — Cabeçalho de página
import React from 'react';

export default function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-3 border-b border-slate-700/50 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
