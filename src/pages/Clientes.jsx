// F7 PRO BUSINESS — Clientes
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Trash2, Pencil, MessageCircle, Mail } from 'lucide-react';
import { customersService } from '@/services/customersService';
import { fmtMoney, fmtDate } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import CustomerDialog from '@/components/clients/CustomerDialog';
import { Button } from '@/components/ui/button';

const STATUS_STYLE = {
  lead: 'bg-slate-100 text-slate-600',
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-rose-100 text-rose-700',
};
const STATUS_LABEL = { lead: 'Lead', active: 'Ativo', inactive: 'Inativo' };

export default function Clientes() {
  const { company } = useOutletContext();
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    if (!company) return;
    setItems(await customersService.list(company.id));
  };
  useEffect(() => { load(); }, [company]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((c) => {
      const matchQ = !query || c.name?.toLowerCase().includes(query.toLowerCase()) || c.document?.includes(query);
      const matchS = statusFilter === 'all' || c.status === statusFilter;
      return matchQ && matchS;
    });
  }, [items, query, statusFilter]);

  const handleSave = async (form) => {
    if (editing) {
      await customersService.update(company.id, editing.id, form);
    } else {
      await customersService.create(company.id, { ...form, total_purchased: 0, sale_count: 0, avg_ticket: 0 });
    }
    load();
  };

  const handleDelete = async (id) => {
    await customersService.remove(company.id, id);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Clientes"
        subtitle="Cadastro completo de pessoas físicas e jurídicas."
        action={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Novo cliente</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou documento..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400" />
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {[['all', 'Todos'], ['lead', 'Leads'], ['active', 'Ativos'], ['inactive', 'Inativos']].map(([v, l]) => (
            <button key={v} onClick={() => setStatusFilter(v)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${statusFilter === v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhum cliente encontrado</p>
            <p className="mt-1 text-xs text-slate-400">Cadastre seu primeiro cliente para começar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Contato</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Total comprado</th>
                  <th className="px-4 py-3 font-medium">Última compra</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{c.name?.charAt(0)}</span>
                        <div>
                          <p className="font-medium text-slate-800">{c.name}</p>
                          <p className="text-xs text-slate-400">{c.document || '—'} · Classe {c.classification?.toUpperCase()}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {c.whatsapp && <MessageCircle className="h-3.5 w-3.5" />}
                        <span>{c.phone || c.whatsapp || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        {c.email && <Mail className="h-3 w-3" />}
                        <span>{c.email || ''}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[c.status] || STATUS_STYLE.lead}`}>{STATUS_LABEL[c.status] || c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(c.total_purchased)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(c.last_purchase_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => { setEditing(c); setDialogOpen(true); }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(c.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CustomerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={handleSave} initial={editing} />
    </div>
  );
}
