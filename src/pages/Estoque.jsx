// F7 PRO BUSINESS — Estoque
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertTriangle, Boxes, SlidersHorizontal } from 'lucide-react';
import { getDataProvider } from '@/data/providerSelector';
import { inventoryService } from '@/services/inventoryService';
import { fmtMoney, fmtNum, fmtDate } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPE_LABEL = { in: 'Entrada', out: 'Saída', adjust: 'Ajuste' };
const TYPE_STYLE = { in: 'text-emerald-600', out: 'text-rose-600', adjust: 'text-slate-500' };

export default function Estoque() {
  const { company } = useOutletContext();
  const [products, setProducts] = useState(null);
  const [movements, setMovements] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [newStock, setNewStock] = useState('0');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('product');
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState('');

  const load = async () => {
    if (!company) return;
    const [ps, ms] = await Promise.all([
      inventoryService.list(company.id),
      getDataProvider().entity('StockMovement').filter({ company_id: company.id }, '-created_date', 500),
    ]);
    setProducts((ps || []).filter((product) => product.item_type === 'product' || product.item_type === 'material')); setMovements(ms);
  };
  useEffect(() => { load(); }, [company]);

  const categoryItems = useMemo(() => (products || []).filter((product) => product.active !== false && product.item_type === category), [products, category]);
  // Keep archived catalog rows in the history lookup so stock movements remain
  // visible after a product or raw material is archived.
  const categoryProductIds = useMemo(() => new Set((products || []).filter((product) => product.item_type === category).map((product) => product.id)), [products, category]);
  const itemTypeById = useMemo(() => new Map((products || []).map((product) => [product.id, product.item_type])), [products]);
  const visibleMovements = useMemo(() => (movements || []).filter((movement) => categoryProductIds.has(movement.product_id)), [movements, categoryProductIds]);

  const stats = useMemo(() => {
    if (!products) return { total: 0, critical: 0, value: 0 };
    return {
      total: categoryItems.length,
      critical: categoryItems.filter((p) => (Number(p.stock) || 0) <= (Number(p.min_stock ?? p.minimum_stock) || 0)).length,
      value: categoryItems.reduce((sum, p) => sum + (Number(p.stock) || 0) * (Number(p.cost_price ?? p.cost) || 0), 0),
    };
  }, [products, categoryItems]);

  const openAdjust = (p) => { setAdjusting(p); setNewStock(String(p.stock || 0)); setReason(''); setAdjustmentError(''); };
  const doAdjust = async () => {
    if (!adjusting || savingAdjustment) return;
    setSavingAdjustment(true);
    setAdjustmentError('');
    try {
      await inventoryService.adjust(company.id, adjusting, newStock, reason);
      setAdjusting(null);
      await load();
    } catch (error) {
      setAdjustmentError(error?.message || 'Não foi possível ajustar o estoque.');
    } finally {
      setSavingAdjustment(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader title="Estoque" subtitle="Controle de movimentações e alertas de reposição." />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Categoria do estoque">
        {[['product', 'Produtos acabados / revenda'], ['material', 'Matérias-primas']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={category === value} onClick={() => setCategory(value)} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${category === value ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30' : 'border-slate-200 bg-white text-slate-600'}`}>{label}<span className="ml-2 text-xs opacity-75">{products ? products.filter((product) => product.active !== false && product.item_type === value).length : 0}</span></button>)}
      </div>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">{category === 'material' ? 'Matérias-primas cadastradas' : 'Produtos cadastrados'}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Estoque crítico</p>
          <p className="mt-1 text-xl font-semibold text-rose-600">{fmtNum(stats.critical)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">{category === 'material' ? 'Custo interno em estoque' : 'Valor em estoque'}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.value)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Products stock */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">{category === 'material' ? 'Estoque interno de matérias-primas' : 'Estoque de produtos acabados / revenda'}</h3>
          <p className="mb-4 text-xs text-slate-500">{category === 'material' ? 'A produção consome estes saldos e incorpora seus custos às unidades produzidas.' : 'Entradas de produção e compras aumentam este saldo; vendas o reduzem.'}</p>
          {!products ? (
            <p className="py-8 text-center text-sm text-slate-400">Carregando...</p>
          ) : categoryItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{category === 'material' ? 'Nenhuma matéria-prima cadastrada.' : 'Nenhum produto cadastrado.'}</p>
          ) : (
            <div className="space-y-2">
              {categoryItems.map((p) => {
                const critical = (p.stock || 0) <= (p.min_stock || 0);
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <Boxes className="h-4 w-4 text-slate-400" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-700">{p.name}</p>
                      <p className="text-xs text-slate-400">Mínimo: {fmtNum(p.min_stock)} {p.unit}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${critical ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      {critical && <AlertTriangle className="h-3 w-3" />}{fmtNum(p.stock)} {p.unit}
                    </span>
                    <button onClick={() => openAdjust(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><SlidersHorizontal className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Movements */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">Movimentações recentes</h3>
          {!movements || visibleMovements.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sem movimentações.</p>
          ) : (
            <div className="space-y-2.5">
              {visibleMovements.slice(0, 12).map((m) => (
                <div key={m.id} className="flex items-start gap-2.5 border-b border-slate-50 pb-2.5">
                  <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${m.type === 'in' ? 'bg-emerald-100 text-emerald-600' : m.type === 'out' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    {m.type === 'in' ? '+' : m.type === 'out' ? '−' : '='}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700">{m.product_name}<span className="ml-2 text-[10px] font-semibold uppercase text-slate-400">{itemTypeById.get(m.product_id) === 'material' ? 'Matéria-prima' : 'Produto'}</span></p>
                    <p className="text-xs text-slate-400">{m.reason} · {fmtDate(m.created_date)}</p>
                  </div>
                  <span className={`text-sm font-medium ${TYPE_STYLE[m.type]}`}>{m.type === 'out' ? '-' : '+'}{fmtNum(m.quantity)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Adjust dialog */}
      <Dialog open={!!adjusting} onOpenChange={() => setAdjusting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{adjusting?.item_type === 'material' ? 'Ajustar estoque de matéria-prima' : 'Ajustar estoque de produto'}</DialogTitle></DialogHeader>
          {adjusting && (
            <div className="space-y-3">
              {adjustmentError && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{adjustmentError}</p>}
              <p className="text-sm text-slate-500">{adjusting.name}</p>
              <p className="text-xs text-slate-400">Estoque atual: {fmtNum(adjusting.stock)} {adjusting.unit}</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Novo estoque</Label>
                <Input type="number" min="0" step="0.001" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Motivo</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inventário, perda, etc." />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAdjusting(null)} disabled={savingAdjustment}>Cancelar</Button>
                <Button onClick={doAdjust} disabled={savingAdjustment}>{savingAdjustment ? 'Salvando...' : 'Salvar ajuste'}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
