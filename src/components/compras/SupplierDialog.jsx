import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';

export default function SupplierDialog({ open, onClose, company, onDone, editing }) {
  const [form, setForm] = useState({ name: '', legal_name: '', document: '', contact_name: '', phone: '', whatsapp: '', email: '', address: '', category: '', notes: '' });

  useEffect(() => {
    if (editing) setForm({ ...editing });
    else setForm({ name: '', legal_name: '', document: '', contact_name: '', phone: '', whatsapp: '', email: '', address: '', category: '', notes: '' });
  }, [editing, open]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (editing) {
      await base44.entities.Supplier.update(editing.id, { ...form, company_id: company.id });
    } else {
      await base44.entities.Supplier.create({ ...form, company_id: company.id, active: true });
    }
    onDone?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Editar fornecedor' : 'Novo fornecedor'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Razão Social</Label><Input value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">CNPJ/CPF</Label><Input value={form.document} onChange={(e) => set('document', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Contato</Label><Input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Categoria</Label><Input value={form.category} onChange={(e) => set('category', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Telefone</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">E-mail</Label><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Endereço</Label><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="resize-none" /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">{editing ? 'Salvar' : 'Cadastrar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}