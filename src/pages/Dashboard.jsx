import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
  ResponsiveContainer,
} from 'recharts';
import {
  DollarSign, TrendingUp, Wallet, Users, Package, ShoppingCart, AlertTriangle, Trophy, FileText, Zap as ZapIcon, RefreshCw,
} from 'lucide-react';
import { salesRepository } from '@/data/repositories/salesRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { customersRepository } from '@/data/repositories/customersRepository';
import { financeRepository } from '@/data/repositories/financeRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { getDataProvider } from '@/data/providerSelector';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { fmtMoney, fmtMoneyShort, fmtNum } from '@/lib/business';
import { createPeriodContext } from '@/lib/metrics';
import { getDashboardMetrics } from '@/services/metricsService';
import { generateInsights } from '@/lib/intelligence';
import KpiCard from '@/components/dashboard/KpiCard';
import { format } from 'date-fns';
import { Target, GitBranch, Activity, Clock, BrainCircuit } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createRepository } from '@/data/repositoryFactory';
import { ExecutiveChartCard } from '@/components/dashboard/ExecutiveChartCard';
import ExecutiveInsightCard from '@/components/dashboard/ExecutiveInsightCard';
import ExecutiveIntelligenceSummary from '@/components/dashboard/ExecutiveIntelligenceSummary';
import { buildExecutiveIntelligenceContext, generateExecutiveSummary } from '@/services/executiveIntelligenceService';

const radarOpportunityRepository = createRepository('ProductOpportunity');

const PERIODS = [
  { value: 'day', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Mês' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Ano' },
  { value: 'all', label: 'Tudo' },
];

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"><p className="font-semibold text-slate-800">{label}</p><p className="mt-1 text-slate-600">Faturamento: {fmtMoney(row.faturamento)}</p><p className="text-slate-600">Vendas: {fmtNum(row.vendas)}</p><p className="text-slate-600">Ticket médio: {fmtMoney(row.ticket_medio)}</p>{row.faturamento_anterior != null && <p className="text-slate-400">Anterior: {fmtMoney(row.faturamento_anterior)}</p>}</div>;
}

const formatInsightDate = (value, fallback = 'Data indisponível') => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : format(parsed, 'dd/MM/yyyy');
};

function OpportunityBadge({ opportunity }) {
  if (!opportunity) return null;
  return <Link to="/opportunity-radar" className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100">Oportunidade aberta</Link>;
}

function EntityLink({ type, id, label }) {
  if (!id) return null;
  const to = type === 'customer' ? '/clientes' : type === 'product' ? '/produtos' : '/opportunity-radar';
  return <Link to={to} className="shrink-0 text-[11px] font-semibold text-indigo-600 hover:underline">{label}</Link>;
}

export default function Dashboard() {
  const { company, profileName } = useOutletContext();
  const { user } = useAuth();
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [executiveSummary, setExecutiveSummary] = useState(null);
  const [executiveSummaryLoading, setExecutiveSummaryLoading] = useState(false);
  const [executiveSummaryRefresh, setExecutiveSummaryRefresh] = useState(0);
  const [intelligenceRpcGate, setIntelligenceRpcGate] = useState(null);
  const executiveSummaryRequest = useRef('');
  const dashboardRequest = useRef(0);

  const loadDashboard = async () => {
    if (!company) return;
    const requestId = ++dashboardRequest.current;
    setLoading((current) => !data || current);
    setRefreshing(Boolean(data));
    setError(null);
    try {
      const isSupabase = import.meta.env.VITE_DATA_PROVIDER === 'supabase';
      const legacyPromise = isSupabase ? Promise.resolve([[], [], []]) : Promise.all([
        getDataProvider().entity('Goal').filter({ company_id: company.id, active: true }, '-created_date', 100),
        getDataProvider().entity('Opportunity').filter({ company_id: company.id }, '-created_date', 100),
        generateInsights(company.id, period),
      ]);
      const results = await Promise.allSettled([
        legacyPromise,
        salesRepository.list(company.id, '-sale_date', 500),
        productsRepository.list(company.id, '-created_date', 500),
        customersRepository.list(company.id, '-created_date', 500),
        financeRepository.list(company.id, '-due_date', 500),
        inventoryRepository.list(company.id, '-created_date', 10),
        isSupabase ? radarOpportunityRepository.list(company.id, '-created_date', 500) : Promise.resolve([]),
      ]);
      if (requestId !== dashboardRequest.current) return;
      const value = (index, fallback) => results[index].status === 'fulfilled' ? results[index].value : fallback;
      const legacy = value(0, [[], [], []]);
      const radar = value(6, []);
      const failures = results.map((result, index) => result.status === 'rejected' ? { index, message: result.reason?.message || 'Não foi possível carregar este bloco.' } : null).filter(Boolean);
      setData({
        sales: value(1, []),
        products: value(2, []),
        customers: value(3, []),
        fin: value(4, []),
        goals: legacy[0] || [],
        opportunities: isSupabase ? radar : (legacy[1] || []),
        insights: legacy[2] || [],
        movements: value(5, []),
        failures,
      });
      setUpdatedAt(new Date());
      if (failures.length === results.length) setError(new Error('Não foi possível carregar as métricas do dashboard.'));
    } catch { if (requestId === dashboardRequest.current) setError(new Error('Não foi possível carregar o dashboard.')); }
    finally { if (requestId === dashboardRequest.current) { setLoading(false); setRefreshing(false); } }
  };

  useEffect(() => {
    if (company) loadDashboard();
  }, [company, period]);

  const m = useMemo(() => {
    if (!data) return null;
    const periodContext = createPeriodContext({ companyId: company.id, periodKey: period });
    const shared = getDashboardMetrics(company.id, data, periodContext);
    const cur = shared.sales.rows;

    const faturamento = shared.sales.revenue;
    const lucro = shared.sales.profit;
    const margem = shared.sales.margin;
    const numVendas = cur.length;
    const ticketMedio = shared.sales.average_ticket;

    const despesas = shared.finance.expenses;
    const contasReceber = shared.finance.receivable;
    const contasPagar = shared.finance.payable;

    const novosClientes = shared.customers.created;
    const estoqueCritico = shared.products.critical;
    const clientesAtivos = shared.customers.active;
    const oportunidadesAbertas = shared.opportunities.open;

    // Top vendedores
    const sellerMap = {};
    cur.forEach((s) => {
      const k = s.seller || 'Sem vendedor';
      sellerMap[k] = (sellerMap[k] || 0) + (s.total || 0);
    });
    const topVendedores = Object.entries(sellerMap).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5);

    const evolucao = shared.charts.revenue.rows;
    const actionable = shared.actionable;

    // Metas
    const goalProgress = (data.goals || []).map((g) => {
      let achieved = 0;
      if (g.scope === 'company') achieved = faturamento;
      else if (g.scope === 'seller') achieved = sellerMap[g.target_key] || 0;
      return { ...g, achieved, pct: g.target_amount > 0 ? Math.min(100, (achieved / g.target_amount) * 100) : 0 };
    });

    // Funil CRM
    const funnel = shared.funnel;

    // Projeção de faturamento
    const projection = shared.projection;
    const projecao = projection.value;

    const failed = (index) => (data.failures || []).some((item) => item.index === index);
    const chartErrors = {
      revenue: failed(1),
      sales: failed(1),
      customers: failed(1),
      opportunities: failed(6) || failed(0),
      stock: failed(2),
    };

    // Fluxo de caixa projetado (receber - pagar)
    const fluxoCaixa = shared.finance.projected_net;

    // Atividades recentes
    const recentActivity = (data.movements || []).slice(0, 8).map((mv) => ({
      type: mv.type === 'in' ? 'Entrada' : mv.type === 'out' ? 'Saída' : 'Ajuste',
      product: mv.product_name,
      qty: mv.quantity,
      reason: mv.reason,
      date: mv.created_date || mv.created_at,
    }));

    return {
      faturamento, lucro, margem, despesas, contasReceber, contasPagar,
      ticketMedio, numVendas, novosClientes, clientesTotal: shared.customers.total, estoqueCritico, clientesAtivos, oportunidadesAbertas,
      financeAvailable: shared.finance.available,
      topVendedores, evolucao,
      goalProgress, funnel, projecao, projectionLabel: projection.label, fluxoCaixa, recentActivity,
      insights: data.insights || [],
      opportunities: data.opportunities || [],
      actionable,
      comparisons: shared.comparisons,
      charts: shared.charts,
      chartErrors,
      partialErrors: data.failures || [],
    };
  }, [data, period, company?.id]);

  const executiveContext = useMemo(() => {
    if (!m || !company?.id) return null;
    return buildExecutiveIntelligenceContext(company.id, m, createPeriodContext({ companyId: company.id, periodKey: period }));
  }, [m, company?.id, period]);

  useEffect(() => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id) { setIntelligenceRpcGate(true); return undefined; }
    let cancelled = false;
    setIntelligenceRpcGate(null);
    getSupabaseClient().rpc('company_has_feature', { target_company: company.id, feature: 'intelligence' }).then(({ data }) => {
      if (!cancelled) setIntelligenceRpcGate(data === true);
    }).catch(() => { if (!cancelled) setIntelligenceRpcGate(false); });
    return () => { cancelled = true; };
  }, [company?.id]);
  const intelligenceEnabled = import.meta.env.VITE_DATA_PROVIDER !== 'supabase'
    ? true
    : intelligenceRpcGate === true;
  useEffect(() => {
    if (!executiveContext || !company?.id || !intelligenceEnabled) { setExecutiveSummary(null); return undefined; }
    if (refreshing) return undefined;
    const key = `${company.id}:${period}:${updatedAt?.getTime() || 'initial'}:${executiveSummaryRefresh}`;
    if (executiveSummaryRequest.current === key) return undefined;
    executiveSummaryRequest.current = key;
    let cancelled = false;
    setExecutiveSummaryLoading(true);
    generateExecutiveSummary(company.id, executiveContext).then((result) => { if (!cancelled) setExecutiveSummary({ ...result, period: executiveContext.period }); }).finally(() => { if (!cancelled) setExecutiveSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [executiveContext, company?.id, period, updatedAt, executiveSummaryRefresh, intelligenceEnabled, refreshing]);

  if (error) return <div className="mx-auto max-w-xl px-5 py-20 text-center"><h2 className="text-lg font-semibold text-slate-800">Não foi possível carregar o dashboard.</h2><p className="mt-2 text-sm text-slate-500">Tente novamente em instantes.</p><button className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={loadDashboard}>Tentar novamente</button></div>;
  if (!m) return <div data-dashboard-loading className="mx-auto w-full max-w-[1760px] px-3 py-5 sm:px-5 sm:py-7 xl:px-8 2xl:px-10"><div className="mb-5 h-24 animate-pulse rounded-2xl bg-slate-800/60 sm:mb-7 sm:h-28" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl border border-slate-700/60 bg-slate-800/60 sm:h-44" />)}</div><div className="mt-5 h-56 animate-pulse rounded-2xl border border-indigo-200/20 bg-indigo-950/30" /></div>;

  const rawDisplayName = profileName || user?.full_name || user?.name || user?.user_metadata?.full_name || user?.user_metadata?.name || 'seu perfil';
  const displayName = rawDisplayName.includes('@') ? 'seu perfil' : rawDisplayName;
  const firstName = displayName.trim().split(/\s+/)[0] || 'usuário';
  const today = format(new Date(), 'dd/MM/yyyy HH:mm');

  return (
    <div className="mx-auto w-full max-w-[1760px] min-w-0 px-3 py-5 sm:px-5 sm:py-7 xl:px-8 2xl:px-10">
      <div className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">F7 PRO BUSINESS</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Olá, {firstName}! <span aria-hidden="true">👋</span></h1>
          <p className="mt-2 break-words text-sm text-slate-400">Aqui está o resumo do seu negócio em tempo real.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <div className="min-w-0 rounded-xl border border-slate-700/70 bg-[#0d1b2e] px-3 py-2.5 text-left sm:px-4 sm:text-right">
            <p className="text-xs font-medium capitalize text-slate-200">{PERIODS.find((item) => item.value === period)?.label || period}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Atualizado {updatedAt ? format(updatedAt, 'dd/MM/yyyy HH:mm') : today}</p>
          </div>
          <div role="group" aria-label="Período do dashboard" className="order-last flex max-w-full min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-700/70 bg-[#0d1b2e] p-1 sm:order-none">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={period === p.value}
                onClick={() => setPeriod(p.value)}
                className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-200 sm:px-3 ${period === p.value ? 'f7-period-active bg-[#1677ff] text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Atualizar métricas" onClick={loadDashboard} disabled={refreshing} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/70 bg-[#0d1b2e] text-slate-300 hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {m.partialErrors.length > 0 && <div role="status" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">Alguns indicadores estão indisponíveis no momento; os demais continuam calculados com os dados autorizados.</div>}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard primary label="Faturamento" value={fmtMoney(m.faturamento)} icon={DollarSign} comparison={m.comparisons.revenue} accent="bg-blue-500/15 text-blue-300" sparklineData={m.evolucao} sparklineKey="faturamento" sparklineColor="#3aa0ff" />
        <KpiCard primary label="Vendas" value={fmtNum(m.numVendas)} icon={ShoppingCart} comparison={m.comparisons.sales} accent="bg-cyan-500/15 text-cyan-300" sub="vendas válidas no período" />
        <KpiCard primary label="Ticket médio" value={fmtMoney(m.ticketMedio)} icon={ShoppingCart} comparison={m.comparisons.ticket} accent="bg-indigo-500/15 text-indigo-300" sub="faturamento / vendas" />
        <KpiCard primary label="Margem das vendas" value={`${Number(m.margem || 0).toFixed(1)}%`} icon={TrendingUp} comparison={m.comparisons.margin} accent="bg-violet-500/15 text-violet-300" sub="lucro das vendas / faturamento" sparklineData={m.evolucao} sparklineKey="lucro" sparklineColor="#9b70ff" />
        <KpiCard label="Clientes ativos" value={fmtNum(m.clientesAtivos)} icon={Users} comparison={m.comparisons.customers} accent="bg-teal-500/15 text-teal-300" sub={`${fmtNum(m.clientesTotal)} cadastrados`} />
        <Link to="/estoque" className="block"><KpiCard label="Estoque baixo" value={fmtNum(m.estoqueCritico)} icon={Package} snapshot accent="bg-rose-500/15 text-rose-300" sub="posição atual · ver estoque" /></Link>
        <KpiCard label="Oportunidades abertas" value={fmtNum(m.oportunidadesAbertas)} icon={Target} snapshot accent="bg-amber-500/15 text-amber-300" sub="Opportunity Radar" />
        <KpiCard label="Projeção líquida de compromissos" value={m.financeAvailable ? fmtMoney(m.fluxoCaixa) : 'Indisponível'} icon={Wallet} snapshot accent="bg-orange-500/15 text-orange-300" sub={m.financeAvailable ? `A receber ${fmtMoneyShort(m.contasReceber)} · a pagar ${fmtMoneyShort(m.contasPagar)}` : 'dados financeiros indisponíveis'} />
      </div>

      <ExecutiveIntelligenceSummary summary={executiveSummary} loading={executiveSummaryLoading} locked={!intelligenceEnabled} onRefresh={() => { executiveSummaryRequest.current = ''; setExecutiveSummaryRefresh((value) => value + 1); }} />

      {/* Gráficos executivos */}
      <div className="mt-6 grid min-w-0 gap-4 xl:grid-cols-12">
        <ExecutiveChartCard className="xl:col-span-8" title="Evolução do faturamento" description={`${PERIODS.find((item) => item.value === period)?.label || period} · vendas válidas${m.charts.revenue.comparable ? ' · linha tracejada = período anterior' : ''}`} empty={!m.charts.revenue.rows.length} error={m.chartErrors.revenue}>
          <div className="h-64 min-w-0" role="img" aria-label="Evolução do faturamento atual e período anterior">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.charts.revenue.rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={fmtMoneyShort} />
                <Tooltip content={<RevenueTooltip />} />
                <Area type="monotone" dataKey="faturamento" name="Faturamento" stroke="#6366f1" strokeWidth={2.5} fill="url(#gFat)" isAnimationActive={false} />
                {m.charts.revenue.comparable && <Area type="monotone" dataKey="faturamento_anterior" name="Período anterior" stroke="#94a3b8" strokeDasharray="5 5" fill="none" isAnimationActive={false} connectNulls />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ExecutiveChartCard>

        <ExecutiveChartCard className="xl:col-span-4" title="Vendas por status" description="Distribuição real do período selecionado" empty={!m.charts.salesStatus.rows.length} error={m.chartErrors.sales}>
          <div className="h-64 min-w-0" role="img" aria-label="Distribuição das vendas por status">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={m.charts.salesStatus.rows} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="status" width={90} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [fmtNum(value), 'Vendas']} /><Bar dataKey="count" fill="#3b82f6" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </ExecutiveChartCard>

        <ExecutiveChartCard className="xl:col-span-4" title="Vendas por forma de pagamento" description="Somente formas presentes nas vendas válidas" empty={!m.charts.payments.rows.length} emptyMessage="Forma de pagamento não informada nas vendas do período." error={m.chartErrors.sales}>
          <div className="grid h-64 min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]" role="img" aria-label="Vendas por forma de pagamento">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={m.charts.payments.rows} dataKey="value" nameKey="method" innerRadius={52} outerRadius={82} paddingAngle={2} labelLine={false}>{m.charts.payments.rows.map((entry, index) => <Cell key={entry.method} fill={['#3b82f6', '#14b8a6', '#f59e0b', '#8b5cf6', '#f43f5e'][index % 5]} />)}</Pie><Tooltip formatter={(value) => [fmtMoney(value), 'Valor']} /></PieChart></ResponsiveContainer>
            <div className="flex flex-col justify-center gap-2 text-xs text-slate-600">{m.charts.payments.rows.map((row, index) => <div key={row.method} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ['#3b82f6', '#14b8a6', '#f59e0b', '#8b5cf6', '#f43f5e'][index % 5] }} /> <span className="truncate">{row.method}</span></span><span className="shrink-0 font-medium">{row.percent.toFixed(1)}%</span></div>)}</div>
          </div>
        </ExecutiveChartCard>

        <ExecutiveChartCard className="xl:col-span-4" title="Clientes no período" description="Novos = primeira compra; recorrentes = compra anterior ao período" empty={!m.charts.customers.available} error={m.chartErrors.customers}>
          <div className="h-64 min-w-0" role="img" aria-label="Composição de clientes novos e recorrentes"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: 'Clientes', novos: m.charts.customers.novo, recorrentes: m.charts.customers.recorrente }]}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [fmtNum(value), name === 'novos' ? 'Novos' : 'Recorrentes']} /><Bar dataKey="novos" name="Novos" stackId="clientes" fill="#14b8a6" radius={[6, 6, 0, 0]} /><Bar dataKey="recorrentes" name="Recorrentes" stackId="clientes" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </ExecutiveChartCard>

        <ExecutiveChartCard className="xl:col-span-4" title="Oportunidades por origem" description="Oportunidades abertas do Opportunity Radar" empty={!m.charts.opportunitiesByOrigin.rows.length} error={m.chartErrors.opportunities}>
          <div className="h-64 min-w-0" role="img" aria-label="Oportunidades abertas agrupadas por origem"><ResponsiveContainer width="100%" height="100%"><BarChart data={m.charts.opportunitiesByOrigin.rows} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="origin" width={100} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [fmtNum(value), 'Oportunidades']} /><Bar dataKey="count" fill="#f59e0b" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>
        </ExecutiveChartCard>

        <ExecutiveChartCard className="xl:col-span-4" title="Prioridade das oportunidades" description="Somente prioridade/confiança informada na fonte" empty={!m.charts.opportunityPriority.rows.length} emptyMessage="Nenhuma prioridade consistente disponível." error={m.chartErrors.opportunities}>
          <div className="space-y-4 py-3" role="img" aria-label="Distribuição de oportunidades por prioridade">{m.charts.opportunityPriority.rows.map((row) => <div key={row.priority}><div className="mb-1 flex items-center justify-between text-xs text-slate-600"><span>{row.priority}</span><strong>{fmtNum(row.count)}</strong></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${row.priority === 'Alta' ? 'bg-rose-500' : row.priority === 'Média' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, row.count / Math.max(1, m.oportunidadesAbertas) * 100)}%` }} /></div></div>)}</div>
        </ExecutiveChartCard>

        <ExecutiveChartCard className="xl:col-span-4" title="Saúde do estoque" description="Posição atual · estoque é snapshot, não fluxo temporal" empty={!m.charts.stockHealth.rows.some((row) => row.count > 0)} error={m.chartErrors.stock}>
          <div className="h-64 min-w-0" role="img" aria-label="Saúde atual do estoque"><ResponsiveContainer width="100%" height="100%"><BarChart data={m.charts.stockHealth}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} /><XAxis dataKey="health" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [fmtNum(value), 'Produtos']} /><Bar dataKey="count" fill="#10b981" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </ExecutiveChartCard>
      </div>

      {/* Análises acionáveis */}
      <div className="mt-6 grid min-w-0 gap-4 xl:grid-cols-3" data-executive-actionable>
        <ExecutiveInsightCard title="Clientes que mais compram" description="Top 5 por faturamento no período selecionado" empty={!m.actionable.topCustomers.available} emptyMessage="Nenhuma compra identificada no período.">
          <div className="space-y-2">{m.actionable.topCustomers.rows.map((row, index) => <div key={row.customer_id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-xs font-semibold text-indigo-700">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">{fmtNum(row.purchases)} compra(s) · ticket {fmtMoney(row.average_ticket)}</p></div><div className="text-right"><p className="text-sm font-bold text-slate-800">{fmtMoney(row.revenue)}</p><EntityLink type="customer" id={row.customer_id} label="Ver cliente" /></div><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Clientes em queda" description="Comparação determinística com o período anterior equivalente" empty={!m.actionable.decliningCustomers.available} emptyMessage="Nenhum cliente com queda relevante no período.">
          <div className="space-y-2">{m.actionable.decliningCustomers.rows.map((row) => <div key={row.customer_id} className="flex min-w-0 items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/40 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">Anterior {fmtMoney(row.previous_revenue)} · atual {fmtMoney(row.current_revenue)}</p></div><div className="text-right"><p className="text-sm font-bold text-rose-600">{Number.isFinite(row.variation_percent) ? `${row.variation_percent.toFixed(1)}%` : 'Comparativo indisponível'}</p><EntityLink type="customer" id={row.customer_id} label="Ver cliente" /></div><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Clientes sem comprar" description="Regra operacional alinhada ao Radar: pelo menos 90 dias sem compra" empty={!m.actionable.inactiveCustomers.available} emptyMessage="Nenhum cliente sem comprar há 90 dias ou mais.">
          <div className="space-y-2">{m.actionable.inactiveCustomers.rows.map((row) => <div key={row.customer_id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">Última compra: {formatInsightDate(row.last_purchase, 'Nunca registrada')} · última movimentação: {formatInsightDate(row.last_activity)}</p></div><div className="text-right"><p className="text-sm font-bold text-amber-600">{fmtNum(row.inactive_days)} dias</p><EntityLink type="customer" id={row.customer_id} label="Ver cliente" /></div><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Produtos mais vendidos" description="Top 5 por faturamento; participação calculada sobre vendas válidas" empty={!m.actionable.topProducts.available} emptyMessage="Nenhum produto vendido no período.">
          <div className="space-y-2">{m.actionable.topProducts.rows.map((row, index) => <div key={`${row.product_id || row.name}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-xs font-semibold text-emerald-700">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">{fmtNum(row.quantity)} un · {fmtMoney(row.revenue)} · {row.share.toFixed(1)}% do faturamento</p></div><EntityLink type="product" id={row.product_id} label="Ver produto" /><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Produtos sem giro" description="Estoque positivo e nenhuma venda na janela do período" empty={!m.actionable.noTurnoverProducts.available} emptyMessage="Nenhum produto sem giro na janela analisada.">
          <div className="space-y-2">{m.actionable.noTurnoverProducts.rows.map((row) => <div key={row.product_id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">Estoque atual: {fmtNum(row.stock)} · última venda: {formatInsightDate(row.last_sale, 'Nunca registrada')}</p></div><EntityLink type="product" id={row.product_id} label="Ver produto" /><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Estoque crítico" description="Prioridade: zerado, abaixo do mínimo e maior venda recente" empty={!m.actionable.criticalStock.available} emptyMessage="Nenhum item com estoque crítico.">
          <div className="space-y-2">{m.actionable.criticalStock.rows.map((row) => <div key={row.product_id} className="flex min-w-0 items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/40 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">Atual {fmtNum(row.stock)} · mínimo {fmtNum(row.minimum_stock)} · vendas recentes {fmtNum(row.recent_quantity)} un</p></div><span className="shrink-0 rounded-full bg-rose-100 px-2 py-1 text-[10px] font-semibold text-rose-700">{row.status}</span><EntityLink type="product" id={row.product_id} label="Ver estoque" /><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Demanda + estoque baixo" description="Regra objetiva: estoque ≤ mínimo e pelo menos 2 unidades vendidas no período" empty={!m.actionable.demandLowStock.available} emptyMessage="Nenhuma demanda recente com estoque baixo.">
          <div className="space-y-2">{m.actionable.demandLowStock.rows.map((row) => <div key={row.product_id} className="flex min-w-0 items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.name}</p><p className="text-[11px] text-slate-500">{fmtNum(row.recent_quantity)} un vendidas · estoque {fmtNum(row.stock)} / mínimo {fmtNum(row.minimum_stock)}</p></div><EntityLink type="product" id={row.product_id} label="Ver produto" /><OpportunityBadge opportunity={row.opportunity} /></div>)}</div>
        </ExecutiveInsightCard>

        <ExecutiveInsightCard title="Oportunidades prioritárias" description="ProductOpportunity/Opportunity Radar: somente estados ativos e snooze vencido" empty={!m.actionable.priorityOpportunities.available} emptyMessage="Nenhuma oportunidade ativa prioritária.">
          <div className="space-y-2">{m.actionable.priorityOpportunities.rows.map((row) => <div key={row.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-indigo-100 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{row.title}</p><p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{row.summary}</p><p className="mt-1 text-[10px] text-slate-400">Origem: {row.origin} · {formatInsightDate(row.date)}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">{row.priority}</span>{row.score !== null && <span className="text-[10px] text-slate-500">Score {fmtNum(row.score)}</span>}<Link to="/opportunity-radar" className="text-[11px] font-semibold text-indigo-600 hover:underline">Abrir oportunidade</Link></div></div>)}</div>
        </ExecutiveInsightCard>
      </div>

        <div className="f7-quick-actions mt-6 rounded-2xl border border-slate-700/60 bg-gradient-to-br from-[#10213a] to-[#0b1626] p-5 shadow-[0_12px_32px_rgba(0,0,0,.15)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-400">Atalhos</p>
              <h3 className="mt-1 text-base font-semibold text-white">Ações rápidas</h3>
            </div>
            <ZapIcon className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="space-y-2">
            {[
              { label: 'Novo cliente', to: '/clientes', icon: Users, tone: 'text-cyan-300 bg-cyan-400/10' },
              { label: 'Novo produto', to: '/produtos', icon: Package, tone: 'text-emerald-300 bg-emerald-400/10' },
              { label: 'Nova venda', to: '/vendas', icon: ShoppingCart, tone: 'text-blue-300 bg-blue-400/10' },
              { label: 'Novo orçamento', to: '/orcamentos', icon: FileText, tone: 'text-violet-300 bg-violet-400/10' },
              { label: 'Registrar despesa', to: '/financeiro', icon: Wallet, tone: 'text-rose-300 bg-rose-400/10' },
            ].map(({ label, to, icon: ActionIcon, tone }) => (
              <Link key={to} to={to} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[.03] px-3 py-3 text-sm font-medium text-slate-200 transition duration-200 hover:border-blue-400/40 hover:bg-blue-400/10 hover:text-white">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><ActionIcon className="h-4 w-4" /></span>
                <span className="flex-1">{label}</span><span className="text-slate-500">→</span>
              </Link>
            ))}
          </div>
        </div>

      {/* Bottom row */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Ranking de vendedores</h3>
          </div>
          <div className="space-y-3">
            {m.topVendedores.length === 0 && <p className="text-xs text-slate-400">Sem vendas no período.</p>}
            {m.topVendedores.map((v, i) => (
              <div key={v.name} className="flex items-center gap-3">
                <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${i === 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                <span className="flex-1 truncate text-sm text-slate-700">{v.name}</span>
                <span className="text-xs font-semibold text-slate-700">{fmtMoney(v.total)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Alertas</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2.5">
              <span className="text-sm text-rose-700">Estoque crítico</span>
              <span className="text-sm font-semibold text-rose-700">{m.estoqueCritico}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2.5">
              <span className="text-sm text-amber-700">Contas a receber</span>
              <span className="text-sm font-semibold text-amber-700">{m.financeAvailable ? fmtMoneyShort(m.contasReceber) : 'Indisponível'}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-orange-50 px-3 py-2.5">
              <span className="text-sm text-orange-700">Contas a pagar</span>
              <span className="text-sm font-semibold text-orange-700">{m.financeAvailable ? fmtMoneyShort(m.contasPagar) : 'Indisponível'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metas + Funil CRM + Projeção */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Metas */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Metas</h3>
            <Link to="/metas" className="ml-auto text-xs text-indigo-600 hover:underline">Ver tudo</Link>
          </div>
          <div className="space-y-3">
            {m.goalProgress.length === 0 && <p className="text-xs text-slate-400">Nenhuma meta ativa.</p>}
            {m.goalProgress.slice(0, 4).map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{g.scope === 'company' ? 'Empresa' : g.target_key}</span>
                  <span className="font-medium text-slate-700">{g.pct.toFixed(0)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${g.pct >= 100 ? 'bg-emerald-500' : g.pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`} style={{ width: `${g.pct}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                  <span>{fmtMoneyShort(g.achieved)}</span>
                  <span>{fmtMoneyShort(g.target_amount)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Funil CRM */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Funil CRM</h3>
          </div>
          <div className="space-y-2.5">
            {[
              { label: 'Leads', value: m.funnel.leads, color: 'bg-slate-400', w: 'w-full' },
              { label: 'Clientes ativos', value: m.funnel.ativos, color: 'bg-blue-500', w: 'w-4/5' },
              { label: 'Oportunidades', value: m.funnel.oportunidades, color: 'bg-amber-500', w: 'w-3/5' },
              { label: 'Vendas (período)', value: m.funnel.vendas, color: 'bg-emerald-500', w: 'w-2/5' },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="w-28 text-xs text-slate-600">{f.label}</span>
                <div className="flex-1">
                  <div className={`h-6 ${f.w} ${f.color} rounded-md flex items-center justify-end px-2`}>
                    <span className="text-xs font-semibold text-white">{f.value}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Projeção + Fluxo de caixa */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Projeção e Fluxo de Caixa</h3>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg bg-indigo-50 p-3">
              <p className="text-xs text-indigo-500">{m.projectionLabel}</p>
              <p className="mt-1 text-lg font-bold text-indigo-700">{fmtMoney(m.projecao)}</p>
              <p className="text-[10px] text-indigo-400">Baseado no ritmo atual de {fmtMoney(m.faturamento)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Projeção líquida de compromissos</p>
              <p className={`mt-1 text-lg font-bold ${!m.financeAvailable ? 'text-slate-500' : m.fluxoCaixa >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {m.financeAvailable ? `${m.fluxoCaixa >= 0 ? '+' : ''}${fmtMoney(m.fluxoCaixa)}` : 'Indisponível'}
              </p>
              <p className="text-[10px] text-slate-400">{m.financeAvailable ? `A receber (${fmtMoneyShort(m.contasReceber)}) - A pagar (${fmtMoneyShort(m.contasPagar)}); não representa caixa realizado.` : 'Dados financeiros indisponíveis para este tenant.'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Oportunidades Intelligence + Atividades recentes */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-slate-900">Insights da F7 Intelligence</h3>
            <Link to="/intelligence" className="ml-auto text-xs text-indigo-600 hover:underline">Ver tudo</Link>
          </div>
          <div className="space-y-2.5">
            {m.insights.length === 0 && <p className="text-xs text-slate-400">Nenhum insight no período. Sistema saudável.</p>}
            {m.insights.slice(0, 5).map((ins, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-slate-100 p-2.5">
                <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${ins.priority === 'high' ? 'bg-rose-500' : ins.priority === 'medium' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                <div className="flex-1">
                  <p className="text-xs font-medium text-slate-800">{ins.title}</p>
                  <p className="text-[10px] text-slate-400">{ins.suggested_action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Atividades recentes</h3>
          </div>
          <div className="space-y-2.5">
            {m.recentActivity.length === 0 && <p className="text-xs text-slate-400">Sem movimentações recentes.</p>}
            {m.recentActivity.map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 text-xs">
                <div className={`flex h-6 w-6 items-center justify-center rounded-md ${a.type === 'Entrada' ? 'bg-emerald-100 text-emerald-600' : a.type === 'Saída' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                  <Clock className="h-3 w-3" />
                </div>
                <div className="flex-1">
                  <span className="text-slate-700">{a.product}</span>
                  <span className="text-slate-400"> · {a.reason}</span>
                </div>
                <span className={`font-medium ${a.type === 'Entrada' ? 'text-emerald-600' : a.type === 'Saída' ? 'text-rose-600' : 'text-slate-500'}`}>
                  {a.type === 'Saída' ? '-' : a.type === 'Entrada' ? '+' : ''}{a.qty}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
