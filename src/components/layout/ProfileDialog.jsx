import React, { useEffect, useState } from 'react';
import { Building2, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';
import { applyTheme } from '@/lib/theme';

const roleLabels = { admin: 'Administrador', gestor: 'Gestor', financeiro: 'Financeiro', comercial: 'Comercial', vendedor: 'Vendedor', estoque: 'Estoque', atendimento: 'Atendimento' };

export default function ProfileDialog({ open, onClose, user, company, role, profileName, theme: currentTheme, onThemeChange, onSaved }) {
  const { updatePassword } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('f7_theme') || 'dark');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
    setName(profileName || user?.full_name || user?.name || metadata.full_name || metadata.name || '');
    let stored = {};
    try { stored = user?.id ? JSON.parse(localStorage.getItem(`f7_profile_${user.id}`) || '{}') : {}; } catch { stored = {}; }
    setPhone(stored.phone || ''); setTitle(stored.title || ''); setTheme(currentTheme || localStorage.getItem('f7_theme') || 'dark');
    setPassword(''); setPasswordConfirmation(''); setPasswordOpen(false);
    setError('');
  }, [open, user]);

  const save = async (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || cleanName.includes('@')) { setError('Informe um nome real para o perfil.'); return; }
    setSaving(true); setError('');
    try {
      if (import.meta.env.VITE_DATA_PROVIDER === 'supabase' && user?.id) {
        const client = getSupabaseClient();
        const { data: existing, error: lookupError } = await client.from('profiles').select('id').eq('id', user.id).maybeSingle();
        if (lookupError) throw lookupError;
        if (existing?.id) {
          const { error: updateError } = await client.from('profiles').update({ name: cleanName }).eq('id', user.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await client.from('profiles').insert({ id: user.id, name: cleanName, email: user.email || null });
          if (insertError) throw insertError;
        }
      }
      if (user?.id) localStorage.setItem(`f7_profile_${user.id}`, JSON.stringify({ phone: phone.trim(), title: title.trim() }));
      applyTheme(theme); onThemeChange?.(theme);
      onSaved?.(cleanName);
      onClose();
    } catch (cause) { setError(cause.message || 'Não foi possível salvar o perfil.'); }
    finally { setSaving(false); }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (password.length < 8) { setError('A nova senha deve ter pelo menos 8 caracteres.'); return; }
    if (password !== passwordConfirmation) { setError('As senhas não coincidem.'); return; }
    setSaving(true); setError('');
    try { await updatePassword(password); setPassword(''); setPasswordConfirmation(''); setPasswordOpen(false); }
    catch (cause) { setError(cause.message || 'Não foi possível alterar a senha.'); }
    finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={onClose}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-blue-300" /> Minha conta</DialogTitle></DialogHeader><div className="max-h-[78vh] space-y-5 overflow-y-auto pr-1"><section className="space-y-3"><p className="f7-form-section-title">Perfil</p><div className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-[#0b1728] p-3"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-sm font-bold text-white">{name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'}</div><div><p className="text-sm font-semibold text-white">{name || 'Seu perfil'}</p><p className="text-[11px] text-slate-400">As iniciais são usadas enquanto não houver avatar.</p></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="profile-name">Nome completo</Label><Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rafael Silverio" autoFocus /></div><div className="space-y-1.5"><Label htmlFor="profile-phone">Telefone</Label><Input id="profile-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" /></div><div className="space-y-1.5"><Label htmlFor="profile-title">Título profissional</Label><Input id="profile-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Diretor comercial" /></div></div></section><section className="space-y-3"><p className="f7-form-section-title">Conta</p><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>E-mail</Label><Input value={user?.email || ''} disabled /></div><div className="space-y-1.5"><Label>Role</Label><div className="flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-[#101f33] px-3 text-sm text-slate-200"><ShieldCheck className="h-4 w-4 text-emerald-300" />{roleLabels[role] || (role && role !== 'authenticated' ? role : 'Função indisponível')}</div></div><div className="space-y-1.5"><Label>Empresa atual</Label><div className="flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-[#101f33] px-3 text-sm text-slate-200"><Building2 className="h-4 w-4 text-blue-300" />{company?.name || 'Sem empresa'}</div></div><div className="space-y-1.5"><Label>Status</Label><div className="flex h-9 items-center rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 text-sm text-emerald-300">Ativo</div></div></div><p className="text-[11px] text-slate-500">A role é administrada pela empresa e não pode ser alterada neste painel.</p></section><section className="space-y-3"><p className="f7-form-section-title">Segurança</p><div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-[#0b1728] p-3"><div><p className="text-sm font-medium text-white">Senha de acesso</p><p className="text-[11px] text-slate-400">Altere sua senha usando o Supabase Auth.</p></div><Button type="button" variant="outline" size="sm" onClick={() => { setPasswordOpen((value) => !value); setError(''); }}><KeyRound className="mr-1.5 h-3.5 w-3.5" /> Alterar senha</Button></div>{passwordOpen && <form onSubmit={changePassword} className="grid gap-3 rounded-xl border border-blue-400/20 bg-blue-400/5 p-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Nova senha</Label><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div><div className="space-y-1.5"><Label>Confirmar senha</Label><Input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" /></div><Button type="submit" disabled={saving} className="sm:col-span-2">{saving ? 'Salvando...' : 'Confirmar nova senha'}</Button></form>}</section><section className="space-y-3"><p className="f7-form-section-title">Preferências</p><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="profile-theme">Tema</Label><select id="profile-theme" value={theme} onChange={(event) => { setTheme(event.target.value); applyTheme(event.target.value); onThemeChange?.(event.target.value); }} className="h-9 w-full rounded-md border border-slate-700 bg-[#101f33] px-3 text-sm text-white"><option value="dark">Escuro (F7)</option><option value="system">Dia (Sistema)</option></select></div><div className="space-y-1.5"><Label>Idioma</Label><Input value="Português (Brasil)" disabled /></div></div></section>{error && <p className="text-xs text-rose-300">{error}</p>}<DialogFooter className="border-t border-slate-700/70 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="button" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</Button></DialogFooter></div></DialogContent></Dialog>;
}
