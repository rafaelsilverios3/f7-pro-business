import React from 'react';
import { AlertCircle, CheckCircle2, CircleOff, ExternalLink, Loader2, RefreshCw, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/useCompany';
import { can } from '@/lib/permissions';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { mercadoLivreAction, mercadoLivreErrorMessage, startMercadoLivreConnection } from '@/services/mercadoLivreService';

const supabaseMode = import.meta.env.VITE_DATA_PROVIDER === 'supabase';
const money = (value, currency = 'BRL') => Number.isFinite(Number(value)) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value)) : '—';

export default function MercadoLivreConnector({ memberRole = '' }) {
  const { user } = useAuth();
  const { company } = useCompany();
  const [state, setState] = React.useState({ loading: true, companyId: null, configured: false, connections: [], error: '', notice: '' });
  const [listings, setListings] = React.useState([]);
  const [hasMoreListings, setHasMoreListings] = React.useState(false);
  const [orders, setOrders] = React.useState([]);
  const [nextOrdersOffset, setNextOrdersOffset] = React.useState(0);
  const [hasMoreOrders, setHasMoreOrders] = React.useState(false);
  const [products, setProducts] = React.useState([]);
  const [mapping, setMapping] = React.useState({});
  const [selectedConnectionId, setSelectedConnectionId] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [history, setHistory] = React.useState([]);
  const sequence = React.useRef(0);
  const selectedConnectionIdRef = React.useRef('');
  const selectedConnectionCompanyRef = React.useRef('');
  const canView = can({ role: memberRole }, 'sales_channels.view');
  const canManage = can({ role: memberRole }, 'sales_channels.manage');
  const tenantStateValid = Boolean(company?.id && state.companyId === company.id);
  const loading = state.loading || Boolean(company?.id && !tenantStateValid);
  const selectedConnection = tenantStateValid
    ? state.connections.find((connection) => connection.id === selectedConnectionId) || state.connections[0] || null
    : null;

  const refresh = React.useCallback(async () => {
    const companyId = company?.id;
    const current = ++sequence.current;
    if (!companyId || !user?.id || !canView) {
      setState({ loading: false, companyId: companyId || null, configured: false, connections: [], error: canView ? '' : 'Você não tem permissão para consultar canais de venda.', notice: '' });
      selectedConnectionIdRef.current = ''; selectedConnectionCompanyRef.current = companyId || '';
      setSelectedConnectionId(''); setListings([]); setHasMoreListings(false); setOrders([]); setNextOrdersOffset(0); setHasMoreOrders(false); setProducts([]); setHistory([]);
      return;
    }
    if (selectedConnectionCompanyRef.current !== companyId) {
      selectedConnectionIdRef.current = '';
      selectedConnectionCompanyRef.current = companyId;
      setSelectedConnectionId('');
    }
    setState({ loading: true, companyId, error: '', notice: '', connections: [], configured: false });
    setListings([]); setHasMoreListings(false); setOrders([]); setNextOrdersOffset(0); setHasMoreOrders(false); setProducts([]); setHistory([]);
    try {
      if (!supabaseMode) throw new Error('MELI_SUPABASE_PROVIDER_REQUIRED');
      const [status, productResult] = await Promise.all([
        mercadoLivreAction(companyId, 'status'),
        getSupabaseClient().from('products').select('id,name,sku,price,stock').eq('company_id', companyId).eq('active', true).order('name').limit(300),
      ]);
      if (current !== sequence.current) return;
      if (productResult.error) throw new Error('PRODUCTS_LOAD_FAILED');
      setProducts(productResult.data || []);
      setState({ loading: false, companyId, configured: Boolean(status.configured), connections: status.connections || [], error: '', notice: '' });
      const connection = status.connections?.find((item) => item.id === selectedConnectionIdRef.current) || status.connections?.[0];
      if (connection) { selectedConnectionIdRef.current = connection.id; setSelectedConnectionId(connection.id); }
      if (connection) {
        const [listingResult, orderResult, historyResult] = await Promise.all([
          mercadoLivreAction(companyId, 'list_listings', { connection_id: connection.id }),
          mercadoLivreAction(companyId, 'list_orders', { connection_id: connection.id }),
          mercadoLivreAction(companyId, 'list_history', { connection_id: connection.id }),
        ]);
        if (current !== sequence.current) return;
        setListings(listingResult.listings || []);
        setOrders(orderResult.orders || []);
        setHistory(historyResult.runs || []);
      }
    } catch (error) {
      if (current !== sequence.current) return;
      const message = mercadoLivreErrorMessage(error);
      setState({ loading: false, companyId, configured: false, connections: [], error: message, notice: '' });
    }
  }, [company?.id, user?.id, canView]);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    const callback = new URLSearchParams(window.location.search).get('mercadolivre');
    if (!callback) return;
    const labels = { connected: 'Conta conectada com sucesso.', authorization_failed: 'A autorização do Mercado Livre não foi concluída.', authorization_expired: 'A tentativa de conexão expirou. Inicie novamente.', access_revoked: 'A empresa ou o acesso mudou durante a autorização.', connector_not_configured: 'O servidor do conector ainda não tem as configurações necessárias.', identity_validation_failed: 'A conta autorizada não passou pela validação de identidade.', connection_failed: 'Não foi possível salvar a conexão. Consulte o histórico.' };
    setState((previous) => ({ ...previous, notice: labels[callback] || 'A autorização não foi concluída.' }));
    const next = new URL(window.location.href); next.searchParams.delete('mercadolivre');
    window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`);
    refresh();
  }, [refresh]);

  const perform = async (name, operation) => {
    setBusy(name); setState((previous) => ({ ...previous, error: '', notice: '' }));
    try {
      const result = await operation();
      await refresh();
      if (result?.next_offset !== undefined) {
        setNextOrdersOffset(result.next_offset || 0);
        setHasMoreOrders(Boolean(result.has_more));
      }
      if (name === 'sync_listings') setHasMoreListings(Boolean(result?.has_more));
      const notice = result?.failed ? `${result.written || 0} notificações processadas; ${result.failed} falharam e seguirão a política de retentativa.`
        : result?.written !== undefined ? `${result.written} registros sincronizados.` : 'Operação concluída.';
      setState((previous) => ({ ...previous, notice }));
      return result;
    } catch (error) {
      setState((previous) => ({ ...previous, error: mercadoLivreErrorMessage(error) }));
      return null;
    } finally { setBusy(''); }
  };

  const connect = () => perform('connect', async () => {
    const url = await startMercadoLivreConnection(company.id);
    window.location.assign(url);
    return { code: 'REDIRECTING' };
  });

  const sync = (action) => perform(action, () => mercadoLivreAction(company.id, action, {
    connection_id: selectedConnection.id,
    ...(action === 'sync_orders' ? { offset: nextOrdersOffset } : {}),
  }));

  const mapListing = (listing) => perform(`map:${listing.id}`, () => mercadoLivreAction(company.id, 'map_listing', {
    connection_id: selectedConnection.id, external_item_id: listing.external_item_id,
    product_id: mapping[listing.id], confirm: true,
  }));

  const pushListing = (listing) => {
    const product = products.find((item) => item.id === listing.product_id);
    if (!product || !window.confirm(`Enviar ao anúncio ${listing.external_item_id} o preço ${money(product.price)} e o estoque inteiro ${product.stock}? Esta ação altera a conta Mercado Livre e não o catálogo do F7.`)) return;
    return perform(`push:${listing.id}`, () => mercadoLivreAction(company.id, 'push_product', {
      connection_id: selectedConnection.id, external_item_id: listing.external_item_id,
      fields: ['price', 'stock'], idempotency_key: crypto.randomUUID(), confirm: true,
    }));
  };

  const disconnect = () => {
    if (!selectedConnection || !window.confirm('Desconectar esta conta do F7 e apagar os tokens armazenados? A autorização concedida no Mercado Livre deve ser revogada separadamente nas configurações da conta.')) return;
    return perform('disconnect', () => mercadoLivreAction(company.id, 'disconnect', { connection_id: selectedConnection.id, confirm: true }));
  };

  if (!canView) return <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Seu papel não permite consultar integrações de canais de venda.</article>;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-700"><Store className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">Mercado Livre</h3>
              {loading ? <span className="text-xs text-slate-500">Verificando conexão…</span> : selectedConnection
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado · vendedor {selectedConnection.seller_id}</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"><CircleOff className="h-3.5 w-3.5" /> Não conectado</span>}</div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">OAuth server-side, tokens criptografados e sincronização sob demanda. Importação não cria vendas nem movimenta estoque ou financeiro.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={loading || Boolean(busy)} onClick={refresh} className="text-slate-700"><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </div>

      {tenantStateValid && state.error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{state.error}</div>}
      {tenantStateValid && state.notice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{state.notice}</div>}

      {tenantStateValid && state.connections.length > 1 && <label className="mt-4 block max-w-md text-xs font-medium text-slate-600">Conta Mercado Livre
        <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={selectedConnection?.id || ''} onChange={(event) => {
          selectedConnectionIdRef.current = event.target.value;
          setSelectedConnectionId(event.target.value);
          setListings([]); setOrders([]); setHistory([]); setProducts([]);
          setNextOrdersOffset(0); setHasMoreOrders(false); setHasMoreListings(false);
          refresh();
        }}>{state.connections.map((connection) => <option key={connection.id} value={connection.id}>Vendedor {connection.seller_id}</option>)}</select>
      </label>}

      {!loading && !state.error && !state.configured && !selectedConnection && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">O backend confirmou que o aplicativo OAuth e a chave de criptografia ainda não estão configurados. Nenhuma conexão simulada foi criada.</div>}
      {!loading && !selectedConnection && !state.error && state.configured && canManage && <Button className="mt-4" onClick={connect} disabled={Boolean(busy)}>{busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Conectar conta Mercado Livre</Button>}
      {!loading && !selectedConnection && !canManage && !state.error && <p className="mt-4 text-xs text-slate-500">Um administrador, gestor ou perfil comercial autorizado precisa conectar a conta.</p>}

      {selectedConnection && <div className="mt-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={Boolean(busy)} onClick={() => sync('sync_listings')}>{busy === 'sync_listings' && <Loader2 className="h-4 w-4 animate-spin" />} {hasMoreListings ? 'Sincronizar próximos 20 anúncios' : 'Sincronizar anúncios'}</Button>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => sync('sync_orders')}>{busy === 'sync_orders' && <Loader2 className="h-4 w-4 animate-spin" />} {nextOrdersOffset ? `Importar próximos 50 pedidos (a partir de ${nextOrdersOffset})` : 'Importar pedidos'}</Button>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => sync('process_notifications', 'Notificações')}>{busy === 'process_notifications' && <Loader2 className="h-4 w-4 animate-spin" />} Processar notificações</Button>
          {canManage && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={disconnect}>Desconectar</Button>}
        </div>
        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Anúncios sincronizados</h4>
          {listings.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Nenhum anúncio importado. A sincronização consulta o Mercado Livre e salva somente um retrato por empresa.</p> : <div className="space-y-2">{listings.map((listing) => <div key={listing.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-slate-800">{listing.title}</p><p className="mt-1 text-xs text-slate-500">{listing.external_item_id} · {listing.status} · {money(listing.price, listing.currency_id || 'BRL')} · disponibilidade informada: {listing.available_quantity ?? 'desconhecida'}</p>{listing.permalink && <a href={listing.permalink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-700 underline">Abrir anúncio</a>}</div>
              {canManage && <div className="flex flex-wrap gap-2"><select aria-label={`Produto F7 para ${listing.external_item_id}`} value={mapping[listing.id] || listing.product_id || ''} onChange={(event) => setMapping((previous) => ({ ...previous, [listing.id]: event.target.value }))} className="h-9 max-w-56 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="">Associar produto F7…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select><Button size="sm" variant="outline" disabled={!mapping[listing.id] || Boolean(busy)} onClick={() => mapListing(listing)}>Associar</Button>{listing.product_id && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => pushListing(listing)}>Enviar preço e estoque</Button>}</div>}</div>
          </div>)}</div>}
        </section>
        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Pedidos importados</h4>
          {orders.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Nenhum pedido importado. Os dados pessoais do comprador não são persistidos nem usados para criar vendas.</p> : <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Pedido</th><th className="p-2">Estado</th><th className="p-2">Data</th><th className="p-2">Total</th><th className="p-2">Itens</th></tr></thead><tbody>{orders.map((order) => <tr key={order.external_order_id} className="border-t border-slate-100"><td className="p-2">{order.external_order_id}</td><td className="p-2">{order.status}</td><td className="p-2">{order.date_created ? new Date(order.date_created).toLocaleString('pt-BR') : '—'}</td><td className="p-2">{money(order.total_amount, order.currency_id || 'BRL')}</td><td className="p-2">{order.item_count}</td></tr>)}</tbody></table></div>}
        </section>
        {history.length > 0 && <section><h4 className="mb-2 text-sm font-semibold text-slate-800">Histórico de sincronização</h4><ul className="space-y-1 text-xs text-slate-500">{history.map((item) => <li key={item.id}>{new Date(item.started_at).toLocaleString('pt-BR')} · {{ catalog_read: 'Anúncios', orders_read: 'Pedidos', listing_update: 'Atualização de anúncio', notification_process: 'Notificações' }[item.operation] || 'Integração'} · {item.status === 'completed' ? `${item.items_written} registros` : item.status === 'partial' ? 'resultado parcial; confira no marketplace' : item.status === 'running' ? 'em andamento' : `falhou${item.error_code ? ` (${item.error_code})` : ''}`}</li>)}</ul></section>}
        <p className="text-[11px] leading-5 text-slate-500">Atualizações de anúncios só ocorrem após confirmação explícita. A desconexão apaga os tokens do F7; a autorização externa deve ser revogada separadamente no Mercado Livre.</p>
      </div>}
    </article>
  );
}
