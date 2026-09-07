import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, Boxes, ShoppingCart, FileText,
  Wallet, Truck, MessageSquare, Zap, BrainCircuit, BarChart3,
  Settings, Bell, Target, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  {
    group: 'Principal',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    group: 'Operação',
    items: [
      { to: '/clientes', label: 'Clientes', icon: Users },
      { to: '/produtos', label: 'Produtos', icon: Package },
      { to: '/estoque', label: 'Estoque', icon: Boxes },
      { to: '/vendas', label: 'Vendas', icon: ShoppingCart },
      { to: '/orcamentos', label: 'Orçamentos', icon: FileText },
      { to: '/financeiro', label: 'Financeiro', icon: Wallet },
      { to: '/compras', label: 'Compras', icon: Truck },
      { to: '/metas', label: 'Metas e Comissões', icon: Target },
    ],
  },
  {
    group: 'Inteligência',
    items: [
      { to: '/atendimento', label: 'Smart Atendimento', icon: MessageSquare },
      { to: '/automacoes', label: 'Automações', icon: Zap },
      { to: '/intelligence', label: 'F7 Intelligence', icon: BrainCircuit },
      { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { to: '/notificacoes', label: 'Notificações', icon: Bell },
      { to: '/usuarios', label: 'Usuários', icon: Shield },
      { to: '/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
];

export default function Sidebar({ company, onOpenMobile, mobileOpen }) {
  const location = useLocation();

  const NavList = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-2">
      {NAV.map((section) => (
        <div key={section.group} className="mb-5">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {section.group}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => {
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
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
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
          <img src="/branding/f7-icon.png" alt="F7" className="h-11 w-11 object-contain" />
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight text-white">F7 PRO BUSINESS</p>
            <p className="text-[10px] text-slate-400">Venda. Atenda. Automatize.</p>
          </div>
        </div>
        <NavList />
        <div className="border-t border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
              {(company?.name || 'E').charAt(0)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-medium text-white">{company?.name || 'Sem empresa'}</p>
              <p className="text-[10px] text-slate-400">{company?.plan ? `Plano ${company.plan}` : 'Plano atual'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <img src="/branding/f7-icon.png" alt="F7" className="h-8 w-8 object-contain" />
          <span className="text-sm font-bold text-white">F7 PRO BUSINESS</span>
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
          </div>
        </div>
      )}

      <div className="h-12 md:hidden" />
    </>
  );
}
