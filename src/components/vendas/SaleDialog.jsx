// F7 PRO BUSINESS — Dialog de venda
import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Search } from 'lucide-react';
import { getDataProvider } from '@/data/providerSelector';
import { fmtMoney } from '@/lib/business';
import { salesService } from '@/services/salesService';

const PAYMENT_OPTIONS = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência'];

export default function SaleDialog({ open, onClose, company, onDone }) {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [items, setItems] = useState([]);
  const [productQuery, setProductQuery] = useState('');
  const [discount, setDiscount] = useState(0);
  const [addition, setAddition] = useState(0);
  const [seller, setSeller] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Dinheiro');
  const [installments, setInstallments] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !company) return;
    (async () => {
      const provider = getDataProvider();
      setCustomers(await provider.entity('Customer').filter({ company_id: company.id }, '-created_date', 500));
      setProducts(await provider.entity('Product').filter({ company_id: company.id }, '-created_date', 500));
    })();
  }, [open, company]);

  const customer = customers.find((c) => c.id === customerId);

  const productResults = useMemo(() => {
    if (!productQuery) return products.slice(0, 5);
    return products.filter((p) => p.name?.toLowerCase().includes(productQuery.toLowerCase())).slice(0, 5);
  }, [products, productQuery]);

  const addItem = (p) => {
    setItems((prev) => {
      const ex = prev.find((i) => i.product_id === p.id);
      if (ex) return prev.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product_id: p.id, name: p.name, qty: 1, price: p.sale_price || 0, cost: p.cost_price || 0 }];
    });
    setProductQuery('');
  };

  const setQty = (id, qty) => setItems((prev) => prev.map((i) => i.product_id === id ? { ...i, qty: Math.max(1, Number(qty) || 1) } : i));
  const setPrice = (id, price) => setItems((prev) => prev.map((i) => i.product_id === id ? { ...i, price: Number(price) || 0 } : i));
  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.product_id !== id));

  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const total = subtotal - (Number(discount) || 0) + (Number(addition) || 0);

  const reset = () => {
    setCustomerId(''); setItems([]); setDiscount(0); setAddition(0); setSeller(''); setPaymentMethod('Dinheiro'); setInstallments(1); setNotes('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await salesService.finalize(company.id, {
        customer_id: customerId || null,
        customer_name: customer?.name || 'Cliente',
        items,
        discount: Number(discount) || 0,
        addition: Number(addition) || 0,
        seller,
        payment_method: paymentMethod,
        installments: Number(installments) || 1,
        notes,
      });
      reset();
      onDone?.();
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex min-h-0 max-w-2xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Nova venda</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                <option value="">Selecione...</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vendedor</Label>
              <Input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Nome do vendedor" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Forma de pagamento</Label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                {PAYMENT_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Parcelas</Label>
              <Input type="number" min="1" value={installments} onChange={(e) => setInstallments(e.target.value)} />
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
                      <span className="text-xs text-slate-400">{fmtMoney(p.sale_price)}</span>
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
                    <input type="number" step="0.01" value={i.price} onChange={(e) => setPrice(i.product_id, e.target.value)} className="h-8 w-20 rounded-md border border-slate-200 px-2 text-right text-sm" />
                    <span className="w-20 text-right text-sm font-medium text-slate-700">{fmtMoney(i.qty * i.price)}</span>
                    <button type="button" onClick={() => removeItem(i.product_id)} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Desconto (R$)</Label>
              <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Acréscimo (R$)</Label>
              <Input type="number" step="0.01" value={addition} onChange={(e) => setAddition(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" />
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(subtotal)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Desconto</span><span>- {fmtMoney(Number(discount) || 0)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Acréscimo</span><span>+ {fmtMoney(Number(addition) || 0)}</span></div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(total)}</span></div>
          </div>

          <DialogFooter className="sticky bottom-0 -mx-1 border-t border-slate-200 bg-background px-1 pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={items.length === 0 || submitting}>{submitting ? 'Salvando...' : 'Registrar venda'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
