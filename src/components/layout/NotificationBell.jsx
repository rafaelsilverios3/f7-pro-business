import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notificationsService } from '@/services/notificationsService';
import { notificationCategory, notificationRoute } from '@/lib/notificationPresentation';
import { fmtDate } from '@/lib/business';

export default function NotificationBell({ company, unread = 0, onUnreadChange }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const rootRef = useRef(null);

  const load = async () => {
    if (!company?.id) return;
    setError('');
    try { setItems(await notificationsService.list(company.id, { pageSize: 5 })); } catch { setError('Não foi possível carregar as notificações.'); }
  };

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, company?.id]);

  useEffect(() => {
    const close = (event) => { if (open && !rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openItem = async (item) => {
    if (!item.read) {
      await notificationsService.markRead(company.id, item.id).catch(() => {});
      onUnreadChange?.(-1);
      setItems((current) => (current || []).map((row) => row.id === item.id ? { ...row, read: true } : row));
    }
    const route = notificationRoute(item);
    setOpen(false);
    if (route) navigate(route);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" aria-label={`Notificações${unread > 0 ? `, ${unread} não lidas` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative rounded-xl border border-transparent p-2.5 text-slate-300 transition duration-200 hover:border-slate-700 hover:bg-slate-800">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span aria-label={`${unread} não lidas`} className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && <div role="dialog" aria-label="Notificações recentes" className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(380px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-slate-700 bg-[#0e1a2b] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3"><div><p className="text-sm font-semibold text-white">Notificações</p><p className="text-[10px] text-slate-400">Atualizações operacionais do tenant</p></div><button type="button" onClick={() => { setOpen(false); navigate('/notificacoes'); }} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-blue-200">Ver todas <ChevronRight className="h-3.5 w-3.5" /></button></div>
        {error ? <div className="p-5 text-center text-xs text-rose-300"><p>{error}</p><button type="button" onClick={load} className="mt-2 rounded-lg border border-rose-300/40 px-3 py-1.5">Tentar novamente</button></div> : !items ? <div className="flex items-center justify-center p-8 text-xs text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...</div> : items.length === 0 ? <p className="p-8 text-center text-xs text-slate-400">Você não possui novas notificações.</p> : <ul className="max-h-[min(420px,60vh)] overflow-y-auto" aria-label="Notificações recentes">{items.map((item) => <li key={item.id}><button type="button" onClick={() => openItem(item)} className={`flex w-full gap-3 border-b border-slate-800/70 px-4 py-3 text-left transition hover:bg-white/[.04] ${item.read ? 'opacity-60' : ''}`}><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.read ? 'bg-slate-600' : 'bg-blue-400'}`} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-semibold text-white">{item.title}</span><span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-500">{notificationCategory(item)}</span></span><span className="mt-0.5 block line-clamp-2 text-[11px] text-slate-400">{item.message}</span><span className="mt-1 block text-[10px] text-slate-500">{fmtDate(item.created_date)}</span></span>{!item.read && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Não lida" />}</button></li>)}</ul>}
      </div>}
    </div>
  );
}
