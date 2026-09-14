import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Bell, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { fmtDate } from '@/lib/business';
import { notificationCategory, notificationRoute } from '@/lib/notificationPresentation';
import { notificationsService } from '@/services/notificationsService';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

const CATEGORY_ORDER = ['CRM', 'Oportunidades', 'Automações', 'Estoque', 'Financeiro', 'Vendas', 'Compras', 'Sistema'];

export default function Notificacoes() {
  const { company } = useOutletContext();
  const navigate = useNavigate();
  const requestRef = useRef(0);
  const [result, setResult] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const pageSize = 30;

  const load = async (targetPage = page) => {
    if (!company?.id) return;
    const request = ++requestRef.current;
    setError('');
    try {
      const [next, count] = await Promise.all([
        notificationsService.listPage(company.id, { filter, category: category === 'all' ? undefined : category, page: targetPage, pageSize }),
        notificationsService.countUnread(company.id),
      ]);
      if (request !== requestRef.current) return;
      setResult(next); setUnreadCount(count);
    } catch (cause) {
      if (request === requestRef.current) setError(cause.message || 'Não foi possível carregar as notificações.');
    }
  };

  useEffect(() => { setPage(1); }, [company?.id, filter, category]);
  useEffect(() => { load(page); }, [company?.id, filter, category, page]);
  useEffect(() => {
    const refresh = () => load(page);
    window.addEventListener('f7:notifications-updated', refresh);
    return () => window.removeEventListener('f7:notifications-updated', refresh);
  }, [company?.id, filter, category, page]);

  const availableCategories = useMemo(() => {
    const values = new Set((result?.rows || []).map(notificationCategory));
    return CATEGORY_ORDER.filter((item) => values.has(item));
  }, [result?.rows]);

  const markRead = async (item) => {
    if (item.read) return;
    try { await notificationsService.markRead(company.id, item.id); setResult((current) => current ? { ...current, rows: current.rows.map((row) => row.id === item.id ? { ...row, read: true } : row) } : current); setUnreadCount((value) => Math.max(0, value - 1)); } catch (cause) { setError(cause.message || 'Não foi possível marcar a notificação como lida.'); }
  };

  const openItem = async (item) => {
    await markRead(item);
    const route = notificationRoute(item);
    if (route) navigate(route);
  };

  const markAllRead = async () => {
    try { await notificationsService.markAllRead(company.id); setResult((current) => current ? { ...current, rows: current.rows.map((row) => ({ ...row, read: true })) } : current); setUnreadCount(0); } catch (cause) { setError(cause.message || 'Não foi possível marcar as notificações como lidas.'); }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-5 sm:py-8">
      <PageHeader title="Notificações" subtitle="Caixa de entrada operacional do seu tenant." action={<Button variant="outline" onClick={() => load(page)} disabled={!company || !result}><RefreshCw className="mr-1.5 h-4 w-4" /> Atualizar</Button>} />
      {error && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><Button size="sm" variant="outline" onClick={() => load(page)}>Tentar novamente</Button></div>}
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Estado das notificações">{[['all', 'Todas'], ['unread', 'Não lidas'], ['read', 'Lidas']].map(([value, label]) => <button type="button" key={value} onClick={() => { setFilter(value); setPage(1); }} aria-pressed={filter === value} className={`rounded-lg border px-3 py-2 text-xs font-medium ${filter === value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'}`}>{label}{value === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}</button>)}</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categoria das notificações"><button type="button" onClick={() => { setCategory('all'); setPage(1); }} aria-pressed={category === 'all'} className={`rounded-lg border px-3 py-2 text-xs font-medium ${category === 'all' ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 text-slate-600'}`}>Categorias</button>{availableCategories.map((value) => <button type="button" key={value} onClick={() => { setCategory(value); setPage(1); }} aria-pressed={category === value} className={`rounded-lg border px-3 py-2 text-xs font-medium ${category === value ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 text-slate-600'}`}>{value}</button>)}</div>
        <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}><Check className="mr-1.5 h-4 w-4" /> Marcar todas como lidas</Button>
      </div>

      {!result && !error ? <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando notificações...</div> : result?.rows?.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><Bell className="mx-auto mb-2 h-10 w-10 text-slate-200" /><p className="text-sm font-medium text-slate-700">{filter === 'unread' ? 'Você não possui novas notificações.' : 'Nenhuma notificação encontrada neste filtro.'}</p><p className="mt-1 text-xs text-slate-400">As notificações são geradas a partir de eventos reais do sistema.</p></div> : <>
        <ul className="space-y-2" aria-label="Lista de notificações">{result?.rows?.map((item) => { const route = notificationRoute(item); return <li key={item.id} className={`flex min-w-0 flex-wrap items-start gap-3 rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${item.read ? 'border-l-slate-300 opacity-70' : 'border-l-indigo-500'}`}><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.read ? 'bg-slate-300' : 'bg-indigo-500'}`} aria-label={item.read ? 'Lida' : 'Não lida'} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{item.title}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{notificationCategory(item)}</span>{!item.read && <span className="text-[10px] font-semibold text-indigo-600">Não lida</span>}</div><p className="mt-1 text-xs leading-5 text-slate-500">{item.message}</p><p className="mt-1 text-[10px] text-slate-400">{fmtDate(item.created_date)}</p></div><div className="flex flex-wrap gap-1"><button type="button" onClick={() => markRead(item)} disabled={item.read} aria-label={`Marcar ${item.title} como lida`} className="rounded-md p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-default disabled:opacity-30"><Check className="h-4 w-4" /></button>{route ? <button type="button" onClick={() => openItem(item)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50">Abrir <ExternalLink className="h-3 w-3" /></button> : <span className="px-2 py-1.5 text-[10px] text-slate-400">Sem ação contextual</span>}</div></li>; })}</ul>
        <div className="mt-4 flex items-center justify-between"><span className="text-xs text-slate-500">{result.count} notificação(ões)</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft className="mr-1 h-4 w-4" /> Anteriores</Button><Button size="sm" variant="outline" onClick={() => setPage((value) => value + 1)} disabled={!result.hasMore}>Próximas <ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
      </>}
    </div>
  );
}
