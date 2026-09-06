// F7 PRO BUSINESS — Financeiro
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Check, Trash2, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { financeService } from '@/services/financeService';
import { fmtMoney, fmtDate, todayISO } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TABS = [
  { value: 'receivable', label: 'Contas a Receber', icon: TrendingUp },
  { value: 'payable', label: 'Contas a Pagar', icon: TrendingDown },
];

const CATEGORIES = ['Vendas', 'Fornecedores', 'Aluguel', 'Salários', 'Impostos', 'Marketing', 'Outros'];

export default function Financeiro() {
  const { company } = useOutletContext();
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState('receivable');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ description: '', category: 'Outros', amount: 0, due_date: todayISO(), payment_method: 'Pix', account: 'Caixa' });

  const load = async () => {
    if (!company) return;
    setItems(await financeService.list(company.id));
  };
  useEffect(() => { load(); }, [company]);

  const filtered = useMemo(() => (items || []).filter((i) => i.type === tab), [items, tab]);

  const stats = useMemo(() => {
    if (!items) return { receivable: 0, payable: 0, paid: 0 };
    return {
      receivable: items.filter((i) => i.type === 'receivable' && i.status !== 'cancelled').reduce((s, i) => s + (i.status === 'paid' ? 0 : i.amount || 0), 0),
      payable: items.filter((i) => i.type === 'payable' && i.status !== 'cancelled').reduce((s, i) => s + (i.status === 'paid' ? 0 : i.amount || 0), 0),
      paid: items.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0),
    };
  }, [items]);

  const handleAdd = async (e) => {
    e.preventDefault();
    await financeService.create(company.id, {
      ...form, type: tab, company_id: company.id, amount: Number(form.amount) || 0, status: 'pending',
    });
    setForm({ description: '', category: 'Outros', amount: 0, due_date: todayISO(), payment_method: 'Pix', account: 'Caixa' });
    setDialogOpen(false);
    load();
  };

  const markPaid = async (entry) => {
    await financeService.settle(company.id, entry);
    load();
  };
  const handleDelete = async (id) => { await financeService.remove(company.id, id); load(); };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Financeiro"
        subtitle="Contas a pagar, receber e fluxo de caixa."
        action={<Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo lançamento</Button>}
      />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" /><p className="text-xs text-slate-500">A receber</p></div>
          <p className="mt-1 text-xl font-semibold text-emerald-600">{fmtMoney(stats.receivable)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-rose-500" /><p className="text-xs text-slate-500">A pagar</p></div>
          <p className="mt-1 text-xl font-semibold text-rose-600">{fmtMoney(stats.payable)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-slate-500" /><p className="text-xs text-slate-500">Realizado</p></div>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.paid)}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab === t.value ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center"><p className="text-sm font-medium text-slate-700">Nenhum lançamento</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">{e.description}</td>
                    <td className="px-4 py-3 text-slate-500">{e.category || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(e.due_date)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${e.type === 'receivable' ? 'text-emerald-600' : 'text-rose-600'}`}>{e.type === 'receivable' ? '+' : '-'} {fmtMoney(e.amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${e.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : e.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>
                        {e.status === 'paid' ? 'Pago' : e.status === 'cancelled' ? 'Cancelado' : 'Pendente'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {e.status !== 'paid' && e.status !== 'cancelled' && (
                          <button onClick={() => markPaid(e)} className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Marcar como pago"><Check className="h-4 w-4" /></button>
                        )}
                        <button onClick={() => handleDelete(e.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo lançamento — {tab === 'receivable' ? 'Conta a receber' : 'Conta a pagar'}</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição *</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor (R$)</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Vencimento</Label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Forma de pagamento</Label>
                <Input value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">Adicionar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
