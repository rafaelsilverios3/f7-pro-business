// F7 PRO BUSINESS — Vendas
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Eye, Ban } from 'lucide-react';
import { salesRepository } from '@/data/repositories/salesRepository';
import { fmtMoney, fmtDate } from '@/lib/business';
import { isRevenueSale, saleItemTotal } from '@/lib/saleStatus';
import { salesService } from '@/services/salesService';
import PageHeader from '@/components/layout/PageHeader';
import SaleDialog from '@/components/vendas/SaleDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-700',
  paid: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-rose-100 text-rose-700',
};
const STATUS_LABEL = { draft: 'Rascunho', paid: 'Pago', pending: 'Pendente', completed: 'Concluída', cancelled: 'Cancelada', canceled: 'Cancelada' };

export default function Vendas() {
  const { company } = useOutletContext();
  const [items, setItems] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    if (!company) return;
    setItems(await salesRepository.list(company.id, '-sale_date'));
  };
  useEffect(() => { load(); }, [company]);

  const stats = useMemo(() => {
    if (!items) return { count: 0, total: 0, profit: 0 };
    const valid = items.filter(isRevenueSale);
    return {
      count: valid.length,
      total: valid.reduce((s, x) => s + (x.total || 0), 0),
      profit: valid.reduce((s, x) => s + (x.profit || 0), 0),
    };
  }, [items]);

  const handleCancel = async (sale) => {
    if (!confirm('Cancelar esta venda? O estoque será devolvido.')) return;
    await salesService.cancel(sale);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Vendas"
        subtitle="Registre pedidos com integração automática de estoque e financeiro."
        action={<Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova venda</Button>}
      />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Vendas no total</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.count}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Faturamento</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Lucro</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">{fmtMoney(stats.profit)}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhuma venda registrada</p>
            <p className="mt-1 text-xs text-slate-400">Registre sua primeira venda para ver o estoque e o financeiro atualizarem.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Vendedor</th>
                  <th className="px-4 py-3 font-medium">Pagamento</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className={`border-b border-slate-50 hover:bg-slate-50/50 ${s.status === 'cancelled' || s.status === 'canceled' ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{s.customer_name}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(s.sale_date)}</td>
                    <td className="px-4 py-3 text-slate-500">{s.seller || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{s.payment_method || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(s.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[s.status] || 'bg-slate-100 text-slate-600'}`}>{STATUS_LABEL[s.status] || s.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setViewing(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
                        {s.status !== 'cancelled' && s.status !== 'canceled' && s.status !== 'draft' && (
                          <button onClick={() => handleCancel(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Ban className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SaleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} company={company} onDone={load} />

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Venda — {viewing?.customer_name}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Data</span><span>{fmtDate(viewing.sale_date)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Vendedor</span><span>{viewing.seller || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pagamento</span><span>{viewing.payment_method} · {viewing.installments}x</span></div>
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-xs text-slate-500"><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Qtd</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {(viewing.items || []).map((i, idx) => (
                      <tr key={idx} className="border-b border-slate-50"><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 text-center">{i.qty ?? i.quantity}</td><td className="px-3 py-2 text-right">{fmtMoney(saleItemTotal(i))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(viewing.subtotal)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span>- {fmtMoney(viewing.discount)}</span></div>}
                <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(viewing.total)}</span></div>
                <div className="flex justify-between text-emerald-600"><span>Lucro</span><span>{fmtMoney(viewing.profit)}</span></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
