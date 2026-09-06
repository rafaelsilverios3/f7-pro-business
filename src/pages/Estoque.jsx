// F7 PRO BUSINESS — Estoque
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertTriangle, Boxes, SlidersHorizontal } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { fmtMoney, fmtNum, fmtDate, adjustStock } from '@/lib/business';
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
  const [newStock, setNewStock] = useState(0);
  const [reason, setReason] = useState('');

  const load = async () => {
    if (!company) return;
    const [ps, ms] = await Promise.all([
      base44.entities.Product.filter({ company_id: company.id }, '-created_date', 500),
      base44.entities.StockMovement.filter({ company_id: company.id }, '-created_date', 100),
    ]);
    setProducts(ps); setMovements(ms);
  };
  useEffect(() => { load(); }, [company]);

  const stats = useMemo(() => {
    if (!products) return { total: 0, critical: 0, value: 0 };
    return {
      total: products.length,
      critical: products.filter((p) => (p.stock || 0) <= (p.min_stock || 0)).length,
      value: products.reduce((s, p) => s + (p.stock || 0) * (p.cost_price || 0), 0),
    };
  }, [products]);

  const openAdjust = (p) => { setAdjusting(p); setNewStock(p.stock || 0); setReason(''); };
  const doAdjust = async () => {
    await adjustStock(company.id, adjusting, newStock, reason);
    setAdjusting(null);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader title="Estoque" subtitle="Controle de movimentações e alertas de reposição." />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Produtos cadastrados</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Estoque crítico</p>
          <p className="mt-1 text-xl font-semibold text-rose-600">{fmtNum(stats.critical)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Valor em estoque</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.value)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Products stock */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">Posição de estoque</h3>
          {!products ? (
            <p className="py-8 text-center text-sm text-slate-400">Carregando...</p>
          ) : products.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Nenhum produto cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {products.map((p) => {
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
          {!movements || movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sem movimentações.</p>
          ) : (
            <div className="space-y-2.5">
              {movements.slice(0, 12).map((m) => (
                <div key={m.id} className="flex items-start gap-2.5 border-b border-slate-50 pb-2.5">
                  <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${m.type === 'in' ? 'bg-emerald-100 text-emerald-600' : m.type === 'out' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    {m.type === 'in' ? '+' : m.type === 'out' ? '−' : '='}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700">{m.product_name}</p>
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
          <DialogHeader><DialogTitle>Ajustar estoque</DialogTitle></DialogHeader>
          {adjusting && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">{adjusting.name}</p>
              <p className="text-xs text-slate-400">Estoque atual: {fmtNum(adjusting.stock)} {adjusting.unit}</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Novo estoque</Label>
                <Input type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Motivo</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inventário, perda, etc." />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAdjusting(null)}>Cancelar</Button>
                <Button onClick={doAdjust}>Salvar ajuste</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}