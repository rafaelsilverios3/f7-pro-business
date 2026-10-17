import React from 'react';
import { ArrowLeft, ExternalLink, ImageOff, Loader2, Package, RefreshCw, Search, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/useCompany';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';
import { companyMembershipGateState } from '@/lib/companyMembershipGate';
import { can } from '@/lib/permissions';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { buildMeliListingFacets, safeMeliImageUrl, safeMeliPermalink } from '../../supabase/functions/_shared/mercadolivreCatalog.js';
import { mercadoLivreAction, mercadoLivreErrorMessage } from '@/services/mercadoLivreService';

const PAGE_SIZE = 24;
const FACET_PAGE_SIZE = 1000;
const SORTS = [
  ['updated_desc', 'Atualização mais recente'], ['updated_asc', 'Atualização mais antiga'],
  ['price_asc', 'Menor preço'], ['price_desc', 'Maior preço'], ['title_asc', 'Título A–Z'], ['title_desc', 'Título Z–A'],
];
const STATUS_LABELS = { active: 'Ativo', paused: 'Pausado', closed: 'Finalizado', under_review: 'Em revisão', inactive: 'Inativo', unknown: 'Desconhecido' };
const currencyFormatters = new Map();

function money(value, currency = 'BRL') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Preço não informado';
  try {
    if (!currencyFormatters.has(currency)) currencyFormatters.set(currency, new Intl.NumberFormat('pt-BR', { style: 'currency', currency }));
    return currencyFormatters.get(currency).format(amount);
  } catch { return `${currency} ${amount.toLocaleString('pt-BR')}`; }
}

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function ImageBlock({ listing, compact = false }) {
  const [failed, setFailed] = React.useState(false);
  const imageUrl = safeMeliImageUrl({ secure_thumbnail: listing.image_url });
  return <div className={`flex ${compact ? 'h-44' : 'h-56'} items-center justify-center bg-slate-100`}>
    {imageUrl && !failed
      ? <img src={imageUrl} alt={listing.title || `Anúncio ${listing.external_item_id}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-3" />
      : <div className="flex flex-col items-center gap-2 text-slate-400"><ImageOff className="h-8 w-8" aria-hidden="true" /><span className="text-xs">Imagem não informada</span></div>}
  </div>;
}

function ListingCard({ listing, onOpen }) {
  const linked = Boolean(listing.product_id);
  const permalink = safeMeliPermalink(listing.permalink);
  return <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
    <button type="button" onClick={() => onOpen(listing)} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600" aria-label={`Ver detalhes de ${listing.title || listing.external_item_id}`}>
      <ImageBlock listing={listing} compact />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="line-clamp-2 min-h-10 text-sm font-semibold text-slate-900">{listing.title || 'Título não informado'}</h2>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${listing.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{STATUS_LABELS[listing.status] || listing.status || STATUS_LABELS.unknown}</span>
        </div>
        <p className="mt-2 text-lg font-bold text-blue-700">{money(listing.price, listing.currency_id || 'BRL')}</p>
        <p className="mt-1 text-xs text-slate-500">Disponibilidade informada: {listing.available_quantity ?? 'não informada'}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
          <span className="rounded bg-slate-100 px-2 py-1">{listing.external_item_id}</span>
          <span className="max-w-full truncate rounded bg-slate-100 px-2 py-1">{listing.category_name || (listing.category_id ? `Categoria ${listing.category_id}` : 'Sem categoria informada')}</span>
        </div>
        <p className={`mt-3 text-xs font-medium ${linked ? 'text-emerald-700' : 'text-slate-500'}`}>{linked ? 'Vinculado a produto do catálogo F7' : 'Sem vínculo com produto F7'}</p>
      </div>
    </button>
    {permalink && <a href={permalink} target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-center gap-2 border-t border-slate-100 px-4 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Abrir no Mercado Livre <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
  </article>;
}

export default function MercadoLivreListings() {
  const { user } = useAuth();
  const { company } = useCompany();
  const membership = useCompanyMembership(company?.id);
  const membershipState = companyMembershipGateState(membership, company?.id);
  const canView = membershipState === 'active' && can({ role: membership.role }, 'sales_channels.view');
  const canManage = membershipState === 'active' && can({ role: membership.role }, 'sales_channels.manage');
  const [connectionsState, setConnectionsState] = React.useState({ loading: true, configured: false, connections: [], error: '' });
  const [connectionId, setConnectionId] = React.useState('');
  const [listings, setListings] = React.useState([]);
  const [facets, setFacets] = React.useState({ categories: [], statuses: [], total: 0 });
  const [products, setProducts] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const search = useDebouncedValue(query);
  const [categoryId, setCategoryId] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [sort, setSort] = React.useState('updated_desc');
  const [page, setPage] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [facetsLoading, setFacetsLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [productId, setProductId] = React.useState('');
  const [catalogVersion, setCatalogVersion] = React.useState(0);
  const requestSequence = React.useRef(0);
  const facetsSequence = React.useRef(0);
  const companyId = company?.id || '';
  const connection = connectionsState.connections.find((item) => item.id === connectionId) || connectionsState.connections[0] || null;

  React.useEffect(() => {
    let cancelled = false;
    setConnectionId('');
    setListings([]);
    setFacets({ categories: [], statuses: [], total: 0 });
    setTotal(0);
    setConnectionsState({ loading: true, configured: false, connections: [], error: '' });
    setError('');
    if (!companyId || !user?.id || !canView) {
      setConnectionsState({ loading: false, configured: false, connections: [], error: '' });
      return () => { cancelled = true; };
    }
    mercadoLivreAction(companyId, 'status').then((result) => {
      if (cancelled) return;
      const connections = result.connections || [];
      setConnectionsState({ loading: false, configured: Boolean(result.configured), connections, error: '' });
      setConnectionId(connections[0]?.id || '');
    }).catch((loadError) => {
      if (cancelled) return;
      setConnectionsState({ loading: false, configured: false, connections: [], error: mercadoLivreErrorMessage(loadError) });
    });
    return () => { cancelled = true; };
  }, [companyId, user?.id, canView]);

  React.useEffect(() => {
    let cancelled = false;
    if (!companyId || !canManage || !connectionId) { setProducts([]); return () => { cancelled = true; }; }
    getSupabaseClient().from('products').select('id,name,sku').eq('company_id', companyId).eq('active', true).order('name').limit(500)
      .then(({ data, error: productError }) => {
        if (cancelled) return;
        if (productError) setError('Não foi possível carregar os produtos desta empresa para associação.');
        else setProducts(data || []);
      });
    return () => { cancelled = true; };
  }, [companyId, canManage, connectionId]);

  React.useEffect(() => {
    const current = ++requestSequence.current;
    if (!companyId || !canView || !connectionId) {
      setListings([]); setTotal(0); setHasMore(false); setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    mercadoLivreAction(companyId, 'list_listings', {
      connection_id: connectionId, search, category_id: categoryId, status, sort, page, page_size: PAGE_SIZE,
    }).then((result) => {
      if (current !== requestSequence.current) return;
      const rows = result.listings || [];
      setListings((previous) => page === 0 ? rows : [...previous, ...rows]);
      setTotal(Number(result.total) || 0);
      setHasMore(Boolean(result.has_more));
    }).catch((loadError) => {
      if (current !== requestSequence.current) return;
      setError(mercadoLivreErrorMessage(loadError));
      if (page === 0) setListings([]);
    }).finally(() => { if (current === requestSequence.current) setLoading(false); });
    return () => { requestSequence.current += 1; };
  }, [companyId, canView, connectionId, search, categoryId, status, sort, page, catalogVersion]);

  React.useEffect(() => {
    const current = ++facetsSequence.current;
    let cancelled = false;
    if (!companyId || !canView || !connectionId) {
      setFacets({ categories: [], statuses: [], total: 0 }); setFacetsLoading(false);
      return () => { cancelled = true; };
    }
    setFacetsLoading(true);
    const loadFacets = async () => {
      const rows = [];
      let offset = 0;
      while (true) {
        const { data, error: queryError } = await getSupabaseClient().from('meli_listing_links')
          .select('category_id,category_name,status')
          .eq('company_id', companyId).eq('connection_id', connectionId)
          .order('id').range(offset, offset + FACET_PAGE_SIZE - 1);
        if (queryError) throw queryError;
        rows.push(...(data || []));
        offset += (data || []).length;
        if ((data || []).length < FACET_PAGE_SIZE) break;
        if (offset > 1_000_000) throw new Error('CATALOG_FACET_LIMIT');
      }
      return buildMeliListingFacets(rows);
    };
    loadFacets().then((result) => {
      if (!cancelled && current === facetsSequence.current) setFacets(result);
    }).catch(() => {
      if (!cancelled && current === facetsSequence.current) setError('Não foi possível carregar as categorias e os status dos anúncios.');
    }).finally(() => {
      if (!cancelled && current === facetsSequence.current) setFacetsLoading(false);
    });
    return () => { cancelled = true; facetsSequence.current += 1; };
  }, [companyId, canView, connectionId, catalogVersion]);

  React.useEffect(() => { setPage(0); }, [search, categoryId, status, sort, connectionId]);

  const refreshCatalog = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await mercadoLivreAction(companyId, 'sync_listings', { connection_id: connectionId, idempotency_key: crypto.randomUUID() });
      setNotice(`${result.written || 0} anúncios atualizados a partir do Mercado Livre. Nenhum preço ou estoque externo foi alterado.`);
      setCatalogVersion((version) => version + 1);
      setPage(0);
    } catch (syncError) { setError(mercadoLivreErrorMessage(syncError)); }
    finally { setBusy(false); }
  };

  const associate = async () => {
    if (!selected || !productId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await mercadoLivreAction(companyId, 'map_listing', {
        connection_id: connectionId, external_item_id: selected.external_item_id, product_id: productId, confirm: true,
      });
      setNotice('Anúncio associado ao produto desta empresa.');
      setSelected((previous) => previous ? { ...previous, product_id: productId } : previous);
      setCatalogVersion((version) => version + 1);
    } catch (mappingError) { setError(mercadoLivreErrorMessage(mappingError)); }
    finally { setBusy(false); }
  };

  if (membershipState === 'loading') return <main className="mx-auto max-w-7xl px-4 py-8"><div role="status" className="text-sm text-slate-600">Verificando vínculo e permissões da empresa…</div></main>;
  if (membershipState === 'error') return <main className="mx-auto max-w-7xl px-4 py-8"><div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Não foi possível confirmar seu vínculo com a empresa. Nenhum anúncio foi consultado. <button type="button" className="underline" onClick={membership.refresh}>Tentar novamente</button></div></main>;
  if (!canView) return <main className="mx-auto max-w-7xl px-4 py-8"><h1 className="text-xl font-semibold">Acesso restrito</h1><p className="mt-2 text-sm text-slate-600">Seu papel não permite consultar os anúncios desta empresa.</p></main>;

  const selectedCategory = facets.categories.find((item) => item.category_id === categoryId);
  const filteredCount = total;

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
    <PageHeader title="Anúncios sincronizados" subtitle="Catálogo somente de leitura dos anúncios da conta Mercado Livre autorizada para esta empresa." action={<Link to="/f7-commerce" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /> Voltar ao F7 Commerce</Link>} />

    {connectionsState.error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{connectionsState.error}</div>}
    {!connectionsState.loading && !connectionsState.error && !connection && <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Store className="h-6 w-6" /></span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">Nenhuma conta Mercado Livre conectada</h2>
      <p className="mt-2 text-sm text-slate-600">Conecte uma conta autorizada no F7 Commerce para sincronizar e visualizar anúncios desta empresa.</p>
      {!connectionsState.configured && <p className="mt-3 text-xs text-amber-800">A configuração necessária do conector está incompleta no servidor.</p>}
      <Link to="/f7-commerce" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Abrir F7 Commerce <ArrowLeft className="h-4 w-4 rotate-180" /></Link>
    </section>}

    {connectionsState.loading && <div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando contas autorizadas…</div>}
    {connection && <>
      {connectionsState.connections.length > 1 && <label className="mb-4 block max-w-md text-sm font-medium text-slate-700">Conta Mercado Livre
        <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3" value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setPage(0); }}>
          {connectionsState.connections.map((item) => <option key={item.id} value={item.id}>Vendedor {item.seller_id}</option>)}
        </select>
      </label>}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Filtros de anúncios">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">{facets.total} anúncios em {facets.categories.length} categorias</p><p className="mt-1 text-xs text-slate-500">Vendedor {connection.seller_id}{connection.last_catalog_sync_at ? ` · sincronizado ${new Date(connection.last_catalog_sync_at).toLocaleString('pt-BR')}` : ' · ainda não sincronizado'}</p></div>
          {canManage && <Button onClick={refreshCatalog} disabled={busy || connectionsState.loading} variant="secondary"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Atualizar catálogo</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-slate-600">Pesquisar título ou MLB
            <span className="mt-1 flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3"><Search className="h-4 w-4 text-slate-400" /><Input className="h-full border-0 p-0 shadow-none focus-visible:ring-0" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: MLB123… ou produto" /></span>
          </label>
          <label className="text-xs font-medium text-slate-600">Categoria
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Todas as categorias ({facets.total})</option>{facets.categories.map((item) => <option key={item.category_id || 'uncategorized'} value={item.category_id || ''} disabled={!item.category_id}>{item.category_name || (item.category_id ? `Categoria ${item.category_id}` : 'Sem categoria informada')} ({item.count})</option>)}</select>
          </label>
          <label className="text-xs font-medium text-slate-600">Status
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option>{facets.statuses.map((item) => <option key={item.status} value={item.status}>{STATUS_LABELS[item.status] || item.status} ({item.count})</option>)}</select>
          </label>
          <label className="text-xs font-medium text-slate-600">Ordenar por
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={sort} onChange={(event) => setSort(event.target.value)}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
        </div>
      </section>

      {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
      {selectedCategory && <h2 className="mb-3 text-lg font-semibold text-slate-900">{selectedCategory.category_name || `Categoria ${selectedCategory.category_id}`} <span className="text-sm font-normal text-slate-500">· {selectedCategory.count} anúncios</span></h2>}
      {loading && listings.length === 0 && <div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando anúncios…</div>}
      {!loading && listings.length === 0 && !error && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Package className="mx-auto h-9 w-9 text-slate-300" /><h2 className="mt-3 font-semibold text-slate-800">Nenhum anúncio encontrado</h2><p className="mt-1 text-sm text-slate-500">Ajuste os filtros ou atualize o catálogo para importar os anúncios da conta.</p></div>}
      {listings.length > 0 && <>
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>Exibindo {listings.length} de {filteredCount}</span>{facetsLoading && <span role="status">Atualizando categorias…</span>}</div>
        {!categoryId && facets.categories.filter((item) => item.category_id).map((facet) => {
          const rows = listings.filter((listing) => listing.category_id === facet.category_id);
          if (!rows.length) return null;
          return <section key={facet.category_id} className="mb-8" aria-labelledby={`category-${facet.category_id}`}>
            <div className="mb-3 flex items-baseline justify-between gap-3"><h2 id={`category-${facet.category_id}`} className="text-lg font-semibold text-slate-900">{facet.category_name || `Categoria ${facet.category_id}`}</h2><span className="text-xs text-slate-500">{facet.count} anúncios</span></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rows.map((listing) => <ListingCard key={listing.id} listing={listing} onOpen={(item) => { setSelected(item); setProductId(item.product_id || ''); }} />)}</div>
          </section>;
        })}
        {(!categoryId && facets.categories.some((item) => !item.category_id) || categoryId) && <section className="mb-8" aria-label={categoryId ? 'Anúncios da categoria selecionada' : 'Anúncios sem categoria'}>
          {!categoryId && <h2 className="mb-3 text-lg font-semibold text-slate-900">Sem categoria informada <span className="text-sm font-normal text-slate-500">· {facets.categories.find((item) => !item.category_id)?.count || 0} anúncios</span></h2>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{listings.filter((listing) => categoryId ? listing.category_id === categoryId : !listing.category_id).map((listing) => <ListingCard key={listing.id} listing={listing} onOpen={(item) => { setSelected(item); setProductId(item.product_id || ''); }} />)}</div>
        </section>}
        {hasMore && <div className="flex justify-center py-4"><Button variant="outline" disabled={loading} onClick={() => setPage((previous) => previous + 1)}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Carregar mais anúncios</Button></div>}
      </>}
    </>}

    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      {selected && <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{selected.title || selected.external_item_id}</DialogTitle><DialogDescription>Detalhes sincronizados do anúncio {selected.external_item_id}. Os dados refletem o último retrato salvo no F7.</DialogDescription></DialogHeader>
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="overflow-hidden rounded-xl border border-slate-200"><ImageBlock listing={selected} /></div>
          <dl className="grid content-start grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">Preço</dt><dd className="mt-1 font-semibold">{money(selected.price, selected.currency_id || 'BRL')}</dd></div>
            <div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1">{STATUS_LABELS[selected.status] || selected.status || STATUS_LABELS.unknown}</dd></div>
            <div><dt className="text-xs text-slate-500">Disponibilidade</dt><dd className="mt-1">{selected.available_quantity ?? 'Não informada'}</dd></div>
            <div><dt className="text-xs text-slate-500">Categoria</dt><dd className="mt-1">{selected.category_name || selected.category_id || 'Não informada'}</dd></div>
            <div><dt className="text-xs text-slate-500">SKU do vendedor</dt><dd className="mt-1">{selected.seller_sku || 'Não informado'}</dd></div>
            <div><dt className="text-xs text-slate-500">Atualização no Mercado Livre</dt><dd className="mt-1">{selected.external_updated_at ? new Date(selected.external_updated_at).toLocaleString('pt-BR') : 'Não informada'}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-slate-500">Última sincronização no F7</dt><dd className="mt-1">{selected.synced_at ? new Date(selected.synced_at).toLocaleString('pt-BR') : 'Não informada'}</dd></div>
          </dl>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-sm"><p className="font-medium text-slate-800">{selected.product_id ? 'Vinculado a produto do catálogo F7' : 'Sem vínculo com produto F7'}</p>{selected.product_id && <p className="mt-1 text-xs text-slate-500">A associação é interna desta empresa; nenhuma alteração será enviada ao Mercado Livre.</p>}</div>
          {canManage && <div className="flex flex-col gap-2 sm:min-w-72"><label htmlFor="meli-f7-product" className="text-xs font-medium text-slate-600">Associar produto desta empresa</label><select id="meli-f7-product" className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Selecionar produto…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select><Button variant="secondary" disabled={!productId || productId === selected.product_id || busy} onClick={associate}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Associar produto</Button></div>}
        </div>
        {safeMeliPermalink(selected.permalink) && <a href={safeMeliPermalink(selected.permalink)} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 self-start text-sm font-medium text-blue-700 underline">Abrir anúncio original <ExternalLink className="h-4 w-4" /></a>}
      </DialogContent>}
    </Dialog>
  </main>;
}
