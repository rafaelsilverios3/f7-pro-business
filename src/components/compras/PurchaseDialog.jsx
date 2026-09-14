import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Search } from 'lucide-react';
import { getDataProvider } from '@/data/providerSelector';
import { fmtMoney } from '@/lib/business';
import { purchasesService } from '@/services/purchasesService';

export default function PurchaseDialog({ open, onClose, company, onDone, suggestion = null }) {
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([]);
  const [productQuery, setProductQuery] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !company) return;
    (async () => {
      const provider = getDataProvider();
      setSuppliers(await provider.entity('Supplier').filter({ company_id: company.id, active: true }, '-created_date', 500));
      setProducts(await provider.entity('Product').filter({ company_id: company.id }, '-created_date', 500));
    })();
    if (suggestion?.product_id && suggestion.suggested_quantity > 0) {
      setItems([{ product_id: suggestion.product_id, name: suggestion.name, qty: suggestion.suggested_quantity, cost: suggestion.last_purchase?.cost ?? 0 }]);
    } else setItems([]);
    const suggestedSupplier = suggestion?.suppliers?.[0]?.id;
    setSupplierId(suggestedSupplier || '');
  }, [open, company, suggestion]);

  const supplier = suppliers.find((s) => s.id === supplierId);

  const productResults = useMemo(() => {
    if (!productQuery) return products.slice(0, 5);
    return products.filter((p) => p.name?.toLowerCase().includes(productQuery.toLowerCase())).slice(0, 5);
  }, [products, productQuery]);

  const addItem = (p) => {
    setItems((prev) => {
      const ex = prev.find((i) => i.product_id === p.id);
      if (ex) return prev.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product_id: p.id, name: p.name, qty: 1, cost: p.cost_price || 0 }];
    });
    setProductQuery('');
  };

  const setQty = (id, qty) => setItems((prev) => prev.map((i) => i.product_id === id ? { ...i, qty: Math.max(1, Number(qty) || 1) } : i));
  const setCost = (id, cost) => setItems((prev) => prev.map((i) => i.product_id === id ? { ...i, cost: Number(cost) || 0 } : i));
  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.product_id !== id));

  const total = items.reduce((s, i) => s + i.qty * i.cost, 0);

  const submit = async (e) => {
    e.preventDefault();
    if (items.length === 0 || !supplier || submitting) return;
    setSubmitting(true);
    try {
      await purchasesService.create(company.id, {
        supplier_id: supplierId,
        supplier_name: supplier.name,
        items,
        expected_date: expectedDate,
        notes,
      });
      setItems([]); setSupplierId(''); setExpectedDate(''); setNotes('');
      onDone?.();
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Nova compra</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Fornecedor</Label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" required>
                <option value="">Selecione...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Previsão de entrega</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Adicionar produto</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Buscar produto..."
                className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400" />
              {productQuery && productResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {productResults.map((p) => (
                    <button key={p.id} type="button" onClick={() => addItem(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span className="text-slate-700">{p.name}</span>
                      <span className="text-xs text-slate-400">custo: {fmtMoney(p.cost_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200">
            {items.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-400">Nenhum produto adicionado.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {items.map((i) => (
                  <div key={i.product_id} className="flex items-center gap-2 p-2.5">
                    <span className="flex-1 truncate text-sm text-slate-700">{i.name}</span>
                    <input type="number" value={i.qty} onChange={(e) => setQty(i.product_id, e.target.value)} className="h-8 w-14 rounded-md border border-slate-200 px-2 text-center text-sm" />
                    <span className="text-xs text-slate-400">×</span>
                    <input type="number" step="0.01" value={i.cost} onChange={(e) => setCost(i.product_id, e.target.value)} className="h-8 w-20 rounded-md border border-slate-200 px-2 text-right text-sm" />
                    <span className="w-20 text-right text-sm font-medium text-slate-700">{fmtMoney(i.qty * i.cost)}</span>
                    <button type="button" onClick={() => removeItem(i.product_id)} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" />
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between text-base font-semibold text-slate-900"><span>Total da compra</span><span>{fmtMoney(total)}</span></div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={items.length === 0 || !supplierId || submitting}>{submitting ? 'Salvando...' : 'Criar pedido de compra'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
