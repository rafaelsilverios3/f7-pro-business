import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export const ROLE_LABELS = {
  admin: 'Administrador',
  gestor: 'Gestor',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  vendedor: 'Vendedor',
  estoque: 'Estoque',
  atendimento: 'Atendimento',
};

export const ROLE_COLORS = {
  admin: 'bg-violet-100 text-violet-700',
  gestor: 'bg-blue-100 text-blue-700',
  financeiro: 'bg-emerald-100 text-emerald-700',
  comercial: 'bg-amber-100 text-amber-700',
  vendedor: 'bg-cyan-100 text-cyan-700',
  estoque: 'bg-orange-100 text-orange-700',
  atendimento: 'bg-pink-100 text-pink-700',
};

const ALL_PERMS = {
  view: true, create: true, edit: true, delete: true, export: true,
  see_costs: true, see_profit: true, access_finance: true,
};

export const ROLE_DEFAULTS = {
  admin: { ...ALL_PERMS },
  gestor: { view: true, create: true, edit: true, delete: false, export: true, see_costs: true, see_profit: true, access_finance: true },
  financeiro: { view: true, create: true, edit: true, delete: false, export: true, see_costs: true, see_profit: true, access_finance: true },
  comercial: { view: true, create: true, edit: true, delete: false, export: true, see_costs: false, see_profit: false, access_finance: false },
  vendedor: { view: true, create: true, edit: true, delete: false, export: false, see_costs: false, see_profit: false, access_finance: false },
  estoque: { view: true, create: true, edit: true, delete: false, export: true, see_costs: true, see_profit: false, access_finance: false },
  atendimento: { view: true, create: true, edit: true, delete: false, export: false, see_costs: false, see_profit: false, access_finance: false },
};

export const PERMISSION_LABELS = {
  view: 'Visualizar',
  create: 'Criar',
  edit: 'Editar',
  delete: 'Excluir',
  export: 'Exportar',
  see_costs: 'Ver custos',
  see_profit: 'Ver lucro',
  access_finance: 'Acessar financeiro',
};

export function resolvePermissions(user) {
  if (!user) return null;
  const role = user.data?.role || user.role || 'admin';
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.vendedor;
  const custom = user.data?.permissions || {};
  if (role === 'admin') return { ...ALL_PERMS };
  return { ...defaults, ...custom };
}

export function usePermissions() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const me = await base44.auth.me();
      setUser(me);
    } catch { setUser(null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const permissions = resolvePermissions(user);
  const can = useCallback((perm) => {
    if (!permissions) return false;
    return !!permissions[perm];
  }, [permissions]);

  const role = user?.data?.role || user?.role || 'admin';
  const isAdmin = role === 'admin';

  return { user, permissions, can, role, isAdmin, loading, reload: load };
}