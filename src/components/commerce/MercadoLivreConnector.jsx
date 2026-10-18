import React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, CircleOff, ExternalLink, Loader2, RefreshCw, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/useCompany';
import { can } from '@/lib/permissions';
import { mercadoLivreAction, mercadoLivreErrorMessage, startMercadoLivreConnection } from '@/services/mercadoLivreService';

const supabaseMode = import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export default function MercadoLivreConnector({ memberRole = '' }) {
  const { user } = useAuth();
  const { company } = useCompany();
  const [state, setState] = React.useState({ loading: true, companyId: null, configured: false, connections: [], error: '', notice: '' });
  const [selectedConnectionId, setSelectedConnectionId] = React.useState('');
  const [listingCount, setListingCount] = React.useState(0);
  const [hasMoreListings, setHasMoreListings] = React.useState(false);
  const [nextOrdersOffset, setNextOrdersOffset] = React.useState(0);
  const [hasMoreOrders, setHasMoreOrders] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const sequence = React.useRef(0);
  const canView = can({ role: memberRole }, 'sales_channels.view');
  const canManage = can({ role: memberRole }, 'sales_channels.manage');
  const tenantStateValid = Boolean(company?.id && state.companyId === company.id);
  const loading = state.loading || Boolean(company?.id && !tenantStateValid);
  const connection = tenantStateValid
    ? state.connections.find((item) => item.id === selectedConnectionId) || state.connections[0] || null
    : null;

  const refresh = React.useCallback(async () => {
    const companyId = company?.id;
    const current = ++sequence.current;
    if (!companyId || !user?.id || !canView) {
      setState({ loading: false, companyId: companyId || null, configured: false, connections: [], error: canView ? '' : 'Você não tem permissão para consultar canais de venda.', notice: '' });
      setSelectedConnectionId('');
      setListingCount(0);
      return;
    }
    setState({ loading: true, companyId, error: '', notice: '', connections: [], configured: false });
    setListingCount(0);
    try {
      if (!supabaseMode) throw new Error('MELI_SUPABASE_PROVIDER_REQUIRED');
      const status = await mercadoLivreAction(companyId, 'status');
      if (current !== sequence.current) return;
      const connections = status.connections || [];
      const selected = connections.find((item) => item.id === selectedConnectionId) || connections[0] || null;
      setSelectedConnectionId(selected?.id || '');
      setState({ loading: false, companyId, configured: Boolean(status.configured), connections, error: '', notice: '' });
      if (selected) {
        const result = await mercadoLivreAction(companyId, 'list_listings', { connection_id: selected.id, page: 0, page_size: 1 });
        if (current !== sequence.current) return;
        setListingCount(Number(result.total) || 0);
      }
    } catch (error) {
      if (current !== sequence.current) return;
      setState({ loading: false, companyId, configured: false, connections: [], error: mercadoLivreErrorMessage(error), notice: '' });
    }
  }, [company?.id, user?.id, canView, selectedConnectionId]);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    setHasMoreListings(false);
    setNextOrdersOffset(0);
    setHasMoreOrders(false);
  }, [company?.id, selectedConnectionId]);
  React.useEffect(() => {
    const callback = new URLSearchParams(window.location.search).get('mercadolivre');
    if (!callback) return;
    const labels = { connected: 'Conta conectada com sucesso.', authorization_failed: 'A autorização do Mercado Livre não foi concluída.', authorization_expired: 'A tentativa de conexão expirou. Inicie novamente.', access_revoked: 'A empresa ou o acesso mudou durante a autorização.', feature_not_available: 'O plano atual da empresa não habilita integrações com marketplaces.', connector_not_configured: 'A configuração necessária para conectar o Mercado Livre está incompleta no servidor.', identity_validation_failed: 'A conta autorizada não passou pela validação de identidade.', connection_failed: 'Não foi possível salvar a conexão. Consulte o histórico.' };
    setState((previous) => ({ ...previous, notice: labels[callback] || 'A autorização não foi concluída.' }));
    const next = new URL(window.location.href);
    next.searchParams.delete('mercadolivre');
    window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`);
    refresh();
  }, [refresh]);

  const perform = async (name, operation) => {
    setBusy(name);
    setState((previous) => ({ ...previous, error: '', notice: '' }));
    try {
      const result = await operation();
      if (name === 'sync_listings') setHasMoreListings(Boolean(result?.has_more));
      if (name === 'sync_orders') {
        setNextOrdersOffset(result?.next_offset || 0);
        setHasMoreOrders(Boolean(result?.has_more));
      }
      await refresh();
      const notice = name === 'sync_listings' ? `${result?.written || 0} anúncios sincronizados.`
        : name === 'sync_orders' ? `${result?.written || 0} pedidos importados. Dados pessoais de compradores não são importados.`
          : name === 'process_notifications' ? result?.failed
            ? `${result.written || 0} notificações processadas; ${result.failed} falharam e seguirão a política de retentativa.`
            : `${result?.written || 0} notificações processadas.`
            : 'Operação concluída.';
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
    connection_id: connection.id,
    ...(action === 'sync_orders' ? { offset: nextOrdersOffset } : {}),
    idempotency_key: crypto.randomUUID(),
  }));

  const disconnect = () => {
    if (!connection || !window.confirm('Desconectar esta conta do F7 e apagar os tokens armazenados? A autorização concedida no Mercado Livre deve ser revogada separadamente nas configurações da conta.')) return;
    return perform('disconnect', () => mercadoLivreAction(company.id, 'disconnect', { connection_id: connection.id, confirm: true }));
  };

  if (!canView) return <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Seu papel não permite consultar integrações de canais de venda.</article>;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-700"><Store className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">Mercado Livre</h3>
              {loading ? <span className="text-xs text-slate-500">Verificando conexão…</span> : connection
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado · vendedor {connection.seller_id}</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"><CircleOff className="h-3.5 w-3.5" /> Não conectado</span>}</div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">OAuth server-side, tokens criptografados e sincronização sob demanda. A importação salva retratos na empresa e não altera anúncios externos.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={loading || Boolean(busy)} onClick={refresh} className="text-slate-700"><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </div>

      {tenantStateValid && state.error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{state.error}</div>}
      {tenantStateValid && state.notice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{state.notice}</div>}
      {tenantStateValid && state.connections.length > 1 && <label className="mt-4 block max-w-md text-xs font-medium text-slate-600">Conta Mercado Livre
        <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={connection?.id || ''} onChange={(event) => setSelectedConnectionId(event.target.value)}>{state.connections.map((item) => <option key={item.id} value={item.id}>Vendedor {item.seller_id}</option>)}</select>
      </label>}
      {!loading && !state.error && !state.configured && !connection && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">A configuração necessária para conectar o Mercado Livre está incompleta no servidor. O sistema não informa quais itens estão ausentes. Nenhuma conexão simulada foi criada.</div>}
      {!loading && !connection && !state.error && state.configured && canManage && <Button className="mt-4" onClick={connect} disabled={Boolean(busy)}>{busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Conectar conta Mercado Livre</Button>}
      {!loading && !connection && !canManage && !state.error && <p className="mt-4 text-xs text-slate-500">Um administrador, gestor ou perfil comercial autorizado precisa conectar a conta.</p>}

      {connection && <div className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold text-slate-900">{listingCount} anúncios sincronizados</p><p className="mt-1 text-xs text-slate-500">{connection.last_catalog_sync_at ? `Última sincronização ${new Date(connection.last_catalog_sync_at).toLocaleString('pt-BR')}` : 'Ainda não há registro de sincronização.'}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => sync('sync_listings')} disabled={Boolean(busy)}>{busy === 'sync_listings' && <Loader2 className="h-4 w-4 animate-spin" />} {hasMoreListings ? 'Sincronizar próximos 20 anúncios' : 'Sincronizar anúncios'}</Button>
          <Button size="sm" variant="secondary" onClick={() => sync('sync_orders')} disabled={Boolean(busy)}>{busy === 'sync_orders' && <Loader2 className="h-4 w-4 animate-spin" />} {hasMoreOrders ? `Importar próximos 50 pedidos (a partir de ${nextOrdersOffset})` : 'Importar pedidos'}</Button>
          <Button size="sm" variant="outline" onClick={() => sync('process_notifications')} disabled={Boolean(busy)}>{busy === 'process_notifications' && <Loader2 className="h-4 w-4 animate-spin" />} Processar notificações</Button>
          <Link to="/f7-commerce/anuncios" className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Anúncios sincronizados <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          {canManage && <Button size="sm" variant="outline" onClick={disconnect} disabled={Boolean(busy)}>Desconectar</Button>}
        </div>
      </div>}
    </article>
  );
}
