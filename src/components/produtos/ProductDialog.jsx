// F7 PRO BUSINESS — Dialog de produto
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import PricingDialog from '@/components/pricing/PricingDialog';
import ProductCatalogPanel from '@/components/pricing/ProductCatalogPanel';
import { moneyOr, parseMoneyInput } from '@/lib/money';

function productSaveMessage(error) {
  const code = String(error?.code || '').trim();
  if (code === '23505') return 'Já existe um produto com este SKU nesta empresa.';
  if (code === '42501') return 'Você não tem permissão para alterar produtos desta empresa.';
  if (code === '42703' || code === 'PGRST204' || code === 'PGRST205') return 'O banco ainda não possui todos os campos do catálogo. Aplique as migrations 0021 e 0053 do catálogo de produtos e serviços.';
  if (code === 'PGRST116') return 'O produto não foi encontrado nesta empresa. Atualize a página e tente novamente.';
  return 'Não foi possível salvar as alterações do produto.';
}

function normalizeProductForm(form, fixedItemType, defaultItemType) {
  const itemType = fixedItemType ? defaultItemType : (form.item_type || 'product');
  return {
    ...form,
    item_type: itemType,
    duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes),
    cost_price: moneyOr(form.cost_price),
    sale_price: moneyOr(form.sale_price),
    stock: itemType === 'service' ? 0 : (form.stock === '' ? 0 : Number(form.stock)),
    min_stock: itemType === 'service' ? 0 : (form.min_stock === '' ? 0 : Number(form.min_stock)),
    commission: form.commission === '' ? 0 : Number(form.commission),
  };
}

export default function ProductDialog({ open, onClose, onSave, initial, companyId, canManagePricing = false, canManageCatalog = false, onApplyPricing, defaultItemType = 'product', fixedItemType = false }) {
  const emptyForm = {
    item_type: defaultItemType, duration_minutes: '', sku: '', barcode: '', name: '', subcategory: '', brand: '', description: '', short_description: '', full_description: '', material: '', color: '', size: '', model: '', weight: '', dimensions: {}, tags: [], keywords: [], featured: false,
    cost_price: 0, sale_price: 0, stock: 0, min_stock: 0, unit: 'un', commission: 0, active: true,
  };
  const [form, setForm] = useState(emptyForm);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (initial) setForm({ ...emptyForm, ...initial, cost_price: initial.cost_price ?? initial.cost ?? 0, sale_price: initial.sale_price ?? initial.price ?? 0, min_stock: initial.min_stock ?? initial.minimum_stock ?? 0, commission: initial.commission ?? initial.commission_rate ?? 0 });
    else setForm(emptyForm);
  }, [initial, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const persistLive = async (field, value) => {
    if (!initial || saving || !onSave) return;
    if (['cost_price', 'sale_price'].includes(field) && value !== '' && parseMoneyInput(value) == null) {
      setSaveError('Informe um valor monetário válido, por exemplo 1.234,56.');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const next = normalizeProductForm({ ...form, [field]: value }, fixedItemType, defaultItemType);
      setForm(next);
      const saved = await onSave(next);
      if (saved) setForm((current) => ({ ...current, ...saved, cost_price: saved.cost_price ?? saved.cost ?? current.cost_price, sale_price: saved.sale_price ?? saved.price ?? current.sale_price, min_stock: saved.min_stock ?? saved.minimum_stock ?? current.min_stock }));
    } catch (error) { setSaveError(productSaveMessage(error)); }
    finally { setSaving(false); }
  };
  const margin = Number(form.sale_price) > 0 ? ((Number(form.sale_price) - Number(form.cost_price)) / Number(form.sale_price)) * 100 : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setSaveError('');
    if ([form.cost_price, form.sale_price].some((value) => value !== '' && parseMoneyInput(value) == null)) {
      setSaveError('Informe custo e preço de venda em formato válido, por exemplo 1.234,56.');
      setSaving(false);
      return;
    }
    try {
      await onSave(normalizeProductForm(form, fixedItemType, defaultItemType));
      onClose();
    } catch (error) {
      setSaveError(productSaveMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex min-h-0 max-w-3xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{initial ? 'Editar produto' : 'Novo produto'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1">
          {!fixedItemType && <div className="flex gap-2 rounded-lg bg-slate-950/40 p-1"><button type="button" onClick={() => set('item_type', 'product')} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${form.item_type !== 'service' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:bg-blue-500/10 hover:text-blue-100'}`}>Produto</button><button type="button" onClick={() => set('item_type', 'service')} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${form.item_type === 'service' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:bg-blue-500/10 hover:text-blue-100'}`}>Serviço</button></div>}
          {saveError && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">SKU / Código</Label>
              <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SKU" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Código de barras</Label>
              <Input value={form.barcode || ''} onChange={(e) => set('barcode', e.target.value)} placeholder="EAN / GTIN" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subcategoria</Label>
              <Input value={form.subcategory || ''} onChange={(e) => set('subcategory', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Marca</Label>
              <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unidade</Label>
              <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="un, kg, l" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Preço de Custo</Label>
              <Input type="text" inputMode="decimal" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} onBlur={(e) => persistLive('cost_price', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Preço de Venda</Label>
              <Input type="text" inputMode="decimal" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} onBlur={(e) => persistLive('sale_price', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Margem</Label>
              <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-600">{margin.toFixed(2)}%</div>
            </div>
          </div>
          {form.item_type === 'service' && <div className="space-y-1.5"><Label className="text-xs">Duração estimada (minutos)</Label><Input type="number" min="1" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} /></div>}
          <Button type="button" variant="outline" className="w-full" onClick={() => setPricingOpen(true)}>Calcular preço de venda</Button>
          {form.item_type !== 'service' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Estoque</Label>
              <Input type="number" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Estoque Mín.</Label>
              <Input type="number" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} />
            </div>
          </div>}
          <div className="space-y-1.5"><Label className="text-xs">Comissão %</Label><Input type="number" step="0.1" value={form.commission} onChange={(e) => set('commission', e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Descrição</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="resize-none" />
          </div>
          <div className="grid gap-3 sm:grid-cols-4"><div className="space-y-1.5"><Label className="text-xs">Material</Label><Input value={form.material || ''} onChange={(e) => set('material', e.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">Cor</Label><Input value={form.color || ''} onChange={(e) => set('color', e.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">Tamanho</Label><Input value={form.size || ''} onChange={(e) => set('size', e.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">Modelo</Label><Input value={form.model || ''} onChange={(e) => set('model', e.target.value)} /></div></div>
          <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1.5"><Label className="text-xs">Peso</Label><Input type="number" step="0.001" value={form.weight || ''} onChange={(e) => set('weight', e.target.value)} /></div><div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Descrição curta</Label><Input value={form.short_description || ''} onChange={(e) => set('short_description', e.target.value)} /></div></div>
          <div className="space-y-1.5"><Label className="text-xs">Descrição completa</Label><Textarea value={form.full_description || ''} onChange={(e) => set('full_description', e.target.value)} rows={3} className="resize-none" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label className="text-xs">Tags</Label><Input value={(form.tags || []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} placeholder="ex.: promoção, lançamento" /></div><div className="space-y-1.5"><Label className="text-xs">Palavras-chave</Label><Input value={(form.keywords || []).join(', ')} onChange={(e) => set('keywords', e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} /></div></div>
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={Boolean(form.featured)} onChange={(e) => set('featured', e.target.checked)} /> Produto em destaque</label>
          {form.item_type === 'product' && <ProductCatalogPanel companyId={companyId} productId={initial?.id} canManage={canManageCatalog} />}
          <DialogFooter className="sticky bottom-0 -mx-1 border-t border-slate-700/70 bg-background px-1 pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : initial ? 'Salvar' : 'Adicionar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <PricingDialog open={pricingOpen} onClose={() => setPricingOpen(false)} product={form} canManage={Boolean(initial && canManagePricing)} onSelectPrice={(value) => set('sale_price', value)} onApply={async ({ price, summary }) => { const updated = await onApplyPricing?.({ product: initial, price, summary }); set('sale_price', updated?.price ?? price); if (updated?.cost != null) set('cost_price', updated.cost); }} />
    </Dialog>
  );
}

