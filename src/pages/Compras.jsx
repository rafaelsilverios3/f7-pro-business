import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Edit2, Trash2, PackageCheck, Eye } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { fmtMoney, fmtDate } from '@/lib/business';
import { purchasesService } from '@/services/purchasesService';
import PageHeader from '@/components/layout/PageHeader';
import SupplierDialog from '@/components/compras/SupplierDialog';
import PurchaseDialog from '@/components/compras/PurchaseDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const PO_STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-blue-100 text-blue-700',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
};
const PO_STATUS_LABEL = { pending: 'Pendente', partial: 'Parcial', received: 'Recebido', cancelled: 'Cancelado' };

export default function Compras() {
  const { company } = useOutletContext();
  const [tab, setTab] = useState('purchases');
  const [suppliers, setSuppliers] = useState(null);
  const [purchases, setPurchases] = useState(null);
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [purchaseDialog, setPurchaseDialog] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    if (!company) return;
    const [s, p] = await Promise.all([
      base44.entities.Supplier.filter({ company_id: company.id }, '-created_date', 500),
      base44.entities.PurchaseOrder.filter({ company_id: company.id }, '-created_date', 500),
    ]);
    setSuppliers(s);
    setPurchases(p);
  };
  useEffect(() => { load(); }, [company]);

  const poStats = useMemo(() => {
    if (!purchases) return { count: 0, total: 0, pending: 0 };
    return {
      count: purchases.length,
      total: purchases.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + (p.total || 0), 0),
      pending: purchases.filter((p) => p.status === 'pending').length,
    };
  }, [purchases]);

  const handleReceive = async (po) => {
    if (!confirm('Confirmar recebimento? O estoque será atualizado e uma conta a pagar será gerada.')) return;
    try {
      await purchasesService.receive(po);
      load();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  };

  const handleDeleteSupplier = async (s) => {
    if (!confirm('Excluir fornecedor?')) return;
    await base44.entities.Supplier.delete(s.id);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Compras e Fornecedores"
        subtitle="Gestão de fornecedores e pedidos de compra com integração de estoque."
        action={
          tab === 'purchases'
            ? <Button onClick={() => setPurchaseDialog(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova compra</Button>
            : <Button onClick={() => { setEditingSupplier(null); setSupplierDialog(true); }}><Plus className="mr-1.5 h-4 w-4" /> Novo fornecedor</Button>
        }
      />

      <div className="mb-5 flex gap-2">
        <button onClick={() => setTab('purchases')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'purchases' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>Pedidos de Compra</button>
        <button onClick={() => setTab('suppliers')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'suppliers' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>Fornecedores</button>
      </div>

      {tab === 'purchases' && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Pedidos</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{poStats.count}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Valor total</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(poStats.total)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Pendentes</p>
              <p className="mt-1 text-xl font-semibold text-amber-600">{poStats.pending}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {!purchases ? (
              <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
            ) : purchases.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm font-medium text-slate-700">Nenhuma compra registrada</p>
                <p className="mt-1 text-xs text-slate-400">Crie um pedido de compra para repor estoque.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-4 py-3 font-medium">Fornecedor</th>
                      <th className="px-4 py-3 font-medium">Previsão</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                      <th className="px-4 py-3 text-center font-medium">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-800">{p.supplier_name}</td>
                        <td className="px-4 py-3 text-slate-500">{fmtDate(p.expected_date)}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(p.total)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PO_STATUS_STYLE[p.status]}`}>{PO_STATUS_LABEL[p.status]}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => setViewing(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
                            {p.status === 'pending' && (
                              <button onClick={() => handleReceive(p)} title="Receber" className="rounded-md p-1.5 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"><PackageCheck className="h-4 w-4" /></button>
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
        </>
      )}

      {tab === 'suppliers' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!suppliers ? (
            <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
          ) : suppliers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-slate-700">Nenhum fornecedor cadastrado</p>
              <p className="mt-1 text-xs text-slate-400">Cadastre fornecedores para criar pedidos de compra.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Fornecedor</th>
                    <th className="px-4 py-3 font-medium">Contato</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Telefone</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                      <td className="px-4 py-3 text-slate-500">{s.contact_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{s.category || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{s.phone || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setEditingSupplier(s); setSupplierDialog(true); }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Edit2 className="h-4 w-4" /></button>
                          <button onClick={() => handleDeleteSupplier(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <SupplierDialog open={supplierDialog} onClose={() => { setSupplierDialog(false); setEditingSupplier(null); }} company={company} onDone={load} editing={editingSupplier} />
      <PurchaseDialog open={purchaseDialog} onClose={() => setPurchaseDialog(false)} company={company} onDone={load} />

      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Compra — {viewing?.supplier_name}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Previsão</span><span>{fmtDate(viewing.expected_date)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Recebido</span><span>{fmtDate(viewing.received_date)}</span></div>
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-xs text-slate-500"><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Qtd</th><th className="px-3 py-2 text-right font-medium">Custo</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {(viewing.items || []).map((i, idx) => (
                      <tr key={idx} className="border-b border-slate-50"><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 text-center">{i.qty}</td><td className="px-3 py-2 text-right">{fmtMoney(i.cost)}</td><td className="px-3 py-2 text-right">{fmtMoney(i.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(viewing.total)}</span></div>
              {viewing.status === 'pending' && (
                <Button onClick={() => { handleReceive(viewing); setViewing(null); }} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <PackageCheck className="mr-1.5 h-4 w-4" /> Confirmar recebimento
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
