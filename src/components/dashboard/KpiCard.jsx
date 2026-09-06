// F7 PRO BUSINESS — Card de KPI
import React from 'react';
import { cn } from '@/lib/utils';

export default function KpiCard({ label, value, sub, icon: Icon, trend, accent }) {
  const trendUp = trend && trend > 0;
  const trendDown = trend && trend < 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {Icon && (
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accent || 'bg-slate-100 text-slate-500')}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {trend !== undefined && trend !== null && (
          <span className={cn('text-xs font-semibold', trendUp ? 'text-emerald-600' : trendDown ? 'text-rose-600' : 'text-slate-400')}>
            {trendUp ? '↑' : trendDown ? '↓' : '—'} {Math.abs(trend || 0).toFixed(1)}%
          </span>
        )}
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
    </div>
  );
}