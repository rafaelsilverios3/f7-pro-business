// F7 PRO BUSINESS — Card de KPI
import React from 'react';
import { cn } from '@/lib/utils';
import { ResponsiveContainer, LineChart, Line } from 'recharts';

export default function KpiCard({ label, value, sub, icon: Icon, trend, comparison, accent, primary = false, snapshot = false, status, sparklineData, sparklineKey, sparklineColor = '#3aa0ff' }) {
  const trendValue = typeof trend === 'number' ? trend : comparison?.delta_percent;
  const trendUp = trendValue > 0;
  const trendDown = trendValue < 0;
  const comparisonText = comparison?.state === 'new'
    ? 'novo no período'
    : comparison?.state === 'unavailable'
      ? 'comparativo indisponível'
      : Number.isFinite(comparison?.delta_percent)
        ? `${trendUp ? '↑' : trendDown ? '↓' : '—'} ${Math.abs(comparison.delta_percent).toFixed(1)}% vs período anterior`
        : null;
  return (
    <div className={cn('f7-kpi-card group relative overflow-hidden rounded-2xl border border-slate-700/70 bg-[var(--surface)] p-5 shadow-[0_8px_24px_rgba(0,0,0,.12)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-500', primary && 'min-h-[168px] lg:p-6')} data-kpi-status={status || (snapshot ? 'snapshot' : 'period')}>
      <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-10 blur-2xl" style={{ background: sparklineColor }} />
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-semibold uppercase tracking-wide text-slate-300', primary && 'text-sm')}>{label}</span>
        {Icon && (
          <span className={cn('relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/10', accent || 'bg-slate-800 text-slate-300')}>
            <Icon className={cn('h-4 w-4', primary && 'h-5 w-5')} />
          </span>
        )}
      </div>
      <p className={cn('relative mt-4 text-2xl font-bold tracking-tight text-white', primary && 'text-3xl')}>{value}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {(comparisonText || (trend !== undefined && trend !== null)) && (
          <span className={cn('text-xs font-semibold', trendUp ? 'text-emerald-400' : trendDown ? 'text-rose-400' : 'text-slate-400')} aria-label={comparisonText || 'Variação percentual'}>
            {comparisonText || `${trendUp ? '↑' : trendDown ? '↓' : '—'} ${Math.abs(trend || 0).toFixed(1)}%`}
          </span>
        )}
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
      {primary && sparklineData?.length > 1 && sparklineKey && (
        <div className="pointer-events-none absolute bottom-3 right-4 h-12 w-28 opacity-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData}>
              <Line type="monotone" dataKey={sparklineKey} stroke={sparklineColor} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
