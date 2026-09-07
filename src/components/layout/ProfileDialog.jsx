import React, { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export default function ProfileDialog({ open, onClose, user, onSaved }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
    setName(user?.full_name || user?.name || metadata.full_name || metadata.name || '');
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
      onSaved?.(cleanName);
      onClose();
    } catch (cause) { setError(cause.message || 'Não foi possível salvar o perfil.'); }
    finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={onClose}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-blue-300" /> Editar perfil</DialogTitle></DialogHeader><form onSubmit={save} className="space-y-4"><div className="space-y-1.5"><Label htmlFor="profile-name">Nome do perfil</Label><Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rafael Silverio" autoFocus /><p className="text-[11px] text-slate-500">Esse nome será usado na saudação e no topo do sistema.</p></div><div className="space-y-1.5"><Label>E-mail</Label><Input value={user?.email || ''} disabled /></div>{error && <p className="text-xs text-rose-300">{error}</p>}<DialogFooter className="border-t border-slate-700/70 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar perfil'}</Button></DialogFooter></form></DialogContent></Dialog>;
}
