import React, { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { ChevronDown, CreditCard, LogOut, ShieldCheck, UserRound, Loader2, X } from 'lucide-react';
import Sidebar from './Sidebar';
import { useCompany } from '../../lib/useCompany';
import { base44 } from '../../api/base44Client';
import { useAuth } from '../../lib/AuthContext';
import { Search, Moon, Sun } from 'lucide-react';
import ProfileDialog from './ProfileDialog';
import { getDataProvider } from '@/data/providerSelector';
import { applyTheme, getStoredTheme, resolveTheme } from '@/lib/theme';
import { platformAdminService } from '@/services/platformAdminService';
import { loadSubscription, trialActive, trialHoursRemaining } from '@/services/subscriptionService';
import { notificationsService } from '@/services/notificationsService';
import NotificationBell from './NotificationBell';
import { searchGlobal } from '@/services/globalSearchService';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

function GlobalSearch({ company, user, subscription }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = React.useRef(null);
  const requestRef = React.useRef(0);
  const [role, setRole] = useState(() => String(user?.role || 'admin').toLowerCase());

  useEffect(() => {
    let cancelled = false;
    const fallback = String(user?.user_metadata?.role || user?.app_metadata?.role || user?.role || 'admin').toLowerCase();
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id || !user?.id) { setRole(fallback === 'authenticated' ? 'admin' : fallback); return undefined; }
    getSupabaseClient().from('company_users').select('role').eq('company_id', company.id).eq('user_id', user.id).eq('active', true).maybeSingle().then(({ data }) => {
      if (!cancelled) setRole(String(data?.role || fallback || 'admin').toLowerCase());
    }).catch(() => { if (!cancelled) setRole(fallback === 'authenticated' ? 'admin' : fallback); });
    return () => { cancelled = true; };
  }, [company?.id, user?.id, user?.role, user?.user_metadata?.role, user?.app_metadata?.role]);

  const focusSearch = () => {
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
      }
      if (event.key === 'Escape') {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setLoading(false);
      setError(false);
      setSelected(0);
      return undefined;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(false);
    const timer = window.setTimeout(() => {
      searchGlobal(company?.id, text, { role }).then((items) => {
        if (requestId !== requestRef.current) return;
        setResults(items);
        setSelected(0);
      }).catch(() => {
        if (requestId !== requestRef.current) return;
        setResults([]);
        setError(true);
      }).finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, company?.id, role]);

  const close = () => { setOpen(false); setMobileOpen(false); };
  const choose = (item) => { close(); navigate(item.route, { state: { globalSearch: item.title } }); };
  const grouped = results.reduce((groups, item) => ({ ...groups, [item.category]: [...(groups[item.category] || []), item] }), {});
  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((index) => Math.min(index + 1, Math.max(0, results.length - 1))); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((index) => Math.max(0, index - 1)); }
    if (event.key === 'Enter' && results[selected]) { event.preventDefault(); choose(results[selected]); }
  };
  const panel = (mobile = false) => (
    <div className={mobile ? 'fixed inset-0 z-[60] bg-[#07111f] p-4' : 'absolute left-0 right-0 top-[calc(100%+8px)] z-50'}>
      {mobile && <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-white">Busca global</span><button type="button" aria-label="Fechar busca" onClick={close} className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><X className="h-4 w-4" /></button></div>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input ref={inputRef} autoFocus={mobile} value={query} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={handleKeyDown} placeholder="Buscar clientes, produtos, pedidos..." aria-label="Busca global" className="h-11 w-full rounded-xl border border-slate-700/70 bg-[#0e1a2b] pl-10 pr-10 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60" />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-300" />}
      </div>
      {query.trim().length < 2 ? <p className="mt-3 px-2 text-xs text-slate-500">Digite pelo menos 2 caracteres para pesquisar.</p> : <div className="mt-2 max-h-[min(60vh,420px)] overflow-y-auto rounded-xl border border-slate-700/70 bg-[#0e1a2b] p-2 shadow-2xl">
        {error && <p className="px-3 py-4 text-xs text-rose-300">Não foi possível concluir a busca. Tente novamente.</p>}
        {!loading && !error && results.length === 0 && <p className="px-3 py-4 text-xs text-slate-400">Nenhum resultado encontrado.</p>}
        {Object.entries(grouped).map(([category, items]) => <section key={category} className="mb-2 last:mb-0"><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300">{category}</p>{items.map((item) => { const index = results.indexOf(item); return <button type="button" key={`${item.type}-${item.id}`} onMouseEnter={() => setSelected(index)} onClick={() => choose(item)} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left ${selected === index ? 'bg-blue-600/20' : 'hover:bg-white/5'}`}><span className="min-w-0"><span className="block truncate text-sm font-medium text-white">{item.title}</span><span className="block truncate text-xs text-slate-400">{item.subtitle}</span></span><span className="shrink-0 text-[10px] font-semibold text-blue-300">Abrir</span></button>; })}</section>)}
      </div>}
    </div>
  );
  return <>
    <div className="relative hidden min-h-11 max-w-3xl flex-1 items-center gap-2 rounded-xl border border-slate-700/70 bg-[#0e1a2b] px-4 text-sm text-slate-400 transition-colors focus-within:border-blue-400/60 md:flex" onClick={focusSearch}>
      <Search className="h-4 w-4 text-slate-500" /><span className="flex-1">Buscar clientes, produtos, pedidos...</span>{trialActive(subscription) && <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200">Teste gratuito — {trialHoursRemaining(subscription)}h restantes</span>}<kbd className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-500">Ctrl + K</kbd>{open && panel()}
    </div>
    <button type="button" aria-label="Abrir busca global" onClick={() => { setMobileOpen(true); setOpen(true); }} className="rounded-xl border border-slate-700/70 p-2.5 text-slate-300 transition hover:border-blue-400/50 hover:bg-slate-800 md:hidden"><Search className="h-4 w-4" /></button>
    {mobileOpen && panel(true)}
  </>;
}

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
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(import.meta.env.VITE_DATA_PROVIDER === 'supabase');

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

  useEffect(() => {
    let cancelled = false;
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
      setSubscription(null);
      setSubscriptionLoading(false);
      return undefined;
    }
    setSubscriptionLoading(true);
    loadSubscription(company.id)
      .then((result) => { if (!cancelled) setSubscription(result); })
      .catch(() => { if (!cancelled) setSubscription(null); })
      .finally(() => { if (!cancelled) setSubscriptionLoading(false); });
    return () => { cancelled = true; };
  }, [company?.id]);

  const visibleName = profileName || (displayName.includes('@') ? 'Seu perfil' : displayName);
  const visibleInitials = visibleName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';

  useEffect(() => { setResolvedTheme(applyTheme(theme)); }, [theme]);

  useEffect(() => {
    const storeName = String(company?.name || '').trim();
    document.title = storeName ? `F7 PRO BUSINESS - ${storeName}` : 'F7 PRO BUSINESS';
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.setAttribute('href', '/branding/f7-icon.png');
  }, [company?.name]);

  useEffect(() => {
    if (!company) return undefined;
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') {
      let cancelled = false;
      const refresh = () => notificationsService.countUnread(company.id).then((count) => { if (!cancelled) setUnread(count); }).catch(() => { if (!cancelled) setUnread(0); });
      refresh();
      window.addEventListener('f7:notifications-updated', refresh);
      return () => { cancelled = true; window.removeEventListener('f7:notifications-updated', refresh); };
    }
    let cancelled = false;
    base44.entities.Notification
      .filter({ company_id: company.id, read: false }, '-created_date', 50)
      .then((list) => { if (!cancelled) setUnread(list.length); })
      .catch(() => { if (!cancelled) setUnread(0); });
    return () => { cancelled = true; };
  }, [company]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { setPlatformAdmin(false); return undefined; }
    platformAdminService.access().then((result) => { if (!cancelled) setPlatformAdmin(result?.is_platform_admin === true); }).catch(() => { if (!cancelled) setPlatformAdmin(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar company={company} user={user} mobileOpen={mobileOpen} onOpenMobile={setMobileOpen} />
      <main className="flex-1 overflow-x-hidden pb-10 md:pb-0">
        <div className="sticky top-0 z-30 flex items-center gap-4 border-b border-slate-800/70 bg-[#07111f]/85 px-5 py-3 backdrop-blur md:px-8">
          <GlobalSearch company={company} user={user} subscription={subscription} />
          <button aria-label={resolvedTheme === 'light' ? 'Ativar tema escuro F7' : 'Ativar tema claro'} onClick={() => setTheme(() => resolvedTheme === 'light' ? 'dark' : 'light')} className="rounded-xl border border-slate-700/70 p-2.5 text-slate-300 transition duration-200 hover:border-blue-400/50 hover:bg-slate-800">{resolvedTheme === 'light' ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4" />}</button>
          <NotificationBell company={company} unread={unread} onUnreadChange={(delta) => setUnread((value) => Math.max(0, value + delta))} />
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
              {['admin', 'gestor'].includes(String(user?.role || '').toLowerCase()) && <Link to="/assinatura" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-200"><CreditCard className="h-3.5 w-3.5" /> Assinatura e pagamentos</Link>}
              {platformAdmin && <Link to="/administracao-f7" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/10"><ShieldCheck className="h-3.5 w-3.5" /> Administração F7</Link>}
              {['admin', 'gestor'].includes(String(user?.role || '').toLowerCase()) && <><p className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Configurações</p><Link to="/configuracoes/integracoes" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-200"><ShieldCheck className="h-3.5 w-3.5" /> Integrações</Link></>}
              <div className="my-1 border-t border-slate-700/70" />
              <button onClick={() => logout()} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-rose-500/10 hover:text-rose-300"><LogOut className="h-3.5 w-3.5" /> Sair</button>
            </div>}
          </div>
        </div>
        <Outlet context={{ company, subscription, subscriptionLoading, profileName }} />
      </main>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} user={user} company={company} role={String(user?.role || '').toLowerCase()} profileName={profileName} theme={theme} onThemeChange={setTheme} onSaved={setProfileName} />
    </div>
  );
}
