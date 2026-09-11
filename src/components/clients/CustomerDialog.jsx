// F7 PRO BUSINESS — Dialog de cliente
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function CustomerDialog({ open, onClose, onSave, initial }) {
  const [form, setForm] = useState({
    name: '', type: 'pf', document: '', phone: '', whatsapp: '', email: '',
    address: '', lead_source: 'Indicação', owner: '', notes: '', status: 'lead', classification: 'b',
  });

  useEffect(() => {
    if (initial) setForm({ ...form, ...initial });
    else setForm({ name: '', type: 'pf', document: '', phone: '', whatsapp: '', email: '', address: '', lead_source: 'Indicação', owner: '', notes: '', status: 'lead', classification: 'b' });
  }, [initial, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await onSave(form);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex min-h-0 max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden pr-1">
          <section className="space-y-3">
            <p className="f7-form-section-title">Identificação</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <div className="flex gap-1.5">
                  {['pf', 'pj'].map((t) => <button key={t} type="button" onClick={() => set('type', t)} className={`flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition duration-200 ${form.type === t ? 'border-blue-400 bg-blue-500/20 text-blue-100 shadow-[0_0_0_1px_rgba(58,160,255,.35)]' : 'border-slate-600 bg-slate-900/40 text-slate-400 hover:border-slate-500 hover:text-white'}`}>{t === 'pf' ? 'Pessoa Física' : 'Pessoa Jurídica'}</button>)}
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Classificação</Label>
                <div className="flex gap-1.5">
                  {['a', 'b', 'c'].map((t) => <button key={t} type="button" onClick={() => set('classification', t)} className={`flex-1 rounded-lg border px-3 py-2.5 text-xs font-bold uppercase transition duration-200 ${form.classification === t ? 'border-blue-400 bg-blue-500/20 text-blue-100 shadow-[0_0_0_1px_rgba(58,160,255,.35)]' : 'border-slate-600 bg-slate-900/40 text-slate-400 hover:border-slate-500 hover:text-white'}`}>{t}</button>)}
                </div>
              </div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Nome / Razão Social *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Nome do cliente" /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">{form.type === 'pf' ? 'CPF' : 'CNPJ'}</Label><Input value={form.document} onChange={(e) => set('document', e.target.value)} placeholder="Documento" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Status</Label><select value={form.status} onChange={(e) => set('status', e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="lead">Lead</option><option value="active">Ativo</option><option value="inactive">Inativo</option></select></div>
            </div>
          </section>
          <section className="space-y-3">
            <p className="f7-form-section-title">Contato</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">Telefone</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">E-mail</Label><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </section>
          <section className="space-y-3">
            <p className="f7-form-section-title">Comercial</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">Origem do Lead</Label><Input value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Responsável</Label><Input value={form.owner} onChange={(e) => set('owner', e.target.value)} /></div>
            </div>
          </section>
          <section className="space-y-3">
            <p className="f7-form-section-title">Endereço e observações</p>
            <div className="space-y-1.5"><Label className="text-xs">Endereço</Label><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="resize-none" /></div>
          </section>
          <DialogFooter className="sticky bottom-0 border-t border-slate-700/70 bg-background pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">{initial ? 'Salvar' : 'Adicionar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
