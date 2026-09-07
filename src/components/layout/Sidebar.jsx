import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, Boxes, ShoppingCart, FileText,
  Wallet, Truck, MessageSquare, Zap, BrainCircuit, BarChart3,
  Settings, Bell, Target, Shield, Store, Pencil, ScanLine, BadgeDollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CompanyLogoDialog from './CompanyLogoDialog';
import { getCompanyLogoUrl } from '@/services/companyBrandingService';
import { useCompany } from '@/lib/useCompany';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { can } from '@/lib/permissions';

const NAV = [
  {
    group: 'Principal',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    group: 'Operação',
    items: [
      { to: '/pdv', label: 'PDV', icon: ScanLine, permission: 'pdv.use' },
      { to: '/precificacao', label: 'Precificação', icon: BadgeDollarSign, permission: 'pricing.view' },
      { to: '/clientes', label: 'Clientes', icon: Users, permission: 'customers.view' },
      { to: '/produtos', label: 'Produtos', icon: Package, permission: 'products.view' },
      { to: '/estoque', label: 'Estoque', icon: Boxes, permission: 'inventory.view' },
      { to: '/vendas', label: 'Vendas', icon: ShoppingCart, permission: 'sales.view' },
      { to: '/orcamentos', label: 'Orçamentos', icon: FileText, permission: 'quotes.view' },
      { to: '/financeiro', label: 'Financeiro', icon: Wallet, permission: 'finance.view' },
      { to: '/compras', label: 'Compras', icon: Truck, permission: 'purchases.view' },
      { to: '/metas', label: 'Metas e Comissões', icon: Target, permission: 'goals.view' },
    ],
  },
  {
    group: 'Inteligência',
    items: [
      { to: '/atendimento', label: 'Smart Atendimento', icon: MessageSquare, permission: 'conversation.view' },
      { to: '/automacoes', label: 'Automações', icon: Zap, permission: 'automation.view' },
      { to: '/intelligence', label: 'F7 Intelligence', icon: BrainCircuit, permission: 'intelligence.view' },
      { to: '/opportunities', label: 'F7 Opportunity', icon: Target, permission: 'opportunity.view' },
      { to: '/supplier-intelligence', label: 'Supplier Intelligence', icon: Shield, permission: 'supplier_intelligence.view' },
      { to: '/relatorios', label: 'Relatórios', icon: BarChart3, permission: 'reports.view' },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { to: '/notificacoes', label: 'Notificações', icon: Bell, permission: 'notifications.view' },
      { to: '/usuarios', label: 'Usuários', icon: Shield, permission: 'users.view' },
      { to: '/configuracoes', label: 'Configurações', icon: Settings, permission: 'settings.view' },
    ],
  },
];

export default function Sidebar({ company, user, onOpenMobile, mobileOpen }) {
  const location = useLocation();
  const [companyLogo, setCompanyLogo] = React.useState('');
  const [logoOpen, setLogoOpen] = React.useState(false);
  const [memberRole, setMemberRole] = React.useState('');
  const { refresh } = useCompany();
  const role = String(memberRole || user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  React.useEffect(() => {
    let cancelled = false;
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id || !user?.id) {
      setMemberRole(String(user?.role || '').toLowerCase());
      return undefined;
    }
    getSupabaseClient()
      .from('company_users')
      .select('role')
      .eq('company_id', company.id)
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setMemberRole(error ? String(user?.role || '').toLowerCase() : String(data?.role || user?.role || '').toLowerCase());
      })
      .catch(() => { if (!cancelled) setMemberRole(String(user?.role || '').toLowerCase()); });
    return () => { cancelled = true; };
  }, [company?.id, user?.id, user?.role]);
  React.useEffect(() => { let cancelled = false; if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.logo_path) { setCompanyLogo(''); return undefined; } getCompanyLogoUrl(company.logo_path).then((url) => { if (!cancelled) setCompanyLogo(url); }).catch(() => { if (!cancelled) setCompanyLogo(''); }); return () => { cancelled = true; }; }, [company?.logo_path]);
  const companyName = company?.name || 'Sua empresa';

  const NavList = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-2">
      {NAV.map((section) => (
        <div key={section.group} className="mb-6 last:mb-2">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {section.group}
          </p>
          <div className="space-y-0.5">
            {section.items.filter((item) => !item.permission || can({ role }, item.permission)).map((item) => {
              const active = location.pathname === item.to;
              if (item.soon) {
                return (
                  <div
                    key={item.to}
                    className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 opacity-50"
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">em breve</span>
                  </div>
                );
              }
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => mobileOpen && onOpenMobile?.(false)}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition duration-200',
                    active
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30'
                      : 'text-slate-300 hover:border-slate-700/60 hover:bg-white/[.04] hover:text-white'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.label === 'Smart Atendimento' && <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-300">IA</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-[245px] shrink-0 flex-col border-r border-slate-800/70 bg-[#091426] md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700/70 bg-slate-800 text-slate-300">{companyLogo ? <img src={companyLogo} alt={`Logo de ${companyName}`} className="h-full w-full object-contain" /> : <Store className="h-5 w-5" />}{isAdmin && <button type="button" aria-label="Editar logo da empresa" onClick={() => setLogoOpen(true)} className="absolute inset-0 flex items-center justify-center bg-slate-950/65 opacity-0 transition hover:opacity-100"><Pencil className="h-4 w-4 text-white" /></button>}</div>
          <div className="min-w-0 leading-tight"><p className="truncate text-sm font-bold tracking-tight text-white">{companyName}</p>{isAdmin && <Link to="/configuracoes" className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 transition hover:text-blue-300">PAINEL ADMINISTRATIVO</Link>}</div>
        </div>
        <NavList />
        <div className="border-t border-slate-800 px-4 py-3"><div className="flex items-center gap-2.5 rounded-lg px-2 py-2"><img src="/branding/f7-icon.png" alt="F7 PRO BUSINESS" className="h-9 w-9 object-contain" /><div className="min-w-0 leading-tight"><p className="truncate text-xs font-bold text-white">F7 PRO BUSINESS</p><p className="text-[10px] text-slate-400">Venda. Atenda. Automatize.</p></div></div></div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-slate-800">{companyLogo ? <img src={companyLogo} alt={`Logo de ${companyName}`} className="h-full w-full object-contain" /> : <Store className="h-4 w-4 text-slate-300" />}</div>
          <span className="max-w-[180px] truncate text-sm font-bold text-white">{companyName}</span>
        </div>
        <button onClick={() => onOpenMobile?.(true)} className="rounded-md px-2 py-1 text-sm text-slate-300">
          Menu
        </button>
      </div>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => onOpenMobile?.(false)} />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-slate-900">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-sm font-bold text-white">Navegação</span>
              <button onClick={() => onOpenMobile?.(false)} className="text-slate-400">✕</button>
            </div>
            <NavList />
            <div className="border-t border-slate-800 px-4 py-3"><div className="flex items-center gap-2"><img src="/branding/f7-icon.png" alt="F7 PRO BUSINESS" className="h-8 w-8 object-contain" /><div><p className="text-xs font-bold text-white">F7 PRO BUSINESS</p><p className="text-[10px] text-slate-400">Venda. Atenda. Automatize.</p></div></div></div>
          </div>
        </div>
      )}

      <div className="h-12 md:hidden" />
      <CompanyLogoDialog open={logoOpen} onClose={() => setLogoOpen(false)} companyId={company?.id} role={role} currentLogo={companyLogo} currentLogoPath={company?.logo_path} onSaved={async (result) => { setCompanyLogo(result?.url || ''); await refresh(); }} />
    </>
  );
}
