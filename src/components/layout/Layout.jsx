import React, { useState, useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import Sidebar from './Sidebar';
import { useCompany } from '../../lib/useCompany';
import { base44 } from '../../api/base44Client';
import { useAuth } from '../../lib/AuthContext';
import { Search, Moon, Sun } from 'lucide-react';
import ProfileDialog from './ProfileDialog';
import { getDataProvider } from '@/data/providerSelector';
import { applyTheme, getStoredTheme, resolveTheme } from '@/lib/theme';

export default function Layout() {
  const { company, loading } = useCompany();
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [theme, setTheme] = useState(getStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getStoredTheme()));

  const roleLabels = {
    admin: 'Administrador', gestor: 'Gestor', financeiro: 'Financeiro',
    comercial: 'Comercial', vendedor: 'Vendedor', estoque: 'Estoque', atendimento: 'Atendimento',
  };
  const displayName = user?.full_name || user?.name || user?.email || 'Usuário';
  const role = roleLabels[String(user?.role || '').toLowerCase()] || (user?.role && user.role !== 'authenticated' ? user.role : 'Administrador');

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return undefined;
    getDataProvider().entity('Profile').get(user.id).then((profile) => {
      if (!cancelled && profile?.name && !profile.name.includes('@')) setProfileName(profile.name);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  const visibleName = profileName || (displayName.includes('@') ? 'Seu perfil' : displayName);
  const visibleInitials = visibleName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';

  useEffect(() => { setResolvedTheme(applyTheme(theme)); }, [theme]);

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
          <div className="hidden min-h-11 max-w-3xl flex-1 items-center gap-2 rounded-xl border border-slate-700/70 bg-[#0e1a2b] px-4 text-sm text-slate-400 transition-colors focus-within:border-blue-400/60 md:flex"><Search className="h-4 w-4 text-slate-500" /><span className="flex-1">Buscar clientes, produtos, pedidos...</span><kbd className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-500">Ctrl + K</kbd></div>
          <button aria-label={resolvedTheme === 'light' ? 'Ativar tema escuro F7' : 'Ativar tema claro'} onClick={() => setTheme(() => resolvedTheme === 'light' ? 'dark' : 'light')} className="rounded-xl border border-slate-700/70 p-2.5 text-slate-300 transition duration-200 hover:border-blue-400/50 hover:bg-slate-800">{resolvedTheme === 'light' ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4" />}</button>
          <Link to="/notificacoes" className="relative rounded-xl border border-transparent p-2.5 text-slate-300 transition duration-200 hover:border-slate-700 hover:bg-slate-800">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
          <div className="relative hidden md:block">
            <button onClick={() => setUserMenuOpen((open) => !open)} className="flex items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 text-left transition duration-200 hover:border-slate-700 hover:bg-slate-800/70" aria-expanded={userMenuOpen}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-xs font-bold text-white">{visibleInitials}</span>
              <span className="max-w-[180px] leading-tight"><span className="block truncate text-sm font-semibold text-white">{visibleName}</span><span className="block text-[10px] text-slate-400">{role}</span></span>
              <ChevronDown className="h-4 w-4 text-slate-500" />
            </button>
            {userMenuOpen && <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-52 rounded-xl border border-slate-700 bg-[#0e1a2b] p-1.5 shadow-2xl">
              <div className="border-b border-slate-700/70 px-3 py-2"><p className="truncate text-xs font-medium text-white">{visibleName}</p><p className="text-[10px] text-slate-400">{role}</p><p className="mt-1 truncate text-[10px] text-slate-500">{user?.email}</p></div>
              <p className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Conta</p>
              <button onClick={() => { setUserMenuOpen(false); setProfileOpen(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-200"><UserRound className="h-3.5 w-3.5" /> Minha conta</button>
              {['admin', 'gestor'].includes(String(user?.role || '').toLowerCase()) && <><p className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Configurações</p><Link to="/configuracoes/integracoes" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-200"><ShieldCheck className="h-3.5 w-3.5" /> Integrações</Link></>}
              <div className="my-1 border-t border-slate-700/70" />
              <button onClick={() => logout()} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-rose-500/10 hover:text-rose-300"><LogOut className="h-3.5 w-3.5" /> Sair</button>
            </div>}
          </div>
        </div>
        <Outlet context={{ company }} />
      </main>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} user={user} company={company} role={String(user?.role || '').toLowerCase()} profileName={profileName} theme={theme} onThemeChange={setTheme} onSaved={setProfileName} />
    </div>
  );
}
