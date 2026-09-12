import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BadgeDollarSign, Search } from 'lucide-react';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { productsRepository } from '@/data/repositories/productsRepository';
import { can } from '@/lib/permissions';
import { applyProductPrice } from '@/services/pricingService';
import { fmtMoney } from '@/lib/business';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/layout/PageHeader';
import PricingDialog from '@/components/pricing/PricingDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function Precificacao() {
  const { company } = useOutletContext(); const { user } = useAuth(); const [products, setProducts] = useState([]); const [role, setRole] = useState(''); const [query, setQuery] = useState(''); const [selected, setSelected] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const canManage = can({ role }, 'pricing.manage');
  const load = async () => { if (!company?.id) return; setLoading(true); try { setProducts(await productsRepository.list(company.id, 'name', 500)); } catch (cause) { setError(cause.message || 'Não foi possível carregar produtos.'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [company?.id]);
  useEffect(() => { let cancelled = false; if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id || !user?.id) { setRole(user?.role || ''); return undefined; } getSupabaseClient().from('company_users').select('role').eq('company_id', company.id).eq('user_id', user.id).eq('active', true).maybeSingle().then(({ data }) => { if (!cancelled) setRole(data?.role || ''); }); return () => { cancelled = true; }; }, [company?.id, user?.id, user?.role]);
  const filtered = products.filter((product) => `${product.name} ${product.sku || ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const applyPricing = async ({ price, summary }) => {
    const updated = await applyProductPrice({ companyId: company.id, productId: selected.id, newPrice: price, pricingData: { realCost: summary.realCost, targetMargin: summary.targetMargin, realMargin: summary.margin, variableRate: summary.variableRate }, canManage });
    setProducts((current) => current.map((item) => item.id === selected.id ? { ...item, ...updated, cost: updated.cost, cost_price: updated.cost, price: updated.price, sale_price: updated.price } : item));
    setSelected((current) => current ? { ...current, ...updated, cost: updated.cost, cost_price: updated.cost, price: updated.price, sale_price: updated.price } : current);
    return updated;
  };
  return <div className="mx-auto max-w-6xl px-5 py-8"><PageHeader title="Precificação" subtitle="Calcule custo real, margem, markup e cenários de preço com dados do seu produto." /><div className="mb-5 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800"><BadgeDollarSign className="h-5 w-5" /><span>Motor determinístico baseado nos custos informados. Não há análise de mercado ou IA nesta etapa.</span></div><div className="mb-4 relative max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto ou SKU" className="pl-9" /></div>{error && <p className="mb-4 text-sm text-rose-600">{error}</p>}<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{loading ? <div className="p-12 text-center text-sm text-slate-400">Carregando produtos...</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Produto</th><th className="px-4 py-3 text-right">Custo atual</th><th className="px-4 py-3 text-right">Preço atual</th><th className="px-4 py-3 text-right">Margem simples</th><th className="px-4 py-3" /></tr></thead><tbody>{filtered.map((product) => { const cost = Number(product.cost_price ?? product.cost) || 0; const price = Number(product.sale_price ?? product.price) || 0; const margin = price > 0 ? ((price - cost) / price) * 100 : 0; return <tr key={product.id} className="border-b border-slate-50"><td className="px-4 py-3"><p className="font-medium text-slate-800">{product.name}</p><p className="text-xs text-slate-400">{product.sku || 'Sem SKU'}</p></td><td className="px-4 py-3 text-right text-slate-500">{fmtMoney(cost)}</td><td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtMoney(price)}</td><td className="px-4 py-3 text-right text-slate-600">{margin.toFixed(1)}%</td><td className="px-4 py-3 text-right"><Button type="button" variant="outline" size="sm" onClick={() => setSelected(product)}>Calcular preço</Button></td></tr>; })}</tbody></table>{filtered.length === 0 && <div className="p-10 text-center text-sm text-slate-400">Nenhum produto encontrado.</div>}</div>}</div><PricingDialog open={!!selected} onClose={() => setSelected(null)} product={selected} canManage={canManage} onApply={applyPricing} /></div>;
}
