import React, { useState, useEffect, useMemo } from 'react';
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
import { fmtMoney, fmtMoneyShort, fmtNum } from '@/lib/business';
import { createPeriodContext } from '@/lib/metrics';
import { getDashboardMetrics } from '@/services/metricsService';
import { generateInsights } from '@/lib/intelligence';
import KpiCard from '@/components/dashboard/KpiCard';
import { format } from 'date-fns';
import { Target, GitBranch, Activity, Clock, BrainCircuit } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createRepository } from '@/data/repositoryFactory';
import { ExecutiveChartCard } from '@/components/dashboard/ExecutiveChartCard';

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

export default function Dashboard() {
  const { company } = useOutletContext();
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadDashboard = async () => {
    if (!company) return;
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
    } catch (cause) { setError(cause); }
    finally { setLoading(false); setRefreshing(false); }
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

    // Produtos mais vendidos
    const prodMap = {};
    cur.forEach((s) => (s.items || []).forEach((i) => {
      const key = i.name;
      prodMap[key] = prodMap[key] || { name: key, qty: 0, total: 0 };
      prodMap[key].qty += i.qty || 0;
      prodMap[key].total += i.total || 0;
    }));
    const topProdutos = Object.values(prodMap).sort((a, b) => b.qty - a.qty).slice(0, 5);

    // Top vendedores
    const sellerMap = {};
    cur.forEach((s) => {
      const k = s.seller || 'Sem vendedor';
      sellerMap[k] = (sellerMap[k] || 0) + (s.total || 0);
    });
    const topVendedores = Object.entries(sellerMap).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5);

    const evolucao = shared.charts.revenue.rows;

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
      topProdutos, topVendedores, evolucao,
      goalProgress, funnel, projecao, projectionLabel: projection.label, fluxoCaixa, recentActivity,
      insights: data.insights || [],
      opportunities: data.opportunities || [],
      comparisons: shared.comparisons,
      charts: shared.charts,
      chartErrors,
      partialErrors: data.failures || [],
    };
  }, [data, period, company?.id]);

  if (error) return <div className="mx-auto max-w-xl px-5 py-20 text-center"><h2 className="text-lg font-semibold text-slate-800">Não foi possível carregar o dashboard.</h2><p className="mt-2 text-sm text-slate-500">{error.message}</p><button className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={loadDashboard}>Tentar novamente</button></div>;
  if (!m) return <div className="mx-auto w-full max-w-[1760px] px-5 py-7 xl:px-8 2xl:px-10"><div className="mb-7 h-28 animate-pulse rounded-2xl bg-slate-800/60" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl border border-slate-700/60 bg-slate-800/60" />)}</div></div>;

  const today = format(new Date(), 'dd/MM/yyyy HH:mm');

  return (
    <div className="mx-auto w-full max-w-[1760px] px-5 py-7 xl:px-8 2xl:px-10">
      <div className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">F7 PRO BUSINESS</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Visão Executiva</h1>
          <p className="mt-2 text-sm text-slate-400">{company.name || 'Sua empresa'} · resumo executivo do negócio.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-slate-700/70 bg-[#0d1b2e] px-4 py-2.5 text-right">
            <p className="text-xs font-medium capitalize text-slate-200">{PERIODS.find((item) => item.value === period)?.label || period}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Atualizado {updatedAt ? format(updatedAt, 'dd/MM/yyyy HH:mm') : today}</p>
          </div>
          <div className="flex gap-1 rounded-xl border border-slate-700/70 bg-[#0d1b2e] p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={period === p.value}
                onClick={() => setPeriod(p.value)}
                className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-200 sm:px-3 ${period === p.value ? 'f7-period-active bg-[#1677ff] text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Atualizar métricas" onClick={loadDashboard} disabled={refreshing} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700/70 bg-[#0d1b2e] text-slate-300 hover:text-white disabled:opacity-50">
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

      {/* Gráficos executivos */}
      <div className="mt-6 grid min-w-0 gap-4 xl:grid-cols-2">
        <ExecutiveChartCard title="Evolução do faturamento" description={`${PERIODS.find((item) => item.value === period)?.label || period} · vendas válidas${m.charts.revenue.comparable ? ' · linha tracejada = período anterior' : ''}`} empty={!m.charts.revenue.rows.length} error={m.chartErrors.revenue}>
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

        <ExecutiveChartCard title="Vendas por status" description="Distribuição real do período selecionado" empty={!m.charts.salesStatus.rows.length} error={m.chartErrors.sales}>
          <div className="h-64 min-w-0" role="img" aria-label="Distribuição das vendas por status">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={m.charts.salesStatus.rows} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="status" width={90} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [fmtNum(value), 'Vendas']} /><Bar dataKey="count" fill="#3b82f6" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Vendas por forma de pagamento" description="Somente formas presentes nas vendas válidas" empty={!m.charts.payments.rows.length} emptyMessage="Forma de pagamento não informada nas vendas do período." error={m.chartErrors.sales}>
          <div className="grid h-64 min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]" role="img" aria-label="Vendas por forma de pagamento">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={m.charts.payments.rows} dataKey="value" nameKey="method" innerRadius={52} outerRadius={82} paddingAngle={2} labelLine={false}>{m.charts.payments.rows.map((entry, index) => <Cell key={entry.method} fill={['#3b82f6', '#14b8a6', '#f59e0b', '#8b5cf6', '#f43f5e'][index % 5]} />)}</Pie><Tooltip formatter={(value) => [fmtMoney(value), 'Valor']} /></PieChart></ResponsiveContainer>
            <div className="flex flex-col justify-center gap-2 text-xs text-slate-600">{m.charts.payments.rows.map((row, index) => <div key={row.method} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ['#3b82f6', '#14b8a6', '#f59e0b', '#8b5cf6', '#f43f5e'][index % 5] }} /> <span className="truncate">{row.method}</span></span><span className="shrink-0 font-medium">{row.percent.toFixed(1)}%</span></div>)}</div>
          </div>
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Clientes no período" description="Novos = primeira compra; recorrentes = compra anterior ao período" empty={!m.charts.customers.available} error={m.chartErrors.customers}>
          <div className="h-64 min-w-0" role="img" aria-label="Composição de clientes novos e recorrentes"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: 'Clientes', novos: m.charts.customers.novo, recorrentes: m.charts.customers.recorrente }]}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [fmtNum(value), name === 'novos' ? 'Novos' : 'Recorrentes']} /><Bar dataKey="novos" name="Novos" stackId="clientes" fill="#14b8a6" radius={[6, 6, 0, 0]} /><Bar dataKey="recorrentes" name="Recorrentes" stackId="clientes" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Oportunidades por origem" description="Oportunidades abertas do Opportunity Radar" empty={!m.charts.opportunitiesByOrigin.rows.length} error={m.chartErrors.opportunities}>
          <div className="h-64 min-w-0" role="img" aria-label="Oportunidades abertas agrupadas por origem"><ResponsiveContainer width="100%" height="100%"><BarChart data={m.charts.opportunitiesByOrigin.rows} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="origin" width={100} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [fmtNum(value), 'Oportunidades']} /><Bar dataKey="count" fill="#f59e0b" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Prioridade das oportunidades" description="Somente prioridade/confiança informada na fonte" empty={!m.charts.opportunityPriority.rows.length} emptyMessage="Nenhuma prioridade consistente disponível." error={m.chartErrors.opportunities}>
          <div className="space-y-4 py-3" role="img" aria-label="Distribuição de oportunidades por prioridade">{m.charts.opportunityPriority.rows.map((row) => <div key={row.priority}><div className="mb-1 flex items-center justify-between text-xs text-slate-600"><span>{row.priority}</span><strong>{fmtNum(row.count)}</strong></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${row.priority === 'Alta' ? 'bg-rose-500' : row.priority === 'Média' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, row.count / Math.max(1, m.oportunidadesAbertas) * 100)}%` }} /></div></div>)}</div>
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Saúde do estoque" description="Posição atual · estoque é snapshot, não fluxo temporal" empty={!m.charts.stockHealth.rows.some((row) => row.count > 0)} error={m.chartErrors.stock}>
          <div className="h-64 min-w-0" role="img" aria-label="Saúde atual do estoque"><ResponsiveContainer width="100%" height="100%"><BarChart data={m.charts.stockHealth}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} /><XAxis dataKey="health" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [fmtNum(value), 'Produtos']} /><Bar dataKey="count" fill="#10b981" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </ExecutiveChartCard>
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
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Produtos mais vendidos</h3>
          </div>
          <div className="space-y-3">
            {m.topProdutos.length === 0 && <p className="text-xs text-slate-400">Sem vendas no período.</p>}
            {m.topProdutos.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500">{i + 1}</span>
                <span className="flex-1 truncate text-sm text-slate-700">{p.name}</span>
                <span className="text-xs font-medium text-slate-500">{fmtNum(p.qty)} un</span>
              </div>
            ))}
          </div>
        </div>

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
