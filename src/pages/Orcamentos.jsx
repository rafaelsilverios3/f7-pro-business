import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Eye, FileCheck, Trash2 } from 'lucide-react';
import { quotesRepository } from '@/data/repositories/quotesRepository';
import { fmtMoney, fmtDate } from '@/lib/business';
import { quotesService } from '@/services/quotesService';
import { runAutomations } from '@/lib/automations';
import PageHeader from '@/components/layout/PageHeader';
import QuoteDialog from '@/components/orcamentos/QuoteDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-cyan-100 text-cyan-700',
  negotiating: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  refused: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-500',
};
const STATUS_LABEL = {
  draft: 'Rascunho', sent: 'Enviado', viewed: 'Visualizado', negotiating: 'Em negociação',
  approved: 'Aprovado', refused: 'Recusado', expired: 'Expirado',
};
const STATUS_FLOW = ['draft', 'sent', 'viewed', 'negotiating', 'approved', 'refused', 'expired'];

export default function Orcamentos() {
  const { company } = useOutletContext();
  const [items, setItems] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    if (!company) return;
    setItems(await quotesRepository.list(company.id));
  };
  useEffect(() => { load(); }, [company]);

  const stats = useMemo(() => {
    if (!items) return { count: 0, total: 0, approved: 0 };
    return {
      count: items.length,
      total: items.reduce((s, q) => s + (q.total || 0), 0),
      approved: items.filter((q) => q.status === 'approved').length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (filter === 'all') return items;
    return items.filter((q) => q.status === filter);
  }, [items, filter]);

  const handleStatusChange = async (quote, status) => {
    await quotesService.updateStatus(company.id, quote.id, status);
    if (status === 'approved' && import.meta.env.VITE_DATA_PROVIDER !== 'supabase') await runAutomations(company.id, 'quote_approved', { ...quote, _type: 'quote', customer_name: quote.customer_name });
    load();
  };

  const handleConvert = async (quote) => {
    if (!confirm('Converter este orçamento em venda? O estoque e o financeiro serão atualizados automaticamente.')) return;
    try {
      const sale = await quotesService.convertToSale(quote);
      alert(`Venda criada com sucesso! Total: ${fmtMoney(sale.total)}`);
      load();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  };

  const handleDelete = async (quote) => {
    if (!confirm('Excluir este orçamento?')) return;
    await quotesService.remove(company.id, quote.id);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Orçamentos"
        subtitle="Crie orçamentos profissionais e converta em venda com um clique."
        action={<Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo orçamento</Button>}
      />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Total de orçamentos</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.count}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Valor total</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Aprovados</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">{stats.approved}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setFilter('all')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>Todos</button>
        {STATUS_FLOW.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>{STATUS_LABEL[s]}</button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhum orçamento</p>
            <p className="mt-1 text-xs text-slate-400">Crie seu primeiro orçamento para começar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Vendedor</th>
                  <th className="px-4 py-3 font-medium">Validade</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">{q.customer_name}</td>
                    <td className="px-4 py-3 text-slate-500">{q.seller || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(q.valid_until)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(q.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={q.status}
                        onChange={(e) => handleStatusChange(q, e.target.value)}
                        className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[q.status]}`}
                      >
                        {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setViewing(q)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
                        {q.status === 'approved' && !q.sale_id && (
                          <button onClick={() => handleConvert(q)} title="Converter em venda" className="rounded-md p-1.5 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"><FileCheck className="h-4 w-4" /></button>
                        )}
                        {q.sale_id && (
                          <span className="flex items-center rounded-md bg-emerald-50 px-2 text-[10px] font-medium text-emerald-600">Vendido</span>
                        )}
                        <button onClick={() => handleDelete(q)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <QuoteDialog open={dialogOpen} onClose={() => setDialogOpen(false)} company={company} onDone={load} />

      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Orçamento — {viewing?.customer_name}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Vendedor</span><span>{viewing.seller || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Validade</span><span>{fmtDate(viewing.valid_until)}</span></div>
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-xs text-slate-500"><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Qtd</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {(viewing.items || []).map((i, idx) => (
                      <tr key={idx} className="border-b border-slate-50"><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 text-center">{i.qty}</td><td className="px-3 py-2 text-right">{fmtMoney(i.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(viewing.subtotal)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span>- {fmtMoney(viewing.discount)}</span></div>}
                <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(viewing.total)}</span></div>
              </div>
              {viewing.notes && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{viewing.notes}</div>}
              {viewing.status === 'approved' && !viewing.sale_id && (
                <Button onClick={() => { handleConvert(viewing); setViewing(null); }} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <FileCheck className="mr-1.5 h-4 w-4" /> Converter em venda
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
