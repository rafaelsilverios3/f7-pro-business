import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Trash2, Trophy, Target, TrendingUp } from 'lucide-react';
import { fmtMoney } from '@/lib/business';
import { createPeriodContext, matchesPeriod } from '@/lib/metrics';
import { getCommissionSummary } from '@/lib/commissions';
import { commissionsService } from '@/services/commissionsService';
import { goalsService } from '@/services/goalsService';
import { salesRepository } from '@/data/repositories/salesRepository';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SCOPE_LABELS = { company: 'Empresa', team: 'Equipe', seller: 'Vendedor', category: 'Categoria', product: 'Produto' };
const PERIOD_LABELS = { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' };

function goalPeriodContext(companyId, goal) {
  const value = String(goal.period_value || '').trim();
  if (goal.period === 'yearly' && /^\d{4}$/.test(value)) return createPeriodContext({ companyId, periodKey: 'custom', startDate: `${value}-01-01`, endDate: `${value}-12-31` });
  if (goal.period === 'quarterly') {
    const match = value.match(/^(\d{4})-Q([1-4])$/);
    if (match) {
      const year = Number(match[1]); const first = (Number(match[2]) - 1) * 3 + 1;
      const endMonth = first + 2; const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
      return createPeriodContext({ companyId, periodKey: 'custom', startDate: `${year}-${String(first).padStart(2, '0')}-01`, endDate: `${year}-${String(endMonth).padStart(2, '0')}-${lastDay}` });
    }
  }
  if (goal.period === 'monthly' && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number); const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return createPeriodContext({ companyId, periodKey: 'custom', startDate: `${value}-01`, endDate: `${value}-${String(lastDay).padStart(2, '0')}` });
  }
  return createPeriodContext({ companyId, periodKey: goal.period === 'yearly' ? 'year' : goal.period === 'quarterly' ? 'quarter' : 'month' });
}

export default function Metas() {
  const { company } = useOutletContext();
  const [goals, setGoals] = useState(null);
  const [sales, setSales] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    if (!company) return;
    const [g, s, c] = await Promise.all([
      goalsService.list(company.id),
      salesRepository.list(company.id, '-sale_date', 500),
      import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? commissionsService.summary(company.id) : getCommissionSummary(company.id),
    ]);
    setGoals(g);
    setSales(s);
    setCommissions(c);
  };
  useEffect(() => { load(); }, [company]);

  const goalProgress = useMemo(() => {
    if (!goals) return [];
    return goals.map((g) => {
      const periodContext = goalPeriodContext(company.id, g);
      const periodSales = sales.filter((s) => s.status !== 'cancelled' && matchesPeriod(s.sale_date || s.created_at, periodContext));
      let achieved = 0;
      let available = true;
      if (g.scope === 'company') achieved = periodSales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
      else if (g.scope === 'seller') achieved = periodSales.filter((s) => s.seller === g.target_key).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
      else if (g.scope === 'category') achieved = periodSales.reduce((sum, s) => sum + (s.items || []).filter((item) => item.category === g.target_key).reduce((itemSum, item) => itemSum + (Number(item.total) || 0), 0), 0);
      else if (g.scope === 'product') achieved = periodSales.reduce((sum, s) => sum + (s.items || []).filter((item) => item.product_id === g.target_key || item.name === g.target_key).reduce((itemSum, item) => itemSum + (Number(item.total) || 0), 0), 0);
      else available = false;
      const pct = available && g.target_amount > 0 ? Math.min(100, (achieved / g.target_amount) * 100) : null;
      return { ...g, achieved, pct, available };
    });
  }, [goals, sales]);

  const handleDelete = async (g) => {
    if (!confirm('Excluir esta meta?')) return;
    await goalsService.remove(company.id, g.id);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Metas e Comissões"
        subtitle="Defina metas, acompanhe atingimento e calcule comissões automaticamente."
        action={<Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova meta</Button>}
      />

      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Metas do período</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {!goals ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Carregando...</div>
          ) : goalProgress.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm font-medium text-slate-700">Nenhuma meta cadastrada</p>
              <p className="mt-1 text-xs text-slate-400">Crie metas para acompanhar o desempenho.</p>
            </div>
          ) : goalProgress.map((g) => (
            <div key={g.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${g.available && g.pct >= 100 ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {g.available && g.pct >= 100 ? <Trophy className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{SCOPE_LABELS[g.scope]}{g.target_key && g.target_key !== 'all' ? `: ${g.target_key}` : ''}</p>
                    <p className="text-[10px] text-slate-400">{PERIOD_LABELS[g.period]} · {g.period_value || 'Atual'}</p>
                  </div>
                </div>
                <button onClick={() => handleDelete(g)} className="rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <p className="text-[10px] text-slate-400">Atingido</p>
                <p className="text-lg font-bold text-slate-900">{g.available ? fmtMoney(g.achieved) : 'Indisponível'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400">Meta</p>
                  <p className="text-sm font-medium text-slate-500">{fmtMoney(g.target_amount)}</p>
                </div>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${g.pct >= 100 ? 'bg-emerald-500' : g.pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                  style={{ width: `${g.available ? g.pct : 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-right text-xs font-medium text-slate-600">{g.available ? `${g.pct.toFixed(0)}%` : 'Cálculo indisponível para este escopo'}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <TrendingUp className="h-4 w-4 text-slate-400" /> Comissões por vendedor
        </h3>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {commissions.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-slate-700">Nenhuma comissão registrada</p>
              <p className="mt-1 text-xs text-slate-400">As comissões são calculadas automaticamente ao concluir vendas com produtos que tenham comissão configurada.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Vendedor</th>
                    <th className="px-4 py-3 text-right font-medium">A pagar</th>
                    <th className="px-4 py-3 text-right font-medium">Pago</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.seller} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-800">{c.seller}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{fmtMoney(c.pending)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{fmtMoney(c.paid)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmtMoney(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <GoalDialog open={dialogOpen} onClose={() => setDialogOpen(false)} company={company} onDone={load} />
    </div>
  );
}

function GoalDialog({ open, onClose, company, onDone }) {
  const [scope, setScope] = useState('company');
  const [targetKey, setTargetKey] = useState('all');
  const [period, setPeriod] = useState('monthly');
  const [periodValue, setPeriodValue] = useState(new Date().toISOString().slice(0, 7));
  const [targetAmount, setTargetAmount] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    await goalsService.create(company.id, {
      company_id: company.id, scope, target_key: targetKey, period, period_value: periodValue,
      target_amount: Number(targetAmount) || 0, type: scope, target_value: Number(targetAmount) || 0, status: 'active',
    });
    setTargetAmount(0);
    onDone?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova meta</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Escopo</Label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
              <option value="company">Empresa inteira</option>
              <option value="seller">Vendedor específico</option>
              <option value="team">Equipe</option>
              <option value="category">Categoria</option>
              <option value="product">Produto</option>
            </select>
          </div>
          {scope === 'seller' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do vendedor</Label>
              <Input value={targetKey === 'all' ? '' : targetKey} onChange={(e) => setTargetKey(e.target.value)} placeholder="Ex: Pedro" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Período</Label>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                <option value="monthly">Mensal</option>
                <option value="quarterly">Trimestral</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Referência</Label>
              <Input value={periodValue} onChange={(e) => setPeriodValue(e.target.value)} placeholder="Ex: 2026-09" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Valor da meta (R$)</Label>
            <Input type="number" step="0.01" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Criar meta</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
