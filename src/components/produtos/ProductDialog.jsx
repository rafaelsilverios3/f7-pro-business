// F7 PRO BUSINESS — Dialog de produto
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import PricingDialog from '@/components/pricing/PricingDialog';

export default function ProductDialog({ open, onClose, onSave, initial, canManagePricing = false, onApplyPricing }) {
  const [form, setForm] = useState({
    sku: '', barcode: '', name: '', category: '', brand: '', description: '',
    cost_price: 0, sale_price: 0, stock: 0, min_stock: 0, unit: 'un', commission: 0, active: true,
  });
  const [pricingOpen, setPricingOpen] = useState(false);

  useEffect(() => {
    if (initial) setForm({ ...form, ...initial });
    else setForm({ sku: '', barcode: '', name: '', category: '', brand: '', description: '', cost_price: 0, sale_price: 0, stock: 0, min_stock: 0, unit: 'un', commission: 0, active: true });
  }, [initial, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const margin = form.cost_price > 0 ? ((form.sale_price - form.cost_price) / form.sale_price) * 100 : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await onSave({ ...form, cost_price: Number(form.cost_price) || 0, sale_price: Number(form.sale_price) || 0, stock: Number(form.stock) || 0, min_stock: Number(form.min_stock) || 0, commission: Number(form.commission) || 0 });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial ? 'Editar produto' : 'Novo produto'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">SKU / Código</Label>
              <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SKU" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria</Label>
              <Input value={form.category} onChange={(e) => set('category', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Código de barras</Label>
              <Input value={form.barcode || ''} onChange={(e) => set('barcode', e.target.value)} placeholder="EAN / GTIN" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Marca</Label>
              <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unidade</Label>
              <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="un, kg, l" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Preço de Custo</Label>
              <Input type="number" step="0.01" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Preço de Venda</Label>
              <Input type="number" step="0.01" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Margem</Label>
              <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-600">{margin.toFixed(1)}%</div>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={() => setPricingOpen(true)}>Calcular preço de venda</Button>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Estoque</Label>
              <Input type="number" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Estoque Mín.</Label>
              <Input type="number" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Comissão %</Label>
              <Input type="number" step="0.1" value={form.commission} onChange={(e) => set('commission', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Descrição</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="resize-none" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">{initial ? 'Salvar' : 'Adicionar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <PricingDialog open={pricingOpen} onClose={() => setPricingOpen(false)} product={form} canManage={Boolean(initial && canManagePricing)} onSelectPrice={(value) => set('sale_price', value)} onApply={async ({ price, summary }) => { await onApplyPricing?.({ product: initial, price, summary }); set('sale_price', price); }} />
    </Dialog>
  );
}
