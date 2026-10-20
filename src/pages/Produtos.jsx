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
  const [tab, setTab] = useState('product');
  const [subcategory, setSubcategory] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState('');
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
    const normalized = query.trim().toLowerCase();
    return items.filter((p) => p.active !== false && (p.item_type || 'product') === tab && (!subcategory || p.subcategory === subcategory) && (!normalized || `${p.name || ''} ${p.sku || ''} ${p.subcategory || ''}`.toLowerCase().includes(normalized)));
  }, [items, query, tab, subcategory]);

  const handleSave = async (form) => {
    const updated = editing
      ? await productsService.update(company.id, editing.id, form)
      : await productsService.create(company.id, form);
    // Reflect the server row immediately so price, margin and stock on the
    // catalog card never depend on a stale pre-edit snapshot.
    setItems((current) => {
      if (!current) return current;
      if (editing) return current.map((item) => item.id === updated.id ? updated : item);
      return [updated, ...current];
    });
    await load();
    return updated;
  };
  const handleDelete = async (id) => {
    setActionError('');
    try {
      const result = await productsService.remove(company.id, id);
      await load();
      if (result?.archived) setActionError('Produto arquivado porque já possui histórico de vendas, estoque ou produção.');
    } catch (cause) {
      setActionError(cause?.message || 'Não foi possível excluir o produto.');
    }
  };

  const stats = useMemo(() => {
    if (!items) return { total: 0, critical: 0, stockValue: 0 };
    const currentItems = items.filter((p) => p.active !== false && (p.item_type || 'product') === tab);
    return {
      total: currentItems.length,
      available: tab === 'service' ? null : currentItems.reduce((sum, p) => sum + (Number(p.stock) || 0), 0),
      critical: tab === 'service' ? null : currentItems.filter((p) => (p.stock || 0) <= (p.min_stock || 0)).length,
      stockValue: tab === 'service' ? null : currentItems.reduce((sum, p) => sum + (Number(p.stock) || 0) * (Number(p.cost_price ?? p.cost) || 0), 0),
    };
  }, [items, tab]);

  const itemLabel = tab === 'material' ? 'matéria-prima' : tab === 'service' ? 'serviço' : 'produto';

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Catálogo"
        subtitle="Gerencie produtos, matérias-primas e serviços da empresa."
        action={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Cadastrar {itemLabel}</Button>}
      />
      {actionError && <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{actionError}</div>}

      <div className="mb-4 flex flex-wrap gap-2">{[['product','Produtos'],['material','Materiais'],['service','Serviços']].map(([key,label]) => <button key={key} type="button" onClick={() => { setTab(key); setSubcategory(''); setQuery(''); }} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${tab === key ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30' : 'border-slate-200 bg-white text-slate-600'}`}>{label} <span className="ml-1 text-xs opacity-75">{items ? items.filter((p) => p.active !== false && (p.item_type || 'product') === key).length : 0}</span></button>)}</div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Total de {tab === 'material' ? 'materiais' : tab === 'service' ? 'serviços' : 'produtos'}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{tab === 'service' ? 'Controle de estoque' : 'Unidades disponíveis'}</p><p className="mt-1 text-xl font-semibold text-violet-600">{stats.available == null ? 'Não se aplica' : fmtNum(stats.available)}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Estoque crítico</p>
          <p className="mt-1 text-xl font-semibold text-rose-600">{stats.critical == null ? 'Não se aplica' : fmtNum(stats.critical)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">{tab === 'material' ? 'Custo das matérias-primas em estoque' : 'Valor em estoque'}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.stockValue == null ? 'Não se aplica' : fmtMoney(stats.stockValue)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2"><div className="relative max-w-sm flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Buscar ${itemLabel}, código ou subcategoria...`} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400" />
      </div>{items && [...new Set(items.filter((p) => (p.item_type || 'product') === tab).map((p) => p.subcategory).filter(Boolean))].length > 0 && <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Todas as subcategorias</option>{[...new Set(items.filter((p) => (p.item_type || 'product') === tab).map((p) => p.subcategory).filter(Boolean))].sort().map((value) => <option key={value} value={value}>{value}</option>)}</select>}</div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-700">{tab === 'material' ? 'Cadastre insumos usados na produção.' : tab === 'service' ? 'Cadastre serviços e mão de obra vendáveis.' : 'Cadastre produtos acabados ou para revenda.'}</p>
            <p className="mt-1 text-xs text-slate-500">{tab === 'material' ? 'O saldo será consumido pelas ordens de produção e o custo comporá o custo do produto acabado.' : tab === 'service' ? 'Serviços não movimentam estoque.' : 'Produtos têm preço de venda e controle de estoque.'}</p>
            <Button className="mt-4" size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Cadastrar {itemLabel}</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">{tab === 'material' ? 'Matéria-prima' : tab === 'service' ? 'Serviço' : 'Produto'}</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 text-right font-medium">{tab === 'material' ? 'Custo unitário' : 'Custo'}</th>
                  {tab !== 'material' && <th className="px-4 py-3 text-right font-medium">Venda</th>}
                  {tab !== 'material' && <th className="px-4 py-3 text-right font-medium">Margem</th>}
                  <th className="px-4 py-3 text-center font-medium">{tab === 'material' ? 'Saldo interno' : 'Estoque'}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const salePrice = Number(p.sale_price ?? p.price) || 0;
                  const costPrice = Number(p.cost_price ?? p.cost) || 0;
                  const stock = Number(p.stock) || 0;
                  const minimumStock = Number(p.min_stock ?? p.minimum_stock) || 0;
                  const costUnknown = p.cost_source === 'campaign_import_unknown';
                  const margin = !costUnknown && salePrice > 0 ? ((salePrice - costPrice) / salePrice) * 100 : null;
                  const critical = stock <= minimumStock;
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.sku || '—'} {p.brand && `· ${p.brand}`}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${p.item_type === 'service' ? 'bg-violet-100 text-violet-700' : p.item_type === 'material' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{p.item_type === 'service' ? 'SERVIÇO' : p.item_type === 'material' ? 'MATERIAL' : 'PRODUTO'}</span><span className="ml-2">{p.subcategory || '—'}</span></td>
                      <td className="px-4 py-3 text-right text-slate-500">{costUnknown ? <span title="O custo não veio da origem da campanha">Não informado</span> : fmtMoney(costPrice)}</td>
                      {tab !== 'material' && <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(salePrice)}</td>}
                      {tab !== 'material' && <td className="px-4 py-3 text-right text-slate-600">{margin == null ? <span title="Margem indisponível enquanto o custo não for informado">—</span> : `${margin.toFixed(2)}%`}</td>}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${critical ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                          {p.item_type === 'service' ? '—' : <>{critical && <AlertTriangle className="h-3 w-3" />}{fmtNum(stock)}</>}
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

      <ProductDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={handleSave} initial={editing} defaultItemType={editing?.item_type || tab} fixedItemType companyId={company?.id} canManagePricing={canManagePricing} canManageCatalog={canManageCatalog} onApplyPricing={async ({ product, price, summary }) => { const updated = await applyProductPrice({ companyId: company.id, productId: product.id, newPrice: price, pricingData: { realCost: summary.realCost, targetMargin: summary.targetMargin, realMargin: summary.margin, variableRate: summary.variableRate }, canManage: canManagePricing }); await load(); return updated; }} />
    </div>
  );
}

