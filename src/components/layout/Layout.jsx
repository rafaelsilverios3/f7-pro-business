import React, { useState, useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import Sidebar from './Sidebar';
import { useCompany } from '../../lib/useCompany';
import { base44 } from '../../api/base44Client';
import { useAuth } from '../../lib/AuthContext';
import { Search, Moon } from 'lucide-react';

export default function Layout() {
  const { company, loading } = useCompany();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!company) return;
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') {
      // Notifications are not part of the initial Supabase schema yet.
      setUnread(0);
      return undefined;
    }
    let cancelled = false;
    base44.entities.Notification
      .filter({ company_id: company.id, read: false }, '-created_date', 50)
      .then((list) => { if (!cancelled) setUnread(list.length); })
      .catch(() => { if (!cancelled) setUnread(0); });
    return () => { cancelled = true; };
  }, [company]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar company={company} mobileOpen={mobileOpen} onOpenMobile={setMobileOpen} />
      <main className="flex-1 overflow-x-hidden pb-10 md:pb-0">
        <div className="sticky top-0 z-30 flex items-center gap-4 border-b border-slate-800/70 bg-[#07111f]/85 px-5 py-3 backdrop-blur md:px-8">
          <div className="hidden min-h-10 flex-1 items-center gap-2 rounded-xl border border-slate-700/60 bg-[#0e1a2b] px-3 text-sm text-slate-400 md:flex"><Search className="h-4 w-4" /><span>Buscar clientes, produtos, pedidos...</span><kbd className="ml-auto rounded bg-slate-800 px-2 py-1 text-[10px]">Ctrl + K</kbd></div>
          <button aria-label="Alternar tema" className="rounded-xl border border-slate-700/60 p-2 text-slate-300 hover:bg-slate-800"><Moon className="h-4 w-4" /></button>
          <Link to="/notificacoes" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
          <div className="hidden items-center gap-2 md:flex"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/80 text-sm font-semibold text-white">{(user?.full_name || user?.name || user?.email || 'U').charAt(0).toUpperCase()}</div><div className="leading-tight"><p className="text-sm font-semibold text-white">{user?.full_name || user?.name || user?.email || 'Usuário'}</p><p className="text-[10px] text-slate-400">{user?.role || 'Administrador'}</p></div></div>
        </div>
        <Outlet context={{ company }} />
      </main>
    </div>
  );
}
