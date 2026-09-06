// F7 PRO BUSINESS — Configurações
import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Building2, Save, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompany } from '@/lib/useCompany';

export default function Configuracoes() {
  const { company } = useOutletContext();
  const { refresh } = useCompany();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (company) setForm({ ...company });
  }, [company]);

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  const save = async (e) => {
    e.preventDefault();
    await base44.entities.Company.update(form.id, {
      name: form.name, legal_name: form.legal_name, document: form.document,
      phone: form.phone, whatsapp: form.whatsapp, email: form.email,
      address: form.address, currency: form.currency,
    });
    await refresh();
    setSaved(true);
  };

  if (!form) return <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader title="Configurações da Empresa" subtitle="Dados comerciais e preferências do seu negócio." />
      <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{form.name || 'Sua empresa'}</p>
            <p className="text-xs text-slate-400">{form.document || 'Sem documento'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome fantasia *</Label>
            <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Razão social</Label>
            <Input value={form.legal_name || ''} onChange={(e) => set('legal_name', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">CNPJ / CPF</Label>
            <Input value={form.document || ''} onChange={(e) => set('document', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Moeda</Label>
            <select value={form.currency || 'BRL'} onChange={(e) => set('currency', e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
              <option value="BRL">Real (R$)</option>
              <option value="USD">Dólar ($)</option>
              <option value="EUR">Euro (€)</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Telefone</Label>
            <Input value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">WhatsApp</Label>
            <Input value={form.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">E-mail</Label>
            <Input type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Endereço</Label>
          <Input value={form.address || ''} onChange={(e) => set('address', e.target.value)} />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit"><Save className="mr-1.5 h-4 w-4" /> Salvar alterações</Button>
          {saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><Check className="h-4 w-4" /> Salvo com sucesso</span>}
        </div>
      </form>
    </div>
  );
}