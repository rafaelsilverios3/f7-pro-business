import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  DollarSign, TrendingUp, Wallet, Users, Package, ShoppingCart, AlertTriangle, Trophy, FileText, Zap as ZapIcon,
} from 'lucide-react';
import { salesRepository } from '@/data/repositories/salesRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { customersRepository } from '@/data/repositories/customersRepository';
import { financeRepository } from '@/data/repositories/financeRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { getDataProvider } from '@/data/providerSelector';
import { fmtMoney, fmtMoneyShort, fmtNum, periodKey, periodKeyPrev } from '@/lib/business';
import { generateInsights } from '@/lib/intelligence';
import KpiCard from '@/components/dashboard/KpiCard';
import { subMonths, format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Target, GitBranch, Activity, Clock, BrainCircuit } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const PERIODS = [
  { value: 'day', label: 'Hoje' },
  { value: 'month', label: 'Mês' },
  { value: 'year', label: 'Ano' },
];

export default function Dashboard() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!company) return;
    (async () => {
      setError(null);
      try {
        const isSupabase = import.meta.env.VITE_DATA_PROVIDER === 'supabase';
        const legacy = isSupabase ? [[], [], []] : await Promise.all([
          getDataProvider().entity('Goal').filter({ company_id: company.id, active: true }, '-created_date', 100),
          getDataProvider().entity('Opportunity').filter({ company_id: company.id }, '-created_date', 100),
          generateInsights(company.id, period),
        ]);
        const [sales, products, customers, fin, movements] = await Promise.all([
          salesRepository.list(company.id, '-sale_date', 500),
          productsRepository.list(company.id, '-created_date', 500),
          customersRepository.list(company.id, '-created_date', 500),
          financeRepository.list(company.id, '-due_date', 500),
          inventoryRepository.list(company.id, '-created_date', 10),
        ]);
        setData({ sales, products, customers, fin, goals: legacy[0], opportunities: legacy[1], insights: legacy[2], movements });
      } catch (cause) { setError(cause); setData(null); }
    })();
  }, [company, period]);

  const m = useMemo(() => {
    if (!data) return null;
    const valid = data.sales.filter((s) => s.status !== 'cancelled');
    const cur = valid.filter((s) => periodKey(s.sale_date, period));
    const prev = valid.filter((s) => periodKeyPrev(s.sale_date, period));

    const sumTotal = (arr) => arr.reduce((s, x) => s + (x.total || 0), 0);
    const sumProfit = (arr) => arr.reduce((s, x) => s + (x.profit || 0), 0);

    const faturamento = sumTotal(cur);
    const faturamentoPrev = sumTotal(prev);
    const lucro = sumProfit(cur);
    const lucroPrev = sumProfit(prev);
    const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;
    const margemPrev = faturamentoPrev > 0 ? (lucroPrev / faturamentoPrev) * 100 : 0;
    const numVendas = cur.length;
    const ticketMedio = numVendas > 0 ? faturamento / numVendas : 0;

    const despesas = data.fin
      .filter((f) => f.type === 'payable' && f.status === 'paid' && periodKey(f.paid_date || f.due_date, period))
      .reduce((s, f) => s + (f.amount || 0), 0);

    const contasReceber = data.fin
      .filter((f) => f.type === 'receivable' && f.status !== 'paid' && f.status !== 'cancelled')
      .reduce((s, f) => s + (f.amount || 0), 0);
    const contasPagar = data.fin
      .filter((f) => f.type === 'payable' && f.status !== 'paid' && f.status !== 'cancelled')
      .reduce((s, f) => s + (f.amount || 0), 0);

    const novosClientes = data.customers.filter((c) => periodKey(c.created_date || c.created_at, period)).length;
    const estoqueCritico = data.products.filter((p) => (p.stock || 0) <= (p.min_stock ?? p.minimum_stock ?? 0)).length;

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

    // Evolução 6 meses
    const evolucao = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const start = startOfMonth(d);
      const end = endOfMonth(d);
      const monthSales = valid.filter((s) => {
        if (!s.sale_date) return false;
        try { return isWithinInterval(parseISO(s.sale_date), { start, end }); } catch { return false; }
      });
      evolucao.push({
        mes: format(d, 'MMM', { locale: ptBR }),
        faturamento: monthSales.reduce((s, x) => s + (x.total || 0), 0),
        lucro: monthSales.reduce((s, x) => s + (x.profit || 0), 0),
      });
    }

    const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);

    // Metas
    const goalProgress = (data.goals || []).map((g) => {
      let achieved = 0;
      if (g.scope === 'company') achieved = faturamento;
      else if (g.scope === 'seller') achieved = sellerMap[g.target_key] || 0;
      return { ...g, achieved, pct: g.target_amount > 0 ? Math.min(100, (achieved / g.target_amount) * 100) : 0 };
    });

    // Funil CRM
    const funnel = {
      leads: data.customers.filter((c) => c.status === 'lead').length,
      ativos: data.customers.filter((c) => c.status === 'active').length,
      oportunidades: (data.opportunities || []).filter((o) => !['won', 'lost'].includes(o.stage)).length,
      vendas: cur.length,
    };

    // Projeção de faturamento
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projecao = dayOfMonth > 0 ? (faturamento / dayOfMonth) * daysInMonth : 0;

    // Fluxo de caixa projetado (receber - pagar)
    const fluxoCaixa = contasReceber - contasPagar;

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
      ticketMedio, numVendas, novosClientes, estoqueCritico,
      topProdutos, topVendedores, evolucao,
      goalProgress, funnel, projecao, fluxoCaixa, recentActivity,
      insights: data.insights || [],
      opportunities: data.opportunities || [],
      trends: {
        faturamento: pct(faturamento, faturamentoPrev),
        lucro: pct(lucro, lucroPrev),
        margem: margem - margemPrev,
      },
    };
  }, [data, period]);

  if (error) return <div className="mx-auto max-w-xl px-5 py-20 text-center"><h2 className="text-lg font-semibold text-slate-800">Não foi possível carregar o dashboard.</h2><p className="mt-2 text-sm text-slate-500">{error.message}</p><button className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => window.location.reload()}>Tentar novamente</button></div>;
  if (!m) return <div className="flex h-96 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" /></div>;

  const displayName = user?.full_name || user?.name || user?.email || 'usuário';
  const firstName = displayName.trim().split(/\s+/)[0];
  const today = format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="mx-auto w-full max-w-[1760px] px-5 py-7 xl:px-8 2xl:px-10">
      <div className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">F7 PRO BUSINESS</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Olá, {firstName}! <span aria-hidden="true">👋</span></h1>
          <p className="mt-2 text-sm text-slate-400">Aqui está o resumo do seu negócio em tempo real.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-slate-700/70 bg-[#0d1b2e] px-4 py-2.5 text-right">
            <p className="text-xs font-medium capitalize text-slate-200">{today}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Dados atualizados agora</p>
          </div>
          <div className="flex gap-1 rounded-xl border border-slate-700/70 bg-[#0d1b2e] p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors duration-200 ${period === p.value ? 'bg-[#1677ff] text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard primary label="Faturamento" value={fmtMoney(m.faturamento)} icon={DollarSign} trend={m.trends.faturamento} accent="bg-blue-500/15 text-blue-300" sparklineData={m.evolucao} sparklineKey="faturamento" sparklineColor="#3aa0ff" />
        <KpiCard primary label="Lucro" value={fmtMoney(m.lucro)} icon={TrendingUp} trend={m.trends.lucro} accent="bg-emerald-500/15 text-emerald-300" sparklineData={m.evolucao} sparklineKey="lucro" sparklineColor="#20d49a" />
        <KpiCard primary label="Margem" value={`${m.margem.toFixed(1)}%`} icon={TrendingUp} trend={m.trends.margem} accent="bg-violet-500/15 text-violet-300" sub="margem líquida" sparklineData={m.evolucao} sparklineKey="lucro" sparklineColor="#9b70ff" />
        <KpiCard primary label="Despesas" value={fmtMoney(m.despesas)} icon={Wallet} accent="bg-rose-500/15 text-rose-300" sparklineData={m.evolucao} sparklineKey="faturamento" sparklineColor="#ff647c" />
        <KpiCard label="Contas a Receber" value={fmtMoney(m.contasReceber)} icon={Wallet} accent="bg-amber-500/15 text-amber-300" />
        <KpiCard label="Contas a Pagar" value={fmtMoney(m.contasPagar)} icon={Wallet} accent="bg-orange-500/15 text-orange-300" />
        <KpiCard label="Ticket Médio" value={fmtMoney(m.ticketMedio)} icon={ShoppingCart} accent="bg-blue-500/15 text-blue-300" sub={`${m.numVendas} vendas`} />
        <KpiCard label="Novos Clientes" value={fmtNum(m.novosClientes)} icon={Users} accent="bg-teal-500/15 text-teal-300" />
      </div>

      {/* Charts row */}
      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900">Evolução de Faturamento</h3>
          <p className="mb-4 text-xs text-slate-400">Últimos 6 meses</p>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={m.evolucao}>
              <defs>
                <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtMoneyShort(v)} />
              <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Area type="monotone" dataKey="faturamento" stroke="#6366f1" strokeWidth={2.5} fill="url(#gFat)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Lucro por Mês</h3>
          <p className="mb-4 text-xs text-slate-400">Evolução do resultado</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={m.evolucao}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtMoneyShort(v)} />
              <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="lucro" fill="#10b981" radius={[6, 6, 0, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        </div>

        <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-[#10213a] to-[#0b1626] p-5 shadow-[0_12px_32px_rgba(0,0,0,.15)]">
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
              <span className="text-sm font-semibold text-amber-700">{fmtMoneyShort(m.contasReceber)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-orange-50 px-3 py-2.5">
              <span className="text-sm text-orange-700">Contas a pagar</span>
              <span className="text-sm font-semibold text-orange-700">{fmtMoneyShort(m.contasPagar)}</span>
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
              <p className="text-xs text-indigo-500">Projeção de fechamento do mês</p>
              <p className="mt-1 text-lg font-bold text-indigo-700">{fmtMoney(m.projecao)}</p>
              <p className="text-[10px] text-indigo-400">Baseado no ritmo atual de {fmtMoney(m.faturamento)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Fluxo de caixa projetado</p>
              <p className={`mt-1 text-lg font-bold ${m.fluxoCaixa >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {m.fluxoCaixa >= 0 ? '+' : ''}{fmtMoney(m.fluxoCaixa)}
              </p>
              <p className="text-[10px] text-slate-400">A receber ({fmtMoneyShort(m.contasReceber)}) - A pagar ({fmtMoneyShort(m.contasPagar)})</p>
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
