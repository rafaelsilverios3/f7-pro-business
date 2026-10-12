import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Edit2, Plus, RefreshCw, Search, ShieldCheck, Slash, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { compareSupplierOffers, getSupplierOfferDisplayStatus, prepareSupplierOfferInput, SUPPLIER_OFFER_SOURCE_TYPES, SUPPLIER_OFFER_STATUS_LABELS } from '@/lib/supplierOffers';
import { supplierOffersService } from '@/services/supplierOffersService';

const SOURCE_LABELS = {
  manual: 'Cadastro manual',
  supplier_intelligence: 'Supplier Intelligence (origem declarada)',
  csv: 'CSV (origem declarada)',
  xml: 'XML (origem declarada)',
  api: 'API (origem declarada)',
};

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-700',
  pending_verification: 'bg-amber-100 text-amber-800',
  verified: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  suspended: 'bg-rose-100 text-rose-800',
  expired: 'bg-slate-200 text-slate-700',
};

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function blankForm() {
  return {
    supplier_id: '', product_id: '', unit_cost: '', currency: 'BRL', supplier_quantity: '',
    minimum_order_quantity: '1', lead_time_days: '', source_type: 'manual', source_url: '',
    source_note: '', observed_at: localDate(), valid_until: '',
  };
}

function formatMoney(value, currency) {
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`; }
}

function formatDate(value) {
  if (!value) return 'Não informada';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'Data inválida' : date.toLocaleDateString('pt-BR');
}

function offerAction(offer) {
  const status = getSupplierOfferDisplayStatus(offer);
  if (status === 'expired' && offer.status !== 'expired') return { next: 'expired', label: 'Registrar expiração', note: false };
  if (status === 'draft') return { next: 'pending_verification', label: 'Enviar para verificação', note: false };
  if (status === 'pending_verification') return { next: 'verified', label: 'Registrar verificação', note: true };
  if (status === 'verified') return { next: 'approved', label: 'Aprovar uso comercial', note: true };
  if (status === 'approved') return { next: offer.status === 'approved' ? 'suspended' : 'expired', label: offer.status === 'approved' ? 'Suspender' : 'Registrar expiração', note: offer.status === 'approved' };
  if (status === 'suspended') return { next: 'pending_verification', label: 'Reenviar para verificação', note: false };
  return null;
}

function OfferForm({ open, onOpenChange, suppliers, products, initial, busy, onSubmit }) {
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setForm(initial ? {
      supplier_id: initial.supplier_id,
      product_id: initial.product_id,
      unit_cost: String(initial.unit_cost),
      currency: initial.currency,
      supplier_quantity: initial.supplier_quantity == null ? '' : String(initial.supplier_quantity),
      minimum_order_quantity: String(initial.minimum_order_quantity),
      lead_time_days: initial.lead_time_days == null ? '' : String(initial.lead_time_days),
      source_type: initial.source_type,
      source_url: initial.source_url || '',
      source_note: initial.source_note || '',
      observed_at: initial.observed_at,
      valid_until: initial.valid_until || '',
    } : blankForm());
    setError('');
  }, [open, initial]);

  const setField = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      prepareSupplierOfferInput(form);
      await onSubmit(form);
    } catch (cause) { setError(cause?.message || 'Não foi possível salvar a oferta.'); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{initial ? 'Editar oferta de fornecedor' : 'Nova oferta de fornecedor'}</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">A quantidade abaixo é a informada pelo fornecedor, não o estoque da sua empresa. Nesta etapa, os dados são cadastrados manualmente; o campo origem registra a procedência declarada, sem ativar importações ou integrações.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium text-slate-600">Fornecedor<select required value={form.supplier_id} onChange={setField('supplier_id')} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Selecione</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Produto do catálogo<select required value={form.product_id} onChange={setField('product_id')} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Selecione</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Custo unitário<input required type="number" min="0" step="0.0001" value={form.unit_cost} onChange={setField('unit_cost')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Moeda<input required maxLength={3} value={form.currency} onChange={setField('currency')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm uppercase" placeholder="BRL" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Quantidade informada pelo fornecedor<input type="number" min="0" step="0.001" value={form.supplier_quantity} onChange={setField('supplier_quantity')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="Não informada" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Pedido mínimo<input required type="number" min="0.001" step="0.001" value={form.minimum_order_quantity} onChange={setField('minimum_order_quantity')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Prazo de fornecimento (dias)<input type="number" min="0" step="1" value={form.lead_time_days} onChange={setField('lead_time_days')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="Não informado" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Origem declarada<select value={form.source_type} onChange={setField('source_type')} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">{SUPPLIER_OFFER_SOURCE_TYPES.map((type) => <option key={type} value={type}>{SOURCE_LABELS[type]}</option>)}</select></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Data da informação<input required type="date" value={form.observed_at} onChange={setField('observed_at')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Validade da oferta<input type="date" min={form.observed_at} value={form.valid_until} onChange={setField('valid_until')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /><span className="block font-normal text-slate-400">Obrigatória para aprovar a oferta.</span></label>
        </div>
        <label className="block space-y-1 text-xs font-medium text-slate-600">Referência HTTPS (opcional)<input type="url" value={form.source_url} onChange={setField('source_url')} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="https://..." /><span className="block font-normal text-slate-400">Sem credenciais, parâmetros de consulta ou fragmentos.</span></label>
        <label className="block space-y-1 text-xs font-medium text-slate-600">Observação da origem<textarea maxLength={1000} value={form.source_note} onChange={setField('source_note')} className="min-h-20 w-full rounded-lg border border-slate-200 p-3 text-sm" placeholder="Referência, condição ou contexto informado pelo fornecedor" /></label>
        {initial && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Salvar alterações volta a oferta para rascunho e remove a aprovação atual; uma nova verificação humana será necessária.</p>}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar rascunho'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

function TransitionDialog({ transition, busy, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  useEffect(() => { setNote(''); }, [transition]);
  if (!transition) return null;
  const needsNote = transition.action.note;
  const title = transition.action.next === 'verified' ? 'Registrar verificação humana'
    : transition.action.next === 'approved' ? 'Aprovar uso comercial'
      : transition.action.next === 'suspended' ? 'Suspender oferta' : transition.action.label;
  return <Dialog open onOpenChange={onClose}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">{transition.offer.product_name} · {transition.offer.supplier_name}</p>
        {transition.action.next === 'approved' && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">A aprovação registra autorização humana para uso comercial desta oferta vigente. Não cria compra, venda, anúncio nem disponibilidade de estoque.</p>}
        {needsNote && <label className="block space-y-1 text-xs font-medium text-slate-600">Registro da decisão<textarea autoFocus required minLength={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm" placeholder="Descreva a verificação, decisão ou motivo" /></label>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={busy || (needsNote && note.trim().length < 3)} onClick={() => onConfirm(transition, note.trim() || null)}>{busy ? 'Processando...' : transition.action.label}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}

export default function SupplierOffersPanel({ company, canManage }) {
  const [offers, setOffers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [compareProductId, setCompareProductId] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [transition, setTransition] = useState(null);
  const providerReady = import.meta.env.VITE_DATA_PROVIDER === 'supabase';

  const load = useCallback(async () => {
    if (!company?.id || !providerReady) return;
    setLoading(true);
    setError('');
    try {
      const [rows, options] = await Promise.all([
        supplierOffersService.list(company.id),
        supplierOffersService.getFormOptions(company.id),
      ]);
      setOffers(rows);
      setSuppliers(options.suppliers);
      setProducts(options.products);
    } catch (cause) { setError(cause?.message || 'Não foi possível carregar as ofertas.'); }
    finally { setLoading(false); }
  }, [company?.id, providerReady]);

  useEffect(() => { load(); }, [load]);

  const today = localDate();
  const filteredOffers = useMemo(() => {
    const text = search.trim().toLocaleLowerCase('pt-BR');
    return offers.filter((offer) => {
      const status = getSupplierOfferDisplayStatus(offer, today);
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      const matchesText = !text || `${offer.product_name} ${offer.product_sku} ${offer.supplier_name}`.toLocaleLowerCase('pt-BR').includes(text);
      return matchesStatus && matchesText;
    });
  }, [offers, search, statusFilter, today]);

  const compareGroups = useMemo(() => {
    const rows = offers.filter((offer) => compareProductId === 'all' || offer.product_id === compareProductId);
    return compareSupplierOffers(rows);
  }, [offers, compareProductId]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (offer) => { setEditing(offer); setFormOpen(true); };
  const closeForm = (open) => { setFormOpen(open); if (!open) setEditing(null); };

  const save = async (form) => {
    if (!canManage) throw new Error('Seu papel não pode gerenciar ofertas.');
    setBusy(true);
    setError('');
    try {
      if (editing) await supplierOffersService.update(editing.id, form);
      else await supplierOffersService.create(company.id, form);
      setNotice(editing ? 'Oferta atualizada e devolvida para rascunho.' : 'Oferta registrada como rascunho.');
      closeForm(false);
      await load();
    } catch (cause) { throw cause; }
    finally { setBusy(false); }
  };

  const confirmTransition = async (current, note) => {
    if (!canManage) return;
    if (current.action.next === 'approved' && !window.confirm('Confirma a aprovação humana desta oferta para uso comercial?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await supplierOffersService.transition(current.offer.id, current.action.next, note);
      setNotice(`Oferta: ${SUPPLIER_OFFER_STATUS_LABELS[current.action.next]}.`);
      setTransition(null);
      await load();
    } catch (cause) { setError(cause?.message || 'Não foi possível alterar o estado da oferta.'); }
    finally { setBusy(false); }
  };

  if (!providerReady) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">A fundação de Ofertas de Fornecedores exige o provedor Supabase configurado para este ambiente. Nenhuma gravação foi tentada.</div>;

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="max-w-3xl"><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Truck className="h-5 w-5 text-indigo-600" /> Ofertas de fornecedores</h2><p className="mt-1 text-sm text-slate-600">Compare custos e condições ligados ao catálogo existente. A quantidade exibida é declarada pelo fornecedor e não altera o estoque próprio.</p><p className="mt-2 text-xs leading-5 text-slate-500">Uma oferta só fica aprovada após verificação e confirmação humana. O menor custo não é tratado como melhor opção. Ainda não são criadas compras, vendas, anúncios ou integrações automaticamente.</p></div>
      {canManage && <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> Nova oferta</Button>}
    </div>

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><Button size="sm" variant="outline" onClick={load}>Tentar novamente</Button></div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="supplier-offer-comparison-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="supplier-offer-comparison-title" className="font-semibold text-slate-900">Comparação por produto</h3><p className="mt-1 text-xs text-slate-500">Valores são agrupados por moeda. Frete, tributos e demais custos podem não estar incluídos; a comparação não escolhe um vencedor.</p></div><label className="text-xs text-slate-600">Produto<select value={compareProductId} onChange={(event) => setCompareProductId(event.target.value)} className="ml-2 h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="all">Todos</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label></div>
      {compareGroups.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Ainda não há ofertas para comparar.</p> : <div className="mt-4 grid gap-3 xl:grid-cols-2">{compareGroups.map((group) => { const first = group.offers[0]; return <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200"><div className="border-b border-slate-100 bg-slate-50 px-3 py-2"><p className="text-sm font-medium text-slate-800">{first.product_name}</p><p className="text-xs text-slate-500">Valores em {group.currency} · {group.offers.length} oferta(s)</p></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-slate-100 text-left text-slate-500"><th className="px-3 py-2">Fornecedor</th><th className="px-3 py-2">Custo / un.</th><th className="px-3 py-2">Pedido mínimo</th><th className="px-3 py-2">Prazo</th><th className="px-3 py-2">Estado</th></tr></thead><tbody>{group.offers.map((offer) => { const status = getSupplierOfferDisplayStatus(offer, today); return <tr key={offer.id} className="border-b border-slate-50 last:border-0"><td className="px-3 py-2 font-medium text-slate-800">{offer.supplier_name}</td><td className="px-3 py-2 text-slate-700">{formatMoney(offer.unit_cost, offer.currency)}</td><td className="px-3 py-2 text-slate-600">{offer.minimum_order_quantity}</td><td className="px-3 py-2 text-slate-600">{offer.lead_time_days == null ? 'Não informado' : `${offer.lead_time_days} dias`}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 ${STATUS_STYLES[status]}`}>{SUPPLIER_OFFER_STATUS_LABELS[status]}</span></td></tr>; })}</tbody></table></div></div>; })}</div>}
    </section>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Cadastro de ofertas">
      <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Buscar ofertas por produto ou fornecedor" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Produto ou fornecedor" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400" /></div><select aria-label="Filtrar ofertas por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="all">Todos os estados</option>{Object.entries(SUPPLIER_OFFER_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button variant="outline" onClick={load} disabled={loading} aria-label="Atualizar ofertas"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-500">Carregando ofertas com isolamento da empresa...</div> : !filteredOffers.length ? <div className="p-12 text-center"><p className="text-sm font-medium text-slate-700">Nenhuma oferta cadastrada.</p><p className="mt-1 text-xs text-slate-500">Cadastre uma cotação verificável vinculada a um fornecedor e a um produto do catálogo.</p>{canManage && <Button className="mt-4" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> Nova oferta</Button>}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Produto / fornecedor</th><th className="px-4 py-3">Custo e condições</th><th className="px-4 py-3">Quantidade informada</th><th className="px-4 py-3">Origem / datas</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Ações</th></tr></thead><tbody>{filteredOffers.map((offer) => { const status = getSupplierOfferDisplayStatus(offer, today); const action = offerAction(offer); return <tr key={offer.id} className="border-b border-slate-50 align-top hover:bg-slate-50/50"><td className="px-4 py-3"><p className="font-medium text-slate-800">{offer.product_name}</p><p className="text-xs text-slate-500">{offer.product_sku ? `SKU ${offer.product_sku} · ` : ''}{offer.supplier_name}</p></td><td className="px-4 py-3"><p className="font-medium text-slate-800">{formatMoney(offer.unit_cost, offer.currency)} / un.</p><p className="text-xs text-slate-500">Mínimo: {offer.minimum_order_quantity} · Prazo: {offer.lead_time_days == null ? 'não informado' : `${offer.lead_time_days} dias`}</p></td><td className="px-4 py-3 text-slate-700">{offer.supplier_quantity == null ? 'Não informada' : `${offer.supplier_quantity} un.`}<span className="mt-1 block text-[11px] text-slate-400">Declaração do fornecedor; não é estoque próprio</span></td><td className="px-4 py-3 text-xs text-slate-600"><p>{SOURCE_LABELS[offer.source_type] || offer.source_type}</p><p className="mt-1">Informada: {formatDate(offer.observed_at)}</p><p>Válida até: {formatDate(offer.valid_until)}</p>{offer.verified_at && <p>Verificada: {new Date(offer.verified_at).toLocaleString('pt-BR')}</p>}{offer.source_url && <a className="mt-1 block text-indigo-700 underline" href={offer.source_url} target="_blank" rel="noreferrer">Abrir referência pública</a>}{offer.verification_note && <p className="mt-1 max-w-56 break-words text-slate-500">{offer.verification_note}</p>}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>{SUPPLIER_OFFER_STATUS_LABELS[status]}</span>{status === 'approved' && <p className="mt-1 text-[11px] text-emerald-700"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Uso comercial autorizado</p>}{status === 'pending_verification' && <p className="mt-1 text-[11px] text-amber-700"><Clock3 className="mr-1 inline h-3.5 w-3.5" />Aguardando pessoa responsável</p>}</td><td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-1">{canManage && <><button type="button" title="Editar dados; a oferta voltará para rascunho" aria-label={`Editar oferta de ${offer.product_name}`} onClick={() => openEdit(offer)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><Edit2 className="h-4 w-4" /></button>{action && <button type="button" title={action.label} aria-label={action.label} onClick={() => setTransition({ offer, action })} className="rounded-md p-2 text-indigo-700 hover:bg-indigo-50">{action.next === 'approved' || action.next === 'verified' ? <Check className="h-4 w-4" /> : action.next === 'suspended' ? <Slash className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</button>}</>}</div></td></tr>; })}</tbody></table></div>}
    </section>

    <OfferForm open={formOpen} onOpenChange={closeForm} suppliers={suppliers} products={products} initial={editing} busy={busy} onSubmit={save} />
    <TransitionDialog transition={transition} busy={busy} onClose={() => setTransition(null)} onConfirm={confirmTransition} />
  </section>;
}
