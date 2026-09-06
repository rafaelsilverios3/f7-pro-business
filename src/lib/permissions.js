export const ROLES = Object.freeze(['admin', 'gestor', 'financeiro', 'comercial', 'vendedor', 'estoque', 'atendimento']);
export const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor', financeiro: 'Financeiro', comercial: 'Comercial', vendedor: 'Vendedor', estoque: 'Estoque', atendimento: 'Atendimento' };
export const ROLE_COLORS = { admin: 'bg-violet-100 text-violet-700', gestor: 'bg-blue-100 text-blue-700', financeiro: 'bg-emerald-100 text-emerald-700', comercial: 'bg-amber-100 text-amber-700', vendedor: 'bg-slate-100 text-slate-700', estoque: 'bg-orange-100 text-orange-700', atendimento: 'bg-pink-100 text-pink-700' };
export const PERMISSION_LABELS = {};
const ROLE_PERMISSIONS = {
  admin: ['*'], gestor: ['*'], financeiro: ['finance.*', 'dashboard.view'], comercial: ['customers.*', 'products.view', 'sales.*', 'quotes.*', 'dashboard.view'], vendedor: ['customers.view', 'customers.create', 'products.view', 'sales.*', 'quotes.*'], estoque: ['products.view', 'inventory.*', 'purchases.*'], atendimento: ['customers.view', 'customers.create', 'conversation.*'],
};
export const ROLE_DEFAULTS = Object.fromEntries(ROLES.map((role) => [role, ROLE_PERMISSIONS[role] || []]));
export function can(user, permission) { const permissions = ROLE_PERMISSIONS[user?.role] || []; return permissions.includes('*') || permissions.some((item) => item.endsWith('.*') ? permission.startsWith(item.slice(0, -1)) : item === permission); }
export function resolvePermissions(user) { return user?.permissions || ROLE_PERMISSIONS[user?.role] || []; }
export function usePermissions(user) { const auth = user ? { user } : useAuth(); const current = auth.user; return { isAdmin: current?.role === 'admin' || current?.role === 'gestor', can: (permission) => can(current, permission) }; }
import { useAuth } from '@/lib/AuthContext';
