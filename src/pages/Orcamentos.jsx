import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Eye, Edit2, FileCheck, FileDown, Mail, MessageCircle, Printer, Send } from 'lucide-react';
import { quotesRepository } from '@/data/repositories/quotesRepository';
import { fmtMoney, fmtDate } from '@/lib/business';
import { quotesService } from '@/services/quotesService';
import { getDataProvider } from '@/data/providerSelector';
import { runAutomations } from '@/lib/automations';
import PageHeader from '@/components/layout/PageHeader';
import QuoteDialog from '@/components/orcamentos/QuoteDialog';
import { Button } from '@/components/ui/button';
import { buildQuoteShareText, downloadQuotePdf, openWhatsAppDraft, printQuote, quoteReference } from '@/lib/commercialDocuments';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-cyan-100 text-cyan-700',
  negotiating: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  billing_pending: 'bg-violet-100 text-violet-700',
  refused: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-500',
  converted: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-500',
};
const STATUS_LABEL = {
  draft: 'Rascunho', sent: 'Enviado', viewed: 'Visualizado', negotiating: 'Em negociação',
  approved: 'Aprovado', refused: 'Recusado', expired: 'Expirado',
  billing_pending: 'Aguardando faturamento', converted: 'Convertido', cancelled: 'Cancelado',
};
const FILTERS = [
  { id: 'all', label: 'Todos', statuses: null },
  { id: 'open', label: 'Aberto', statuses: ['draft'] },
  { id: 'sent', label: 'Enviado', statuses: ['sent'] },
  { id: 'negotiating', label: 'Em negociação', statuses: ['viewed', 'negotiating', 'approved'] },
  { id: 'billing', label: 'Aguardando faturamento', statuses: ['billing_pending'] },
  { id: 'cancelled', label: 'Cancelado', statuses: ['cancelled', 'refused', 'expired'] },
  { id: 'converted', label: 'Convertido', statuses: ['converted'] },
];
const STATUS_FLOW = ['draft', 'sent', 'viewed', 'negotiating', 'approved', 'billing_pending', 'refused', 'expired', 'cancelled', 'converted'];
const STATUS_OPTIONS = {
  draft: ['draft', 'sent', 'negotiating', 'approved', 'cancelled'],
  sent: ['sent', 'viewed', 'negotiating', 'approved', 'cancelled'],
  viewed: ['viewed', 'negotiating', 'approved', 'cancelled'],
  negotiating: ['negotiating', 'approved', 'cancelled'],
  approved: ['approved', 'cancelled'],
  billing_pending: ['billing_pending', 'cancelled'],
};

export default function Orcamentos() {
  const { company } = useOutletContext();
  const [items, setItems] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = async () => {
    if (!company) return;
    const provider = getDataProvider();
    const [quotes, customerRows, memberRows] = await Promise.all([
      quotesRepository.list(company.id),
      provider.entity('Customer').filter({ company_id: company.id }, '-created_date', 500),
      provider.listMembers ? provider.listMembers(company.id) : Promise.resolve([]),
    ]);
    setItems(quotes);
    setCustomers(customerRows);
    setMembers(memberRows);
  };
  useEffect(() => { load(); }, [company]);
  useEffect(() => {
    const quoteId = searchParams.get('open');
    if (quoteId && items) {
      const quote = items.find((row) => row.id === quoteId);
      if (quote) setViewing(quote);
      setSearchParams({}, { replace: true });
    }
  }, [items, searchParams, setSearchParams]);

  const stats = useMemo(() => {
    if (!items) return { count: 0, total: 0, approved: 0, byStatus: {} };
    const byStatus = Object.fromEntries(STATUS_FLOW.map((status) => [status, items.filter((quote) => quote.status === status).length]));
    return {
      count: items.length,
      total: items.reduce((s, q) => s + (q.total || 0), 0),
      approved: items.filter((q) => q.status === 'approved').length,
      byStatus,
    };
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const selected = FILTERS.find((item) => item.id === filter);
    if (!selected?.statuses) return items;
    return items.filter((q) => selected.statuses.includes(q.status));
  }, [items, filter]);

  const handleStatusChange = async (quote, status) => {
    try {
      if (status === 'cancelled') {
        const reason = prompt('Informe o motivo do cancelamento do orçamento:');
        if (reason === null) return;
        await quotesService.cancel(quote, reason);
      } else await quotesService.updateStatus(company.id, quote.id, status);
      setViewing((current) => current?.id === quote.id ? { ...current, status } : current);
      if (status === 'approved' && import.meta.env.VITE_DATA_PROVIDER !== 'supabase') await runAutomations(company.id, 'quote_approved', { ...quote, _type: 'quote', customer_name: quote.customer_name });
      await load();
    } catch (error) { alert(`Não foi possível atualizar o orçamento: ${error.message}`); }
  };

  const handleSendToSales = async (quote) => {
    if (!confirm(`Enviar ${quoteReference(quote)} para Vendas? A venda ficará aguardando faturamento, sem movimentar estoque ou financeiro.`)) return;
    try {
      await quotesService.sendToSales(quote);
      setViewing(null);
      await load();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  };

  const customerName = (quote) => customers.find((customer) => customer.id === quote.customer_id)?.name || quote.customer_name || 'Cliente não informado';
  const quoteCustomer = (quote) => customers.find((customer) => customer.id === quote.customer_id);
  const sellerName = (quote) => members.find((member) => member.user_id === quote.seller_user_id)?.name || members.find((member) => member.user_id === quote.seller_user_id)?.email || '—';

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Orçamentos"
        subtitle="Crie propostas numeradas e envie para faturamento quando aprovadas."
        action={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Novo orçamento</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Total de orçamentos</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.count}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Valor total cotado</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Abertos</p><p className="mt-1 text-xl font-semibold text-blue-600">{stats.byStatus.draft || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Enviados</p><p className="mt-1 text-xl font-semibold text-blue-600">{stats.byStatus.sent || 0}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Em negociação</p><p className="mt-1 text-xl font-semibold text-amber-600">{(stats.byStatus.viewed || 0) + (stats.byStatus.negotiating || 0) + stats.approved}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Convertidos</p><p className="mt-1 text-xl font-semibold text-emerald-600">{stats.byStatus.converted || 0}</p></div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button key={item.id} onClick={() => setFilter(item.id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === item.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>{item.label}</button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhum orçamento</p>
            <p className="mt-1 text-xs text-slate-400">Crie seu primeiro orçamento para começar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Vendedor</th>
                  <th className="px-4 py-3 font-medium">Validade</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800"><span>{customerName(q)}</span><span className="mt-1 block font-mono text-[10px] text-slate-400">{quoteReference(q)}</span></td>
                    <td className="px-4 py-3 text-slate-500">{sellerName(q)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(q.valid_until)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(q.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={q.status}
                        onChange={(e) => handleStatusChange(q, e.target.value)}
                        className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[q.status]}`}
                      >
                        {(STATUS_OPTIONS[q.status] || [q.status]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setViewing(q)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
                        {['draft', 'sent', 'viewed', 'negotiating'].includes(q.status) && <button onClick={() => { setEditing(q); setDialogOpen(true); }} title="Editar orçamento" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Edit2 className="h-4 w-4" /></button>}
                        {q.status === 'approved' && !q.sale_id && (
                          <button onClick={() => handleSendToSales(q)} title="Enviar para vendas — aguarda faturamento" className="rounded-md p-1.5 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"><FileCheck className="h-4 w-4" /></button>
                        )}
                        {q.status === 'billing_pending' && q.sale_id && (
                          <a href={`/vendas?open=${encodeURIComponent(q.sale_id)}`} className="flex items-center rounded-md bg-violet-50 px-2 text-[10px] font-medium text-violet-700">Abrir venda</a>
                        )}
                        {q.status === 'converted' && (
                          <span className="flex items-center rounded-md bg-emerald-50 px-2 text-[10px] font-medium text-emerald-700">Faturado</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <QuoteDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditing(null); }} company={company} quote={editing} onDone={load} />

      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Orçamento — {viewing && customerName(viewing)}</DialogTitle></DialogHeader>
          {viewing && (
              <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => { printQuote(viewing, company, customerName(viewing)); if (['draft', 'sent', 'viewed'].includes(viewing.status)) void handleStatusChange(viewing, 'negotiating'); }}><Printer className="mr-1.5 h-4 w-4" /> Imprimir</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { downloadQuotePdf(viewing, company, customerName(viewing)); if (['draft', 'sent', 'viewed'].includes(viewing.status)) void handleStatusChange(viewing, 'negotiating'); }}><FileDown className="mr-1.5 h-4 w-4" /> Gerar PDF</Button>
                <Button type="button" size="sm" variant="outline" disabled={!quoteCustomer(viewing)?.email} onClick={() => { const text = buildQuoteShareText(viewing, company, customerName(viewing)); window.location.href = `mailto:${encodeURIComponent(quoteCustomer(viewing).email)}?subject=${encodeURIComponent(`Orçamento ${quoteReference(viewing)}`)}&body=${encodeURIComponent(text)}`; }}><Mail className="mr-1.5 h-4 w-4" /> Preparar e-mail</Button>
                <Button type="button" size="sm" variant="outline" disabled={!quoteCustomer(viewing)?.phone} onClick={() => openWhatsAppDraft(quoteCustomer(viewing).phone, buildQuoteShareText(viewing, company, customerName(viewing)))}><MessageCircle className="mr-1.5 h-4 w-4" /> Preparar WhatsApp</Button>
                {viewing.status === 'draft' && <Button type="button" size="sm" variant="outline" onClick={() => handleStatusChange(viewing, 'sent')}><Send className="mr-1.5 h-4 w-4" /> Marcar enviado</Button>}
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Vendedor</span><span>{sellerName(viewing)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Validade</span><span>{fmtDate(viewing.valid_until)}</span></div>
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-xs text-slate-500"><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Qtd</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {(viewing.items || []).map((i, idx) => (
                      <tr key={idx} className="border-b border-slate-50"><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 text-center">{i.qty}</td><td className="px-3 py-2 text-right">{fmtMoney(i.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(viewing.subtotal)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span>- {fmtMoney(viewing.discount)}</span></div>}
                <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(viewing.total)}</span></div>
              </div>
              {viewing.notes && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{viewing.notes}</div>}
                {viewing.status === 'approved' && !viewing.sale_id && (
                <Button onClick={() => handleSendToSales(viewing)} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <FileCheck className="mr-1.5 h-4 w-4" /> Enviar para vendas — aguarda faturamento
                </Button>
              )}
              {viewing.status === 'billing_pending' && viewing.sale_id && <a className="block rounded-lg bg-violet-600 px-4 py-2 text-center font-semibold text-white" href={`/vendas?open=${encodeURIComponent(viewing.sale_id)}`}>Abrir venda para faturamento</a>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
