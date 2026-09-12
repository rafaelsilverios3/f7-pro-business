// F7 PRO BUSINESS — Produtos
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';
import { can } from '@/lib/permissions';
import { applyProductPrice } from '@/services/pricingService';
import { Plus, Search, Pencil, Trash2, AlertTriangle, Package } from 'lucide-react';
import { productsRepository } from '@/data/repositories/productsRepository';
import { productsService } from '@/services/productsService';
import { fmtMoney, fmtNum } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import ProductDialog from '@/components/produtos/ProductDialog';
import { Button } from '@/components/ui/button';

export default function Produtos() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const [role, setRole] = useState(user?.role || '');
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const canManagePricing = can({ role }, 'pricing.manage');
  const canManageCatalog = can({ role }, 'catalog.manage');

  const load = async () => {
    if (!company) return;
    setItems(await productsRepository.list(company.id));
  };
  useEffect(() => { load(); }, [company]);
  useEffect(() => { let cancelled = false; if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id || !user?.id) { setRole(user?.role || ''); return undefined; } getSupabaseClient().from('company_users').select('role').eq('company_id', company.id).eq('user_id', user.id).eq('active', true).maybeSingle().then(({ data }) => { if (!cancelled) setRole(data?.role || ''); }); return () => { cancelled = true; }; }, [company?.id, user?.id, user?.role]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (!query) return items;
    return items.filter((p) => p.name?.toLowerCase().includes(query.toLowerCase()) || p.sku?.toLowerCase().includes(query.toLowerCase()));
  }, [items, query]);

  const handleSave = async (form) => {
    if (editing) await productsService.update(company.id, editing.id, form);
    else await productsService.create(company.id, form);
    await load();
  };
  const handleDelete = async (id) => { await productsRepository.remove(id, company.id); load(); };

  const stats = useMemo(() => {
    if (!items) return { total: 0, critical: 0, stockValue: 0 };
    return {
      total: items.filter((p) => p.item_type !== 'service').length,
      services: items.filter((p) => p.item_type === 'service').length,
      critical: items.filter((p) => p.item_type !== 'service' && (p.stock || 0) <= (p.min_stock || 0)).length,
      stockValue: items.filter((p) => p.item_type !== 'service').reduce((s, p) => s + (p.stock || 0) * (p.cost_price || 0), 0),
    };
  }, [items]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Produtos e Serviços"
        subtitle="Gerencie seu catálogo com preços, margem e estoque."
        action={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Novo produto</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Total de produtos</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Total de serviços</p><p className="mt-1 text-xl font-semibold text-violet-600">{fmtNum(stats.services)}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Estoque crítico</p>
          <p className="mt-1 text-xl font-semibold text-rose-600">{fmtNum(stats.critical)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Valor em estoque</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.stockValue)}</p>
        </div>
      </div>

      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto ou SKU..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-700">Nenhum produto</p>
            <p className="mt-1 text-xs text-slate-400">Cadastre seu primeiro produto.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 text-right font-medium">Custo</th>
                  <th className="px-4 py-3 text-right font-medium">Venda</th>
                  <th className="px-4 py-3 text-right font-medium">Margem</th>
                  <th className="px-4 py-3 text-center font-medium">Estoque</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const margin = p.sale_price > 0 ? ((p.sale_price - p.cost_price) / p.sale_price) * 100 : 0;
                  const critical = (p.stock || 0) <= (p.min_stock || 0);
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.sku || '—'} {p.brand && `· ${p.brand}`}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${p.item_type === 'service' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>{p.item_type === 'service' ? 'SERVIÇO' : 'PRODUTO'}</span><span className="ml-2">{p.category || p.subcategory || '—'}</span></td>
                      <td className="px-4 py-3 text-right text-slate-500">{fmtMoney(p.cost_price)}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(p.sale_price)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{margin.toFixed(2)}%</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${critical ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                          {p.item_type === 'service' ? '—' : <>{critical && <AlertTriangle className="h-3 w-3" />}{fmtNum(p.stock)}</>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setEditing(p); setDialogOpen(true); }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => handleDelete(p.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProductDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={handleSave} initial={editing} companyId={company?.id} canManagePricing={canManagePricing} canManageCatalog={canManageCatalog} onApplyPricing={async ({ product, price, summary }) => { const updated = await applyProductPrice({ companyId: company.id, productId: product.id, newPrice: price, pricingData: { realCost: summary.realCost, targetMargin: summary.targetMargin, realMargin: summary.margin, variableRate: summary.variableRate }, canManage: canManagePricing }); await load(); return updated; }} />
    </div>
  );
}
