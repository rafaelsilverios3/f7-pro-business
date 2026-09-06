import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UserPlus, Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getDataProvider } from '@/data/providerSelector';
import { ROLE_LABELS, ROLE_COLORS, PERMISSION_LABELS, ROLE_DEFAULTS, resolvePermissions } from '@/lib/permissions';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePermissions } from '@/lib/permissions';
import { useAuth } from '@/lib/AuthContext';

export default function Usuarios() {
  const { company } = useOutletContext();
  const { isAdmin: legacyAdmin } = usePermissions();
  const { user: authUser } = useAuth();
  const [actorRole, setActorRole] = useState(null);
  const isAdmin = import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? ['admin', 'gestor'].includes(actorRole) : legacyAdmin;
  const [users, setUsers] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('vendedor');
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    if (!company) return;
    try {
      const provider = getDataProvider();
      const list = await provider.listMembers(company.id);
      setUsers(list);
      setActorRole(list.find((item) => item.user_id === authUser?.id)?.role || null);
    } catch { setUsers([]); }
  };
  useEffect(() => { load(); }, [company]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail || inviting) return;
    setInviting(true);
    try {
      if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') throw new Error('Convites exigem uma Edge Function segura e ainda não estão habilitados.');
      await base44.users.inviteUser(inviteEmail, inviteRole);
      setInviteEmail('');
      setInviteOpen(false);
      load();
      alert('Convite enviado com sucesso!');
    } catch (err) {
      alert('Erro ao convidar: ' + (err.message || 'verifique as permissões'));
    }
    setInviting(false);
  };

  const handleToggleActive = async (user) => {
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') await getDataProvider().rpc('set_company_member_active', { target_company: company.id, target_user: user.user_id, is_active: user.active === false });
    else await base44.auth.updateMe({});
    load();
  };

  const handleSetRole = async (user, role) => {
    try {
      if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') await getDataProvider().rpc('update_company_member_role', { target_company: company.id, target_user: user.user_id, new_role: role });
      else await base44.entities.User.update(user.id, { role });
      load();
    } catch (err) {
      alert('Erro: ' + (err.message || 'sem permissão'));
    }
  };

  const handleSavePermissions = async (perms) => {
    try {
      if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') await base44.entities.User.update(permsOpen.id, { permissions: perms });
      setPermsOpen(null);
      load();
    } catch (err) {
      alert('Erro ao salvar permissões: ' + (err.message || ''));
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader
        title="Usuários e Permissões"
        subtitle="Gerencie acessos, papéis e permissões da equipe."
        action={isAdmin && <Button onClick={() => setInviteOpen(true)}><UserPlus className="mr-1.5 h-4 w-4" /> Convidar usuário</Button>}
      />

      {!isAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          <ShieldOff className="h-4 w-4" /> Apenas administradores podem convidar usuários e configurar permissões.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!users ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhum usuário</p>
            <p className="mt-1 text-xs text-slate-400">Convide membros da equipe para colaborar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Usuário</th>
                  <th className="px-4 py-3 font-medium">Papel</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Permissões</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const role = u.data?.role || u.role || 'user';
                  const active = u.data?.active ?? (u.active !== false);
                  return (
                    <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                            {(u.full_name || u.name || u.email || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">{u.full_name || u.name || u.email}</p>
                            <p className="text-[10px] text-slate-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <select value={role} onChange={(e) => handleSetRole(u, e.target.value)} className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${ROLE_COLORS[role] || 'bg-slate-100 text-slate-600'}`}>
                            {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        ) : (
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_COLORS[role] || 'bg-slate-100 text-slate-600'}`}>{ROLE_LABELS[role] || role}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{active ? 'Ativo' : 'Inativo'}</span>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin && role !== 'admin' ? (
                          <button onClick={() => setPermsOpen(u)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
                            <Shield className="h-3.5 w-3.5" /> Configurar
                          </button>
                        ) : role === 'admin' ? (
                          <span className="flex items-center gap-1 text-xs text-violet-600"><ShieldCheck className="h-3.5 w-3.5" /> Acesso total</span>
                        ) : (
                          <span className="text-xs text-slate-400">{Object.keys(resolvePermissions(u) || {}).filter((k) => resolvePermissions(u)[k]).length} permissões</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdmin && role !== 'admin' && (
                          <button onClick={() => handleToggleActive(u)} className="text-xs text-slate-400 hover:text-slate-600">
                            {active ? 'Desativar' : 'Ativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={() => setInviteOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Convidar usuário</DialogTitle></DialogHeader>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">E-mail *</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Papel</Label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <p>O usuário receberá um convite por e-mail e poderá acessar o sistema com o papel selecionado.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={inviting}>{inviting ? 'Enviando...' : 'Enviar convite'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Permissions dialog */}
      {permsOpen && (
        <PermissionsDialog user={permsOpen} onClose={() => setPermsOpen(null)} onSave={handleSavePermissions} />
      )}
    </div>
  );
}

function PermissionsDialog({ user, onClose, onSave }) {
  const role = user.data?.role || user.role || 'user';
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.vendedor;
  const current = user.data?.permissions || {};
  const [perms, setPerms] = useState({ ...defaults, ...current });

  const toggle = (k) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Permissões — {user.full_name || user.email}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Papel: <span className={`rounded-full px-2 py-0.5 ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span></p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5">
                <input type="checkbox" checked={!!perms[key]} onChange={() => toggle(key)} className="h-4 w-4 rounded accent-indigo-600" />
                <span className="text-xs text-slate-700">{label}</span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(perms)}>Salvar permissões</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
