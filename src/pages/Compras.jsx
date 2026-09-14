import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { AlertTriangle, BrainCircuit, ChevronLeft, ChevronRight, Edit2, Eye, PackageCheck, Plus, Search, Trash2, Truck } from 'lucide-react';
import { suppliersRepository } from '@/data/repositories/suppliersRepository';
import { purchasesService } from '@/services/purchasesService';
import { fmtDate, fmtMoney, fmtNum } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import SupplierDialog from '@/components/compras/SupplierDialog';
import PurchaseDialog from '@/components/compras/PurchaseDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/AuthContext';
import { usePermissions } from '@/lib/permissions';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';

const PO_STATUS_STYLE = { draft: 'bg-slate-100 text-slate-700', pending: 'bg-amber-100 text-amber-700', partial: 'bg-blue-100 text-blue-700', approved: 'bg-indigo-100 text-indigo-700', sent: 'bg-violet-100 text-violet-700', received: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-rose-100 text-rose-700' };
const PO_STATUS_LABEL = { draft: 'Rascunho', pending: 'Pendente', partial: 'Parcial', approved: 'Aprovado', sent: 'Enviado', received: 'Recebido', cancelled: 'Cancelado' };
const PAGE_SIZE = 12;

function PriorityBadge({ value }) {
  const tone = value === 'Alta' ? 'bg-rose-100 text-rose-700' : value === 'Média' ? 'bg-amber-100 text-amber-700' : value === 'Baixa' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700';
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tone}`}>{value}</span>;
}

function Pagination({ page, total, onChange, label }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>{total} registro(s) · página {page} de {pages}</span><div className="flex gap-1"><button type="button" aria-label={`Página anterior de ${label}`} disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label={`Próxima página de ${label}`} disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>;
}

export default function Compras() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const membership = useCompanyMembership(company?.id);
  const permissionUser = membership.loading
    ? null
    : {
      ...user,
      // In Supabase, role is tenant membership data, never Auth metadata.
      role: import.meta.env.VITE_DATA_PROVIDER === 'supabase'
        ? (membership.active ? membership.role : '')
        : (membership.role || user?.role || ''),
    };
  const { can } = usePermissions(permissionUser);
  const navigate = useNavigate();
  const canManage = can('purchases.manage');
  const canUseSupplierSearch = can('supplier_intelligence.view');
  const canUseIntelligence = can('intelligence.view');
  const [tab, setTab] = useState('replenishment');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [demandDays, setDemandDays] = useState(30);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [demandFilter, setDemandFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [replenishmentPage, setReplenishmentPage] = useState(1);
  const [purchaseStatus, setPurchaseStatus] = useState('all');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchasePage, setPurchasePage] = useState(1);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [purchaseDialog, setPurchaseDialog] = useState(false);
  const [purchaseSuggestion, setPurchaseSuggestion] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    setError('');
    try { setData(await purchasesService.listIntelligence(company.id, { demandDays })); }
    catch (cause) { setError(cause?.message || 'Não foi possível carregar a central de compras.'); }
    finally { setLoading(false); }
  }, [company?.id, demandDays]);
  useEffect(() => { load(); }, [load]);

  const analysis = data?.analysis;
  const needs = analysis?.rows || [];
  const supplierNames = useMemo(() => [...new Set(needs.flatMap((row) => row.suppliers.map((supplier) => supplier.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [needs]);
  const filteredNeeds = useMemo(() => {
    const text = search.trim().toLocaleLowerCase('pt-BR');
    return needs.filter((row) => {
      const matchesText = !text || `${row.name} ${row.sku || ''}`.toLocaleLowerCase('pt-BR').includes(text);
      const matchesPriority = priorityFilter === 'all' || row.priority_key === priorityFilter;
      const matchesStock = stockFilter === 'all' || stockFilter === 'zero' && row.stock <= 0 || stockFilter === 'below' && row.minimum_configured && row.stock < row.minimum_stock;
      const matchesDemand = demandFilter === 'all' || demandFilter === 'with' && row.demand_quantity > 0 || demandFilter === 'without' && row.demand_quantity === 0;
      const matchesSupplier = supplierFilter === 'all' || supplierFilter === 'none' && row.suppliers.length === 0 || row.suppliers.some((supplier) => supplier.name === supplierFilter);
      return matchesText && matchesPriority && matchesStock && matchesDemand && matchesSupplier;
    });
  }, [needs, search, priorityFilter, stockFilter, demandFilter, supplierFilter]);
  const visibleNeeds = filteredNeeds.slice((replenishmentPage - 1) * PAGE_SIZE, replenishmentPage * PAGE_SIZE);
  const purchases = data?.purchases || [];
  const filteredPurchases = useMemo(() => {
    const text = purchaseSearch.trim().toLocaleLowerCase('pt-BR');
    return purchases.filter((purchase) => (!text || `${purchase.supplier_name} ${purchase.id}`.toLocaleLowerCase('pt-BR').includes(text)) && (purchaseStatus === 'all' || purchase.status === purchaseStatus));
  }, [purchases, purchaseSearch, purchaseStatus]);
  const visiblePurchases = filteredPurchases.slice((purchasePage - 1) * PAGE_SIZE, purchasePage * PAGE_SIZE);
  const suppliers = data?.suppliers || [];
  const filteredSuppliers = suppliers.filter((supplier) => `${supplier.name} ${supplier.document || ''}`.toLocaleLowerCase('pt-BR').includes(supplierSearch.trim().toLocaleLowerCase('pt-BR')));
  const visibleSuppliers = filteredSuppliers.slice((supplierPage - 1) * PAGE_SIZE, supplierPage * PAGE_SIZE);
  const poStats = useMemo(() => ({
    count: purchases.length,
    total: purchases.filter((purchase) => purchase.status !== 'cancelled').reduce((sum, purchase) => sum + Number(purchase.total || 0), 0),
    open: purchases.filter((purchase) => ['pending', 'partial', 'approved', 'sent', 'ordered', 'confirmed', 'in_transit'].includes(purchase.status)).length,
  }), [purchases]);
  const urgentCount = needs.filter((row) => row.priority_key === 'high').length;
  const zeroCount = needs.filter((row) => row.stock <= 0).length;

  useEffect(() => { setReplenishmentPage(1); }, [search, priorityFilter, stockFilter, demandFilter, supplierFilter, demandDays]);
  useEffect(() => { setPurchasePage(1); }, [purchaseSearch, purchaseStatus]);
  useEffect(() => { setSupplierPage(1); }, [supplierSearch]);

  const handleReceive = async (purchase) => {
    if (!canManage || !window.confirm('Confirmar recebimento? O estoque será atualizado e uma conta a pagar será gerada.')) return;
    try { await purchasesService.receive(purchase); await load(); }
    catch (cause) { setError(cause?.message || 'Não foi possível registrar o recebimento.'); }
  };
  const handleDeleteSupplier = async (supplier) => {
    if (!canManage || !window.confirm('Excluir fornecedor?')) return;
    try { await suppliersRepository.remove(supplier.id, company.id); await load(); }
    catch (cause) { setError(cause?.message || 'Não foi possível excluir o fornecedor.'); }
  };
  const openSupplierSearch = (row) => navigate('/supplier-intelligence', { state: { query: `Encontrar fornecedores para ${row.name}${row.sku ? ` (${row.sku})` : ''}`, context: { source_module: 'purchases', product_id: row.product_id, product_name: row.name, quantity_context: row.suggested_quantity, company_id: company.id, intent: 'supplier_research', return_path: '/compras' } } });
  const openAnalysis = (row) => navigate('/intelligence', { state: { query: `Analise a reposição do produto ${row.name}. Explique demanda, estoque, compras abertas e riscos sem inventar dados.`, context: { source_module: 'purchases', product_id: row.product_id, period: demandDays, stock: row.stock, minimum_stock: row.minimum_stock, demand_quantity: row.demand_quantity, open_purchase_quantity: row.open_purchase_quantity, suggested_quantity: row.suggested_quantity } } });
  const openPurchaseSuggestion = (row) => { setPurchaseSuggestion(row); setPurchaseDialog(true); };
  const closePurchaseDialog = () => { setPurchaseDialog(false); setPurchaseSuggestion(null); };

  return <div className="mx-auto w-full max-w-7xl min-w-0 px-4 py-6 sm:px-5 sm:py-8">
    <PageHeader title="Compras e Reposição" subtitle="Entenda o que precisa de atenção antes de preparar uma compra." action={tab === 'suppliers' ? <Button disabled={!canManage} onClick={() => { setEditingSupplier(null); setSupplierDialog(true); }}><Plus className="mr-1.5 h-4 w-4" /> Novo fornecedor</Button> : <Button disabled={!canManage} onClick={() => setPurchaseDialog(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova compra</Button>} />
    {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><Button size="sm" variant="outline" onClick={load}>Tentar novamente</Button></div>}
    <div className="mb-5 flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Seções de compras">{[['replenishment', 'Reposição inteligente'], ['purchases', 'Pedidos de compra'], ['suppliers', 'Fornecedores']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-500'}`}>{label}</button>)}</div>
    {tab === 'replenishment' && <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Itens em atenção', needs.length, 'text-slate-900'], ['Prioridade alta', urgentCount, 'text-rose-600'], ['Estoque zero', zeroCount, 'text-amber-600'], ['Compras abertas', analysis?.open_purchase_count || 0, 'text-blue-600']].map(([label, value, tone]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold ${tone}`}>{fmtNum(value)}</p></div>)}</div>
      <section className="mb-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-[#0e1a2b] via-[#182b52] to-indigo-900 p-4 text-white shadow-lg sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Truck className="h-5 w-5 text-indigo-200" /> Precisa repor?</h2><p className="mt-1 text-xs text-indigo-100/80">Análise determinística com estoque, demanda e pedidos existentes. Nenhuma compra é criada automaticamente.</p></div><label className="flex items-center gap-2 text-xs text-indigo-100">Demanda<select value={demandDays} onChange={(event) => setDemandDays(Number(event.target.value))} className="rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-white"><option value="30" className="text-slate-900">30 dias</option><option value="90" className="text-slate-900">90 dias</option><option value="365" className="text-slate-900">Ano</option></select></label></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><input aria-label="Buscar produto ou SKU" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Produto ou SKU" className="min-w-0 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-indigo-100/60" /><select aria-label="Filtrar prioridade" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"><option value="all" className="text-slate-900">Todas as prioridades</option><option value="high" className="text-slate-900">Alta</option><option value="medium" className="text-slate-900">Média</option><option value="low" className="text-slate-900">Baixa</option></select><select aria-label="Filtrar estoque" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"><option value="all" className="text-slate-900">Todos os estoques</option><option value="zero" className="text-slate-900">Estoque zero</option><option value="below" className="text-slate-900">Abaixo do mínimo</option></select><select aria-label="Filtrar demanda" value={demandFilter} onChange={(event) => setDemandFilter(event.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"><option value="all" className="text-slate-900">Com ou sem demanda</option><option value="with" className="text-slate-900">Com demanda</option><option value="without" className="text-slate-900">Sem demanda</option></select><select aria-label="Filtrar fornecedor" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"><option value="all" className="text-slate-900">Todos os fornecedores</option><option value="none" className="text-slate-900">Sem fornecedor vinculado</option>{supplierNames.map((name) => <option key={name} value={name} className="text-slate-900">{name}</option>)}</select></div></section>
      {loading && <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">Analisando estoque, demanda e compras abertas...</div>}
      {!loading && visibleNeeds.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><p className="text-sm font-medium text-slate-700">Nenhum item requer reposição neste período.</p><p className="mt-1 text-xs text-slate-400">Itens sem estoque mínimo configurado não recebem uma quantidade inventada.</p></div>}
      {!loading && visibleNeeds.length > 0 && <><div className="grid gap-4 lg:grid-cols-2">{visibleNeeds.map((row) => <article key={row.product_id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-base font-semibold text-slate-900">{row.name}</h3><p className="mt-0.5 text-xs text-slate-500">{row.sku ? `SKU ${row.sku}` : 'SKU não informado'}</p></div><PriorityBadge value={row.priority} /></div><p className="mt-3 flex gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />{row.reason}</p><dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3"><div><dt className="text-slate-400">Estoque atual</dt><dd className="mt-1 font-semibold text-slate-800">{fmtNum(row.stock)}</dd></div><div><dt className="text-slate-400">Estoque mínimo</dt><dd className="mt-1 font-semibold text-slate-800">{row.minimum_configured ? fmtNum(row.minimum_stock) : 'Não configurado'}</dd></div><div><dt className="text-slate-400">Demanda ({row.demand_days}d)</dt><dd className="mt-1 font-semibold text-slate-800">{fmtNum(row.demand_quantity)} un · {fmtNum(row.demand_sales_count)} venda(s)</dd></div><div><dt className="text-slate-400">Em compra</dt><dd className="mt-1 font-semibold text-slate-800">{row.partial_receipt_unknown ? 'Parcial · saldo indisponível' : `${fmtNum(row.open_purchase_quantity || 0)} un`}</dd></div><div><dt className="text-slate-400">Estoque projetado</dt><dd className="mt-1 font-semibold text-slate-800">{row.projected_stock === null ? 'Indisponível' : fmtNum(row.projected_stock)}</dd></div><div><dt className="text-slate-400">Quantidade mínima para recompor</dt><dd className="mt-1 font-semibold text-slate-800">{row.suggested_quantity === null ? 'Indisponível' : fmtNum(row.suggested_quantity)}</dd></div></dl><div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><span className="mr-auto text-xs text-slate-500">{row.suppliers.length ? `Fornecedor: ${row.suppliers.map((supplier) => supplier.name).join(', ')}` : 'Nenhum fornecedor vinculado'}</span>{canUseIntelligence && <Button size="sm" variant="outline" onClick={() => openAnalysis(row)}><BrainCircuit className="mr-1.5 h-3.5 w-3.5" /> Analisar</Button>}{canUseSupplierSearch && <Button size="sm" variant="outline" onClick={() => openSupplierSearch(row)}><Search className="mr-1.5 h-3.5 w-3.5" /> Pesquisar fornecedor</Button>}{canManage && row.suggested_quantity > 0 && <Button size="sm" onClick={() => openPurchaseSuggestion(row)}>Preparar compra</Button>}</div>{row.last_purchase && <p className="mt-2 text-[11px] text-slate-400">Último custo: {row.last_purchase.cost == null ? 'indisponível' : fmtMoney(row.last_purchase.cost)} · {row.last_purchase.date ? `registrado em ${fmtDate(row.last_purchase.date)}` : 'data indisponível'}</p>}</article>)}</div><Pagination page={replenishmentPage} total={filteredNeeds.length} onChange={setReplenishmentPage} label="reposição" /></>}
    </>}
    {tab === 'purchases' && <><div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Pedidos</p><p className="mt-1 text-xl font-semibold text-slate-900">{poStats.count}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Valor total</p><p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(poStats.total)}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Em aberto</p><p className="mt-1 text-xl font-semibold text-amber-600">{poStats.open}</p></div></div><div className="mb-4 flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Buscar pedidos de compra" value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} placeholder="Buscar por fornecedor ou pedido" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400" /></div><select aria-label="Filtrar status do pedido" value={purchaseStatus} onChange={(event) => setPurchaseStatus(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="all">Todos os status</option>{Object.entries(PO_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{loading && !data ? <div className="p-12 text-center text-sm text-slate-400">Carregando pedidos...</div> : !visiblePurchases.length ? <div className="p-12 text-center"><p className="text-sm font-medium text-slate-700">Nenhum pedido de compra encontrado.</p><p className="mt-1 text-xs text-slate-400">Use a reposição inteligente para revisar itens antes de criar um pedido.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3 font-medium">Fornecedor</th><th className="px-4 py-3 font-medium">Previsão</th><th className="px-4 py-3 text-right font-medium">Total</th><th className="px-4 py-3 text-center font-medium">Status</th><th className="px-4 py-3" /></tr></thead><tbody>{visiblePurchases.map((purchase) => <tr key={purchase.id} className="border-b border-slate-50 hover:bg-slate-50/50"><td className="px-4 py-3 font-medium text-slate-800">{purchase.supplier_name}</td><td className="px-4 py-3 text-slate-500">{fmtDate(purchase.expected_date)}</td><td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(purchase.total)}</td><td className="px-4 py-3 text-center"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PO_STATUS_STYLE[purchase.status] || 'bg-slate-100 text-slate-700'}`}>{PO_STATUS_LABEL[purchase.status] || purchase.status || 'Indisponível'}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" aria-label="Ver pedido" onClick={() => setViewing(purchase)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>{canManage && ['pending', 'approved', 'sent'].includes(purchase.status) && <button type="button" aria-label="Receber pedido" onClick={() => handleReceive(purchase)} title="Receber" className="rounded-md p-1.5 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"><PackageCheck className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div>}<Pagination page={purchasePage} total={filteredPurchases.length} onChange={setPurchasePage} label="pedidos" /></div></>}
    {tab === 'suppliers' && <><div className="mb-4 relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Buscar fornecedores" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder="Buscar fornecedor ou documento" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400" /></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{loading && !data ? <div className="p-12 text-center text-sm text-slate-400">Carregando fornecedores...</div> : !visibleSuppliers.length ? <div className="p-12 text-center"><p className="text-sm font-medium text-slate-700">Nenhum fornecedor cadastrado.</p><p className="mt-1 text-xs text-slate-400">Cadastre um fornecedor para preparar pedidos com confirmação humana.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3 font-medium">Fornecedor</th><th className="px-4 py-3 font-medium">Contato</th><th className="px-4 py-3 font-medium">Telefone</th><th className="px-4 py-3" /></tr></thead><tbody>{visibleSuppliers.map((supplier) => <tr key={supplier.id} className="border-b border-slate-50 hover:bg-slate-50/50"><td className="px-4 py-3 font-medium text-slate-800">{supplier.name}<span className="block text-xs font-normal text-slate-400">{supplier.document || 'Documento indisponível'}</span></td><td className="px-4 py-3 text-slate-500">{supplier.email || 'Contato indisponível'}</td><td className="px-4 py-3 text-slate-500">{supplier.phone || 'Indisponível'}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{canManage && <><button type="button" aria-label="Editar fornecedor" onClick={() => { setEditingSupplier(supplier); setSupplierDialog(true); }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Edit2 className="h-4 w-4" /></button><button type="button" aria-label="Excluir fornecedor" onClick={() => handleDeleteSupplier(supplier)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div>}<Pagination page={supplierPage} total={filteredSuppliers.length} onChange={setSupplierPage} label="fornecedores" /></div></>}
    <SupplierDialog open={supplierDialog} onClose={() => { setSupplierDialog(false); setEditingSupplier(null); }} company={company} onDone={load} editing={editingSupplier} />
    <PurchaseDialog open={purchaseDialog} onClose={closePurchaseDialog} company={company} onDone={load} suggestion={purchaseSuggestion} />
    <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}><DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>Compra — {viewing?.supplier_name}</DialogTitle></DialogHeader>{viewing && <div className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-slate-500">Previsão</span><span>{fmtDate(viewing.expected_date)}</span></div><div className="rounded-lg border border-slate-200"><table className="w-full text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-500"><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Qtd</th><th className="px-3 py-2 text-right font-medium">Custo</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead><tbody>{(viewing.items || []).map((item, index) => <tr key={item.id || index} className="border-b border-slate-50"><td className="px-3 py-2">{item.name || item.product_id}</td><td className="px-3 py-2 text-center">{item.qty ?? item.quantity}</td><td className="px-3 py-2 text-right">{fmtMoney(item.cost)}</td><td className="px-3 py-2 text-right">{fmtMoney((item.qty ?? item.quantity) * item.cost)}</td></tr>)}</tbody></table></div><div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(viewing.total)}</span></div>{canManage && ['pending', 'approved', 'sent'].includes(viewing.status) && <Button onClick={() => { handleReceive(viewing); setViewing(null); }} className="w-full bg-emerald-600 hover:bg-emerald-700"><PackageCheck className="mr-1.5 h-4 w-4" /> Confirmar recebimento</Button>}</div>}</DialogContent></Dialog>
  </div>;
}
