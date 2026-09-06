import { base44 } from '@/api/base44Client';
import { fmtMoney, fmtMoneyShort, periodKey, periodKeyPrev } from '@/lib/business';

export async function generateInsights(companyId, period = 'month') {
  const [sales, products, customers, financials, goals] = await Promise.all([
    base44.entities.Sale.filter({ company_id: companyId }, '-sale_date', 500),
    base44.entities.Product.filter({ company_id: companyId }, '-name', 500),
    base44.entities.Customer.filter({ company_id: companyId }, '-created_date', 500),
    base44.entities.FinancialEntry.filter({ company_id: companyId }, '-due_date', 500),
    base44.entities.Goal.filter({ company_id: companyId, active: true }, '-created_date', 100),
  ]);

  const validSales = sales.filter((s) => s.status !== 'cancelled');
  const current = validSales.filter((s) => periodKey(s.sale_date, period));
  const previous = validSales.filter((s) => periodKeyPrev(s.sale_date, period));

  const curRev = current.reduce((s, x) => s + (x.total || 0), 0);
  const prevRev = previous.reduce((s, x) => s + (x.total || 0), 0);
  const curProfit = current.reduce((s, x) => s + (x.profit || 0), 0);
  const prevProfit = previous.reduce((s, x) => s + (x.profit || 0), 0);
  const curMargin = curRev > 0 ? (curProfit / curRev) * 100 : 0;
  const prevMargin = prevRev > 0 ? (prevProfit / prevRev) * 100 : 0;

  const insights = [];
  const pct = (cur, prev) => prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;

  if (prevRev > 0 && curRev < prevRev * 0.85) {
    insights.push({
      title: 'Queda de faturamento',
      description: `O faturamento caiu ${Math.abs(pct(curRev, prevRev)).toFixed(1)}% em relação ao período anterior.`,
      type: 'decline', priority: 'high', indicator: 'Faturamento',
      period_label: period === 'month' ? 'Mês atual vs anterior' : period === 'year' ? 'Ano atual vs anterior' : 'Hoje vs ontem',
      current_value: curRev, previous_value: prevRev, variation_pct: pct(curRev, prevRev),
      impact: `R$ ${(prevRev - curRev).toFixed(2)} de receita perdida`,
      suggested_action: 'Investigar causas: sazonalidade, perda de clientes, ou queda no ticket médio.',
    });
  }
  if (prevRev > 0 && curRev > prevRev * 1.15) {
    insights.push({
      title: 'Crescimento de faturamento',
      description: `O faturamento cresceu ${pct(curRev, prevRev).toFixed(1)}% em relação ao período anterior.`,
      type: 'growth', priority: 'medium', indicator: 'Faturamento',
      period_label: period === 'month' ? 'Mês atual vs anterior' : period === 'year' ? 'Ano atual vs anterior' : 'Hoje vs ontem',
      current_value: curRev, previous_value: prevRev, variation_pct: pct(curRev, prevRev),
      impact: `R$ ${(curRev - prevRev).toFixed(2)} de receita adicional`,
      suggested_action: 'Capitalizar: reforçar estratégias que estão funcionando e garantir estoque.',
    });
  }
  if (curRev > 0 && curMargin < prevMargin - 3) {
    insights.push({
      title: 'Queda de margem',
      description: `A margem caiu de ${prevMargin.toFixed(1)}% para ${curMargin.toFixed(1)}%.`,
      type: 'margin', priority: 'high', indicator: 'Margem',
      period_label: 'Período atual vs anterior',
      current_value: curMargin, previous_value: prevMargin, variation_pct: pct(curMargin, prevMargin),
      impact: `${(prevMargin - curMargin).toFixed(1)} pontos percentuais`,
      suggested_action: 'Revisar custos e precificação. Verificar descontos excessivos.',
    });
  }

  const productSales = {};
  for (const s of [...current, ...previous]) {
    for (const item of (s.items || [])) {
      const key = item.product_id || item.name;
      if (!productSales[key]) productSales[key] = { name: item.name, cur: 0, prev: 0 };
      if (periodKey(s.sale_date, period)) productSales[key].cur += item.qty || 0;
      if (periodKeyPrev(s.sale_date, period)) productSales[key].prev += item.qty || 0;
    }
  }
  for (const [key, val] of Object.entries(productSales)) {
    if (val.prev > 0 && val.cur > val.prev * 1.3) {
      insights.push({
        title: `Produto em alta: ${val.name}`,
        description: `Vendas de ${val.name} cresceram ${pct(val.cur, val.prev).toFixed(0)}%.`,
        type: 'growth', priority: 'medium', indicator: 'Produto',
        period_label: 'Período atual vs anterior',
        current_value: val.cur, previous_value: val.prev, variation_pct: pct(val.cur, val.prev),
        impact: `${val.cur - val.prev} unidades adicionais vendidas`,
        suggested_action: 'Garantir estoque e considerar destaque no catálogo.',
      });
    }
    if (val.prev > 2 && val.cur === 0) {
      insights.push({
        title: `Produto sem giro: ${val.name}`,
        description: `${val.name} vendeu ${val.prev} unidades no período anterior e nenhuma no atual.`,
        type: 'decline', priority: 'medium', indicator: 'Produto',
        period_label: 'Período atual vs anterior',
        current_value: 0, previous_value: val.prev, variation_pct: -100,
        impact: 'Nenhuma venda no período',
        suggested_action: 'Avaliar descontinuação, promoção ou reposicionamento.',
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const p of products) {
    if ((p.stock || 0) <= 0 && p.active) {
      insights.push({
        title: `Ruptura de estoque: ${p.name}`,
        description: `${p.name} está sem estoque (0 ${p.unit || 'un'}).`,
        type: 'stock', priority: 'high', indicator: 'Estoque',
        period_label: 'Hoje',
        current_value: 0, previous_value: p.min_stock || 0, variation_pct: -100,
        impact: 'Vendas perdidas por indisponibilidade',
        suggested_action: 'Repor estoque urgentemente ou criar pedido de compra.',
      });
    } else if ((p.stock || 0) <= (p.min_stock || 0) && p.active) {
      insights.push({
        title: `Estoque crítico: ${p.name}`,
        description: `${p.name} tem ${p.stock} ${p.unit || 'un'} (mínimo: ${p.min_stock}).`,
        type: 'stock', priority: 'high', indicator: 'Estoque',
        period_label: 'Hoje',
        current_value: p.stock, previous_value: p.min_stock, variation_pct: -((p.min_stock - p.stock) / (p.min_stock || 1)) * 100,
        impact: 'Risco de ruptura iminente',
        suggested_action: 'Repor estoque antes que acabe.',
      });
    }
  }

  const inactiveCustomers = customers.filter((c) => {
    if (c.status === 'inactive') return false;
    if (!c.last_purchase_date) return c.status === 'active';
    const days = (new Date(today) - new Date(c.last_purchase_date)) / (1000 * 60 * 60 * 24);
    return days > 90 && c.status === 'active';
  });
  if (inactiveCustomers.length > 0) {
    insights.push({
      title: `${inactiveCustomers.length} cliente(s) inativo(s)`,
      description: `${inactiveCustomers.length} cliente(s) ativo(s) sem compra há mais de 90 dias.`,
      type: 'customer', priority: 'medium', indicator: 'Clientes',
      period_label: '90 dias',
      current_value: inactiveCustomers.length, previous_value: 0, variation_pct: 0,
      impact: 'Risco de perda de clientes',
      suggested_action: 'Criar campanha de reativação ou follow-up automatizado.',
    });
  }

  const overdueBills = financials.filter((f) => f.status === 'pending' && f.type === 'payable' && f.due_date && f.due_date < today);
  if (overdueBills.length > 0) {
    insights.push({
      title: `${overdueBills.length} conta(s) vencida(s)`,
      description: `Total de ${fmtMoney(overdueBills.reduce((s, f) => s + (f.amount || 0), 0))} em contas a pagar vencidas.`,
      type: 'financial', priority: 'high', indicator: 'Financeiro',
      period_label: 'Hoje',
      current_value: overdueBills.length, previous_value: 0, variation_pct: 0,
      impact: fmtMoney(overdueBills.reduce((s, f) => s + (f.amount || 0), 0)),
      suggested_action: 'Regularizar pagamentos para evitar juros e multas.',
    });
  }

  const sellerRevenue = {};
  for (const s of current) {
    if (!s.seller) continue;
    sellerRevenue[s.seller] = (sellerRevenue[s.seller] || 0) + (s.total || 0);
  }
  for (const g of goals) {
    if (g.scope !== 'seller' && g.scope !== 'company') continue;
    const achieved = g.scope === 'company'
      ? curRev
      : sellerRevenue[g.target_key] || 0;
    if (achieved >= g.target_amount && g.target_amount > 0) {
      insights.push({
        title: `Meta atingida: ${g.scope === 'company' ? 'Empresa' : g.target_key}`,
        description: `${g.scope === 'company' ? 'A empresa' : g.target_key} atingiu a meta de ${fmtMoney(g.target_amount)}.`,
        type: 'goal', priority: 'medium', indicator: 'Meta',
        period_label: g.period_value || 'Período',
        current_value: achieved, previous_value: g.target_amount, variation_pct: ((achieved - g.target_amount) / g.target_amount) * 100,
        impact: fmtMoney(achieved - g.target_amount) + ' acima da meta',
        suggested_action: 'Reconhecer o responsável e ajustar a próxima meta.',
      });
    } else if (g.target_amount > 0 && achieved < g.target_amount * 0.5) {
      insights.push({
        title: `Meta distante: ${g.scope === 'company' ? 'Empresa' : g.target_key}`,
        description: `Atingido ${fmtMoney(achieved)} de ${fmtMoney(g.target_amount)} (${((achieved / g.target_amount) * 100).toFixed(0)}%).`,
        type: 'goal', priority: 'high', indicator: 'Meta',
        period_label: g.period_value || 'Período',
        current_value: achieved, previous_value: g.target_amount, variation_pct: ((achieved - g.target_amount) / g.target_amount) * 100,
        impact: fmtMoney(g.target_amount - achieved) + ' para atingir a meta',
        suggested_action: 'Revisar estratégia comercial e acelerar vendas.',
      });
    }
  }

  const sellerTotals = Object.entries(sellerRevenue).sort((a, b) => b[1] - a[1]);
  if (sellerTotals.length > 0) {
    const top = sellerTotals[0];
    const rest = sellerTotals.slice(1).reduce((s, [, v]) => s + v, 0);
    if (top[1] > 0 && rest > 0 && top[1] / (top[1] + rest) > 0.5) {
      insights.push({
        title: `Concentração de faturamento: ${top[0]}`,
        description: `${top[0]} representa ${((top[1] / (top[1] + rest)) * 100).toFixed(0)}% do faturamento.`,
        type: 'concentration', priority: 'medium', indicator: 'Concentração',
        period_label: 'Período atual',
        current_value: top[1], previous_value: top[1] + rest, variation_pct: 0,
        impact: 'Risco de dependência de um vendedor',
        suggested_action: 'Distribuir esforços e treinar a equipe.',
      });
    }
  }

  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const projection = curRev / dayOfMonth * daysInMonth;
  if (curRev > 0) {
    insights.push({
      title: 'Projeção de fechamento do mês',
      description: `Com base no ritmo atual, o mês deve fechar em ${fmtMoney(projection)}.`,
      type: 'projection', priority: 'low', indicator: 'Projeção',
      period_label: 'Mês atual',
      current_value: projection, previous_value: curRev, variation_pct: dayOfMonth > 0 ? ((projection - curRev) / curRev) * 100 : 0,
      impact: fmtMoney(projection - curRev) + ' projetado até o fim do mês',
      suggested_action: 'Acelerar vendas para superar a projeção.',
    });
  }

  return insights.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] - order[b.priority]);
  });
}

export const INSIGHT_TYPE_LABELS = {
  growth: 'Crescimento',
  decline: 'Queda',
  margin: 'Margem',
  stock: 'Estoque',
  customer: 'Clientes',
  financial: 'Financeiro',
  concentration: 'Concentração',
  goal: 'Meta',
  projection: 'Projeção',
};

export const INSIGHT_PRIORITY_COLORS = {
  high: 'bg-rose-100 text-rose-700 border-rose-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-blue-100 text-blue-700 border-blue-200',
};