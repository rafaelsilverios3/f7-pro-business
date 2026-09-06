import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Trash2, Trophy, Target, TrendingUp } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { fmtMoney, periodKey } from '@/lib/business';
import { getCommissionSummary } from '@/lib/commissions';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SCOPE_LABELS = { company: 'Empresa', team: 'Equipe', seller: 'Vendedor', category: 'Categoria', product: 'Produto' };
const PERIOD_LABELS = { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' };

export default function Metas() {
  const { company } = useOutletContext();
  const [goals, setGoals] = useState(null);
  const [sales, setSales] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    if (!company) return;
    const [g, s, c] = await Promise.all([
      base44.entities.Goal.filter({ company_id: company.id }, '-created_date', 200),
      base44.entities.Sale.filter({ company_id: company.id, status: 'paid' }, '-sale_date', 500),
      getCommissionSummary(company.id),
    ]);
    setGoals(g);
    setSales(s);
    setCommissions(c);
  };
  useEffect(() => { load(); }, [company]);

  const goalProgress = useMemo(() => {
    if (!goals) return [];
    return goals.map((g) => {
      let achieved = 0;
      if (g.scope === 'company') {
        achieved = sales.filter((s) => periodKey(s.sale_date, 'month')).reduce((sum, s) => sum + (s.total || 0), 0);
      } else if (g.scope === 'seller') {
        achieved = sales.filter((s) => s.seller === g.target_key && periodKey(s.sale_date, 'month')).reduce((sum, s) => sum + (s.total || 0), 0);
      }
      const pct = g.target_amount > 0 ? Math.min(100, (achieved / g.target_amount) * 100) : 0;
      return { ...g, achieved, pct };
    });
  }, [goals, sales]);

  const handleDelete = async (g) => {
    if (!confirm('Excluir esta meta?')) return;
    await base44.entities.Goal.delete(g.id);
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
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${g.pct >= 100 ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {g.pct >= 100 ? <Trophy className="h-4 w-4" /> : <Target className="h-4 w-4" />}
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
                  <p className="text-lg font-bold text-slate-900">{fmtMoney(g.achieved)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400">Meta</p>
                  <p className="text-sm font-medium text-slate-500">{fmtMoney(g.target_amount)}</p>
                </div>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${g.pct >= 100 ? 'bg-emerald-500' : g.pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                  style={{ width: `${g.pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-right text-xs font-medium text-slate-600">{g.pct.toFixed(0)}%</p>
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
    await base44.entities.Goal.create({
      company_id: company.id, scope, target_key: targetKey, period, period_value: periodValue,
      target_amount: Number(targetAmount) || 0, active: true,
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