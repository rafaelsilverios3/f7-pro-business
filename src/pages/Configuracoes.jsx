// F7 PRO BUSINESS — Configurações
import React, { useState, useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Building2, Save, Check, Plug, MessageSquare } from 'lucide-react';
import { getDataProvider } from '@/data/providerSelector';
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
    await getDataProvider().entity('Company').update(form.id, {
      name: form.name, legal_name: form.legal_name, document: form.document,
      phone: form.phone, whatsapp: form.whatsapp, email: form.email,
      store_slug: form.store_slug, store_enabled: Boolean(form.store_enabled),
      address: form.address, currency: form.currency,
    });
    await refresh();
    setSaved(true);
  };

  if (!form) return <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader title="Configurações da Empresa" subtitle="Dados comerciais e preferências do seu negócio." action={<div className="flex flex-wrap gap-2"><Link to="/configuracoes/atendimento" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#45617f] px-4 text-sm font-medium text-[#e7eef8] transition hover:bg-[#172a45]"><MessageSquare className="h-4 w-4" /> Atendimento</Link><Link to="/configuracoes/integracoes" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#45617f] px-4 text-sm font-medium text-[#e7eef8] transition hover:bg-[#172a45]"><Plug className="h-4 w-4" /> Integrações</Link></div>} />
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

        <div className="rounded-xl border border-blue-400/25 bg-blue-500/10 p-4">
          <p className="text-sm font-semibold text-slate-800">Loja online</p>
          <p className="mt-1 text-xs text-slate-500">Defina o endereço público e publique somente produtos ativos com estoque.</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs">Slug público</Label><Input value={form.store_slug || ''} onChange={(e) => set('store_slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))} placeholder="minha-empresa" /><p className="text-[11px] text-slate-500">/loja/{form.store_slug || 'minha-empresa'}</p></div>
            <label className="flex items-center gap-2 self-start pt-7 text-sm text-slate-700"><input type="checkbox" checked={Boolean(form.store_enabled)} onChange={(e) => set('store_enabled', e.target.checked)} /> Publicar loja</label>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit"><Save className="mr-1.5 h-4 w-4" /> Salvar alterações</Button>
          {saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><Check className="h-4 w-4" /> Salvo com sucesso</span>}
        </div>
      </form>
    </div>
  );
}
