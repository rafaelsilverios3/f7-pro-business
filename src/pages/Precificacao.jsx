import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BadgeDollarSign, Search } from 'lucide-react';
import { productsRepository } from '@/data/repositories/productsRepository';
import { can } from '@/lib/permissions';
import { applyProductPrice } from '@/services/pricingService';
import { supplierOffersService } from '@/services/supplierOffersService';
import { salesHubService } from '@/services/salesHubService';
import { fmtMoney } from '@/lib/business';
import { useAuth } from '@/lib/AuthContext';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';
import PageHeader from '@/components/layout/PageHeader';
import PricingDialog from '@/components/pricing/PricingDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const OFFER_READ_ROLES = ['admin', 'gestor', 'estoque'];

export default function Precificacao() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const membership = useCompanyMembership(company?.id);
  const role = membership.role;
  const membershipReady = membership.companyId === company?.id && membership.active;
  const canManage = membershipReady && can({ role }, 'pricing.manage');
  const canReadSupplierOffers = import.meta.env.VITE_DATA_PROVIDER === 'supabase'
    && membershipReady
    && can({ role }, 'purchases.view')
    && OFFER_READ_ROLES.includes(role);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [supplierOffers, setSupplierOffers] = useState([]);
  const [supplierOffersLoading, setSupplierOffersLoading] = useState(false);
  const [supplierOffersError, setSupplierOffersError] = useState('');
  const [salesChannels, setSalesChannels] = useState([]);
  const [productChannelLinks, setProductChannelLinks] = useState([]);
  const [productsCompanyId, setProductsCompanyId] = useState(null);
  const [referencesCompanyId, setReferencesCompanyId] = useState(null);
  const productsRequest = useRef(0);
  const referencesRequest = useRef(0);

  const loadProducts = useCallback(async () => {
    const request = ++productsRequest.current;
    if (!company?.id) {
      setProducts([]);
      setProductsCompanyId(null);
      setLoading(false);
      return;
    }
    const requestedCompanyId = company.id;
    setLoading(true);
    setError('');
    try {
      const rows = (await productsRepository.list(requestedCompanyId, 'name', 500)).filter((product) => product.item_type === 'product' || product.item_type === 'service');
      if (request === productsRequest.current) {
        setProducts(rows);
        setProductsCompanyId(requestedCompanyId);
      }
    } catch (cause) {
      if (request === productsRequest.current) setError(cause.message || 'Não foi possível carregar produtos.');
    } finally {
      if (request === productsRequest.current) setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const loadPricingReferences = useCallback(async () => {
    const request = ++referencesRequest.current;
    const requestedCompanyId = company?.id;
    if (!canReadSupplierOffers || !requestedCompanyId || !user?.id) {
      setSupplierOffers([]);
      setSalesChannels([]);
      setProductChannelLinks([]);
      setReferencesCompanyId(null);
      setSupplierOffersError('');
      setSupplierOffersLoading(false);
      return;
    }
    setReferencesCompanyId(null);
    setSupplierOffersLoading(true);
    setSupplierOffersError('');
    try {
      const [offers, channels, links] = await Promise.all([
        supplierOffersService.list(requestedCompanyId),
        salesHubService.listChannels(requestedCompanyId),
        salesHubService.listLinks(requestedCompanyId),
      ]);
      if (request === referencesRequest.current) {
        setSupplierOffers(offers);
        setSalesChannels(channels);
        setProductChannelLinks(links);
        setReferencesCompanyId(requestedCompanyId);
      }
    } catch (cause) {
      if (request === referencesRequest.current) {
        setReferencesCompanyId(requestedCompanyId);
        setSupplierOffersError(cause.message || 'Não foi possível carregar as referências comerciais.');
        setSupplierOffers([]);
        setSalesChannels([]);
        setProductChannelLinks([]);
      }
    } finally {
      if (request === referencesRequest.current) setSupplierOffersLoading(false);
    }
  }, [canReadSupplierOffers, company?.id, user?.id]);

  useEffect(() => { loadPricingReferences(); }, [loadPricingReferences]);

  const visibleProducts = productsCompanyId === company?.id ? products : [];
  const referencesAreCurrent = referencesCompanyId === company?.id && membershipReady;
  const filtered = useMemo(() => visibleProducts.filter((product) => `${product.name} ${product.sku || ''}`.toLowerCase().includes(query.toLowerCase().trim())), [visibleProducts, query]);

  const applyPricing = async ({ price, summary }) => {
    const updated = await applyProductPrice({
      companyId: company.id,
      productId: selected.id,
      newPrice: price,
      pricingData: { realCost: summary.realCost, targetMargin: summary.targetMargin, realMargin: summary.margin, variableRate: summary.variableRate },
      canManage,
    });
    setProducts((current) => current.map((item) => item.id === selected.id ? { ...item, ...updated, cost: updated.cost, cost_price: updated.cost, price: updated.price, sale_price: updated.price } : item));
    setSelected((current) => current ? { ...current, ...updated, cost: updated.cost, cost_price: updated.cost, price: updated.price, sale_price: updated.price } : current);
    return updated;
  };

  return <div className="mx-auto max-w-6xl px-5 py-8">
    <PageHeader title="Precificação" subtitle="Calcule custo real, margem, markup e cenários de preço com dados do seu produto e referências aprovadas de fornecedores." />
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800"><BadgeDollarSign className="h-5 w-5" /><span>Motor determinístico. A simulação com ofertas não salva preços, não cria compras e não trata disponibilidade externa como estoque.</span></div>
    <div className="mb-4 relative max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto ou SKU" className="pl-9" /></div>
    {error && <p role="alert" className="mb-4 text-sm text-rose-600">{error} <Button type="button" size="sm" variant="outline" onClick={loadProducts}>Tentar novamente</Button></p>}
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {loading ? <div className="p-12 text-center text-sm text-slate-400">Carregando produtos...</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Produto</th><th className="px-4 py-3 text-right">Custo atual</th><th className="px-4 py-3 text-right">Preço atual</th><th className="px-4 py-3 text-right">Margem simples</th><th className="px-4 py-3" /></tr></thead><tbody>{filtered.map((product) => { const cost = Number(product.cost_price ?? product.cost) || 0; const price = Number(product.sale_price ?? product.price) || 0; const margin = price > 0 ? ((price - cost) / price) * 100 : 0; return <tr key={product.id} className="border-b border-slate-50"><td className="px-4 py-3"><p className="font-medium text-slate-800">{product.name}</p><p className="text-xs text-slate-400">{product.sku || 'Sem SKU'}</p></td><td className="px-4 py-3 text-right text-slate-500">{fmtMoney(cost)}</td><td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtMoney(price)}</td><td className="px-4 py-3 text-right text-slate-600">{margin.toFixed(2)}%</td><td className="px-4 py-3 text-right"><Button type="button" variant="outline" size="sm" onClick={() => setSelected(product)}>Calcular preço</Button></td></tr>; })}</tbody></table>{filtered.length === 0 && <div className="p-10 text-center text-sm text-slate-400">Nenhum produto encontrado.</div>}</div>}
    </div>
    <PricingDialog
      open={!!selected}
      onClose={() => setSelected(null)}
      product={selected}
      companyId={company?.id}
      canManage={canManage}
      canReadSupplierOffers={canReadSupplierOffers}
      supplierOffers={referencesAreCurrent ? supplierOffers : []}
      supplierOffersLoading={canReadSupplierOffers && (!referencesAreCurrent || supplierOffersLoading)}
      supplierOffersError={referencesAreCurrent ? supplierOffersError : ''}
      onRetrySupplierOffers={loadPricingReferences}
      salesChannels={referencesAreCurrent ? salesChannels : []}
      productChannelLinks={referencesAreCurrent ? productChannelLinks : []}
      onApply={applyPricing}
    />
  </div>;
}
