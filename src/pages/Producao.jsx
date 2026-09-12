// F7 PRO BUSINESS — Produção e fichas técnicas
import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Factory, Plus, Save, Play, Trash2, RefreshCw } from 'lucide-react';
import { getDataProvider } from '@/data/providerSelector';
import { productionService } from '@/services/productionService';
import { fmtMoney, fmtNum, fmtDate } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const emptyRecipe = { product_id: '', yield_quantity: 1, yield_unit: 'un', labor_cost: 0, other_cost: 0, packaging_cost: 0, overhead_cost: 0, loss_percent: 0, items: [] };
const UNIT_OPTIONS = ['un', 'm', 'cm', 'kg', 'g', 'l', 'ml'];

export default function Producao() {
  const { company } = useOutletContext();
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [recipe, setRecipe] = useState(emptyRecipe);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [produceRecipe, setProduceRecipe] = useState(null);
  const [produceQty, setProduceQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!company?.id) return;
    setLoading(true); setError('');
    try {
      const [catalog, saved, recent] = await Promise.all([
        getDataProvider().entity('Product').filter({ company_id: company.id }, 'name', 500),
        productionService.list(company.id),
        productionService.recentOrders(company.id),
      ]);
      setProducts((catalog || []).filter((item) => item.item_type !== 'service'));
      setRecipes(saved || []); setOrders(recent || []);
    } catch (cause) { setError(cause?.message || 'Não foi possível carregar a produção.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [company?.id]);

  const productsById = useMemo(() => Object.fromEntries(products.map((item) => [item.id, item])), [products]);
  const recipeCost = useMemo(() => {
    const material = recipe.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.conversion_factor || 1) * Number(productsById[item.material_product_id]?.cost_price ?? productsById[item.material_product_id]?.cost ?? 0), 0);
    const loss = material * Number(recipe.loss_percent || 0) / 100;
    return { material: material + loss, total: material + loss + Number(recipe.labor_cost || 0) + Number(recipe.other_cost || 0) + Number(recipe.packaging_cost || 0) + Number(recipe.overhead_cost || 0) };
  }, [recipe, productsById]);
  const unitCost = recipeCost.total / Math.max(0.001, Number(recipe.yield_quantity) || 1);

  const openRecipe = (saved) => {
    if (!saved) { setRecipe({ ...emptyRecipe }); setRecipeOpen(true); return; }
    setRecipe({ ...emptyRecipe, ...saved, items: (saved.items || []).map((item) => ({ material_product_id: item.material_product_id, quantity: item.quantity, unit: item.unit, conversion_factor: item.conversion_factor })) });
    setRecipeOpen(true);
  };
  const updateRecipe = (field, value) => setRecipe((current) => ({ ...current, [field]: value }));
  const addMaterial = () => setRecipe((current) => ({ ...current, items: [...current.items, { material_product_id: '', quantity: 1, unit: 'un', conversion_factor: 1 }] }));
  const updateMaterial = (index, field, value) => setRecipe((current) => ({ ...current, items: current.items.map((item, position) => position === index ? { ...item, [field]: value } : item) }));
  const removeMaterial = (index) => setRecipe((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }));
  const saveRecipe = async () => {
    if (!recipe.product_id || recipe.items.some((item) => !item.material_product_id || Number(item.quantity) <= 0)) { setError('Selecione o produto final e todas as matérias-primas.'); return; }
    setSaving(true); setError('');
    try { await productionService.saveRecipe(company.id, recipe); setRecipeOpen(false); await load(); }
    catch (cause) { setError(cause?.message || 'Não foi possível salvar a ficha técnica.'); }
    finally { setSaving(false); }
  };
  const produce = async () => {
    if (!produceRecipe || Number(produceQty) <= 0) return;
    setSaving(true); setError('');
    try { await productionService.produce(company.id, produceRecipe.id, produceQty); setProduceRecipe(null); await load(); }
    catch (cause) { setError(cause?.message || 'Não foi possível concluir a produção.'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-7xl px-5 py-8">
    <PageHeader title="Produção" subtitle="Monte fichas técnicas, calcule custo real e produza com baixa e entrada transacionais." action={<Button onClick={() => openRecipe()}><Plus className="mr-1.5 h-4 w-4" /> Nova ficha técnica</Button>} />
    {error && <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar erro">×</button></div>}
    <div className="mb-5 grid gap-4 sm:grid-cols-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Produtos com ficha técnica</p><p className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(recipes.length)}</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Produções recentes</p><p className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(orders.length)}</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Custos desatualizados</p><p className="mt-1 text-xl font-semibold text-amber-600">{fmtNum(recipes.filter((item) => item.cost_status === 'stale').length)}</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Materiais críticos</p><p className="mt-1 text-xl font-semibold text-rose-600">{fmtNum(products.filter((item) => Number(item.stock || 0) <= Number(item.min_stock || 0)).length)}</p></div>
    </div>
    {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">Carregando produção...</div> : <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900">Fichas técnicas</h2><button onClick={load} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Atualizar produção"><RefreshCw className="h-4 w-4" /></button></div>{recipes.length === 0 ? <div className="py-12 text-center text-sm text-slate-400"><Factory className="mx-auto mb-2 h-8 w-8" />Nenhuma ficha técnica cadastrada.</div> : <div className="space-y-2">{recipes.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 p-3"><div className="min-w-0 flex-1"><p className="font-medium text-slate-800">{productsById[item.product_id]?.name || 'Produto final'}</p><p className="text-xs text-slate-500">{item.items?.length || 0} materiais · custo unitário {fmtMoney(item.unit_cost)} · {item.cost_status === 'stale' ? 'Custo desatualizado' : 'Custo atual'}</p></div><Button variant="outline" size="sm" onClick={() => openRecipe(item)}>Editar</Button><Button size="sm" onClick={() => { setProduceRecipe(item); setProduceQty(1); }}><Play className="mr-1 h-3.5 w-3.5" />Produzir</Button></div>)}</div>}</section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-sm font-semibold text-slate-900">Produções recentes</h2>{orders.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Nenhuma produção realizada.</p> : <div className="space-y-2.5">{orders.slice(0, 12).map((order) => <div key={order.id} className="border-b border-slate-100 pb-2.5"><div className="flex justify-between text-sm"><span className="font-medium text-slate-700">{productsById[order.product_id]?.name || 'Produto'}</span><span className="text-emerald-600">+{fmtNum(order.quantity)}</span></div><p className="text-xs text-slate-400">Custo {fmtMoney(order.unit_cost)} · {fmtDate(order.created_at)}</p></div>)}</div>}</section>
    </div>}
    <Dialog open={recipeOpen} onOpenChange={setRecipeOpen}><DialogContent className="flex min-h-0 max-w-3xl flex-col overflow-hidden"><DialogHeader><DialogTitle>Ficha técnica</DialogTitle></DialogHeader><div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"><div className="grid gap-3 sm:grid-cols-4"><div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Produto final</Label><select value={recipe.product_id} onChange={(event) => updateRecipe('product_id', event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Selecione...</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="space-y-1.5"><Label className="text-xs">Rendimento</Label><Input type="number" min="0.001" step="0.001" value={recipe.yield_quantity} onChange={(event) => updateRecipe('yield_quantity', event.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">Unidade</Label><select value={recipe.yield_unit} onChange={(event) => updateRecipe('yield_unit', event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm">{UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}</select></div></div><div className="rounded-lg border border-slate-200"><div className="flex items-center justify-between border-b border-slate-100 p-3"><div><p className="text-sm font-semibold text-slate-800">Materiais</p><p className="text-xs text-slate-400">Produtos cadastrados podem ser usados como matéria-prima.</p></div><Button type="button" variant="outline" size="sm" onClick={addMaterial}><Plus className="mr-1 h-3.5 w-3.5" />Adicionar</Button></div>{recipe.items.length === 0 ? <p className="p-4 text-center text-xs text-slate-400">Adicione tecido, componentes ou outros materiais.</p> : <div className="divide-y divide-slate-100">{recipe.items.map((item, index) => <div key={`${index}-${item.material_product_id}`} className="grid grid-cols-[1fr_90px_64px_70px_36px] items-end gap-2 p-3"><div className="space-y-1"><Label className="text-[11px]">Material</Label><select value={item.material_product_id} onChange={(event) => updateMaterial(index, 'material_product_id', event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">Selecione...</option>{products.filter((product) => product.id !== recipe.product_id).map((product) => <option key={product.id} value={product.id}>{product.name} · {fmtMoney(product.cost_price ?? product.cost)}</option>)}</select></div><div className="space-y-1"><Label className="text-[11px]">Quantidade</Label><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateMaterial(index, 'quantity', event.target.value)} /></div><div className="space-y-1"><Label className="text-[11px]">Unidade</Label><select value={item.unit || 'un'} onChange={(event) => updateMaterial(index, 'unit', event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-1 text-xs">{UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="space-y-1"><Label className="text-[11px]">Conversão</Label><Input type="number" min="0.000001" step="0.001" value={item.conversion_factor} onChange={(event) => updateMaterial(index, 'conversion_factor', event.target.value)} /></div><button type="button" onClick={() => removeMaterial(index)} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remover material"><Trash2 className="h-4 w-4" /></button></div>)}</div>}</div><div className="grid gap-3 sm:grid-cols-4">{[['labor_cost','Mão de obra produção'],['other_cost','Outros custos'],['packaging_cost','Embalagem'],['overhead_cost','Energia/overhead']].map(([field, label]) => <div key={field} className="space-y-1.5"><Label className="text-xs">{label}</Label><Input type="number" min="0" step="0.01" value={recipe[field]} onChange={(event) => updateRecipe(field, event.target.value)} /></div>)}<div className="space-y-1.5"><Label className="text-xs">Perdas %</Label><Input type="number" min="0" max="100" step="0.01" value={recipe.loss_percent} onChange={(event) => updateRecipe('loss_percent', event.target.value)} /></div></div><div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between text-slate-500"><span>Materiais com perdas</span><span>{fmtMoney(recipeCost.material)}</span></div><div className="flex justify-between text-slate-500"><span>Custo total</span><span>{fmtMoney(recipeCost.total)}</span></div><div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-slate-900"><span>Custo por unidade</span><span>{fmtMoney(unitCost)}</span></div><p className="mt-2 text-xs text-slate-400">O custo do produto será atualizado ao salvar. O preço de venda não muda automaticamente.</p></div></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setRecipeOpen(false)}>Cancelar</Button><Button type="button" onClick={saveRecipe} disabled={saving}><Save className="mr-1.5 h-4 w-4" />{saving ? 'Salvando...' : 'Salvar ficha'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!produceRecipe} onOpenChange={() => setProduceRecipe(null)}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Produzir lote</DialogTitle></DialogHeader>{produceRecipe && <div className="space-y-4"><p className="text-sm text-slate-600">{productsById[produceRecipe.product_id]?.name || 'Produto final'}</p><div className="space-y-1.5"><Label className="text-xs">Quantidade produzida</Label><Input type="number" min="0.001" step="0.001" value={produceQty} onChange={(event) => setProduceQty(event.target.value)} /></div><p className="text-xs text-slate-500">A baixa dos materiais e a entrada do produto final são feitas na mesma transação.</p><DialogFooter><Button variant="ghost" onClick={() => setProduceRecipe(null)}>Cancelar</Button><Button onClick={produce} disabled={saving}><Play className="mr-1 h-3.5 w-3.5" />Confirmar produção</Button></DialogFooter></div>}</DialogContent></Dialog>
  </div>;
}
