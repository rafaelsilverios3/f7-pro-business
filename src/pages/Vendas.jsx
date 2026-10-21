// F7 PRO BUSINESS — Vendas
import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Eye, Ban, FileDown, Mail, MessageCircle, Printer, CreditCard } from 'lucide-react';
import { salesRepository } from '@/data/repositories/salesRepository';
import { fmtMoney, fmtDate } from '@/lib/business';
import { isRevenueSale, saleItemTotal } from '@/lib/saleStatus';
import { salesService } from '@/services/salesService';
import { getDataProvider } from '@/data/providerSelector';
import PageHeader from '@/components/layout/PageHeader';
import SaleDialog from '@/components/vendas/SaleDialog';
import QuoteBillingDialog from '@/components/vendas/QuoteBillingDialog';
import { quotesService } from '@/services/quotesService';
import { Button } from '@/components/ui/button';
import { downloadSaleReceiptPdf, saleReference } from '@/lib/commercialDocuments';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-700',
  paid: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-rose-100 text-rose-700',
};
const STATUS_LABEL = { draft: 'Rascunho', paid: 'Pago', pending: 'Pendente', completed: 'Concluída', cancelled: 'Cancelada', canceled: 'Cancelada' };

export default function Vendas() {
  const { company } = useOutletContext();
  const [items, setItems] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [billingSale, setBillingSale] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = async () => {
    if (!company) return;
    const provider = getDataProvider();
    const [sales, customerRows] = await Promise.all([
      salesRepository.list(company.id, '-sale_date'),
      provider.entity('Customer').filter({ company_id: company.id }, '-created_date', 500),
    ]);
    setItems(sales);
    setCustomers(customerRows);
  };
  useEffect(() => { load(); }, [company]);
  useEffect(() => {
    const saleId = searchParams.get('open');
    if (saleId && items) {
      const target = items.find((sale) => sale.id === saleId);
      if (target?.origin_quote_id && target.status === 'draft') setBillingSale(target);
      setSearchParams({}, { replace: true });
    }
  }, [items, searchParams, setSearchParams]);

  const stats = useMemo(() => {
    if (!items) return { count: 0, total: 0, profit: 0, cancelled: 0 };
    const valid = items.filter(isRevenueSale);
    return {
      count: valid.length,
      total: valid.reduce((s, x) => s + (x.total || 0), 0),
      profit: valid.reduce((s, x) => s + (x.profit || 0), 0),
      cancelled: items.filter((sale) => ['cancelled', 'canceled'].includes(sale.status)).length,
    };
  }, [items]);

  const handleCancel = async (sale) => {
    const reason = prompt(sale.status === 'draft' ? 'Motivo para cancelar a venda pendente:' : 'Motivo para cancelar e estornar a venda:');
    if (reason === null) return;
    try {
      await salesService.cancelWithReason(sale, reason);
      await load();
    } catch (error) { alert(`Não foi possível cancelar a venda: ${error.message}`); }
  };
  const returnToQuote = async (sale) => {
    if (!confirm('Retornar esta venda ao orçamento? A venda pendente será cancelada sem movimentos financeiros ou de estoque.')) return;
    try { await quotesService.returnToQuote(sale.id); setBillingSale(null); await load(); }
    catch (error) { alert(`Não foi possível retornar ao orçamento: ${error.message}`); }
  };
  const cancelPending = async (sale) => { await handleCancel(sale); setBillingSale(null); };
  const viewingCustomer = viewing && customers.find((customer) => customer.id === viewing.customer_id);
  const billingSaleWithCustomer = billingSale ? { ...billingSale, customer_name: customers.find((customer) => customer.id === billingSale.customer_id)?.name || billingSale.customer_name } : null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Vendas"
        subtitle="Acompanhe vendas pendentes de faturamento, concluídas e canceladas."
        action={<Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova venda</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Vendas no total</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.count}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Faturamento</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(stats.total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Lucro</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">{fmtMoney(stats.profit)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Canceladas</p><p className="mt-1 text-xl font-semibold text-rose-600">{stats.cancelled}</p></div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm"><p className="text-xs text-violet-700">Aguardando faturamento</p><p className="mt-1 text-xl font-semibold text-violet-800">{items?.filter((sale) => sale.status === 'draft' && sale.origin_quote_id).length || 0}</p></div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!items ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhuma venda registrada</p>
            <p className="mt-1 text-xs text-slate-400">Registre sua primeira venda para ver o estoque e o financeiro atualizarem.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Vendedor</th>
                  <th className="px-4 py-3 font-medium">Pagamento</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {[...items].sort((a, b) => Number(Boolean(b.origin_quote_id && b.status === 'draft')) - Number(Boolean(a.origin_quote_id && a.status === 'draft'))).map((s) => (
                  <tr key={s.id} className={`border-b border-slate-50 hover:bg-slate-50/50 ${s.status === 'cancelled' || s.status === 'canceled' ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800"><span>{customers.find((customer) => customer.id === s.customer_id)?.name || 'Cliente'}</span><span className="mt-1 block font-mono text-[10px] text-slate-400">{saleReference(s)}{s.origin_quote_number ? ` · ${s.origin_quote_number}` : ''}</span></td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(s.sale_date)}</td>
                    <td className="px-4 py-3 text-slate-500">{s.seller || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{s.payment_method || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(s.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.origin_quote_id && s.status === 'draft' ? 'bg-violet-100 text-violet-800' : STATUS_STYLE[s.status] || 'bg-slate-100 text-slate-600'}`}>{s.origin_quote_id && s.status === 'draft' ? 'Aguardando faturamento' : STATUS_LABEL[s.status] || s.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setViewing(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
                        {s.status === 'draft' && s.origin_quote_id && <button onClick={() => setBillingSale(s)} title="Faturar" className="inline-flex items-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"><CreditCard className="mr-1.5 h-4 w-4" /> FATURAR</button>}
                        {s.status !== 'cancelled' && s.status !== 'canceled' && (
                          <button onClick={() => handleCancel(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Ban className="h-4 w-4" /></button>
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

      <SaleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} company={company} onDone={load} />
      <QuoteBillingDialog sale={billingSaleWithCustomer} onClose={() => setBillingSale(null)} onFinalized={async (sale) => { setBillingSale(null); await load(); setViewing(sale); }} onReturnToQuote={() => billingSale && returnToQuote(billingSale)} onCancelSale={() => billingSale && cancelPending(billingSale)} />

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Venda {viewing ? saleReference(viewing) : ''} — {viewing?.customer_name}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">Comprovante comercial não fiscal. A emissão de NF-e/NFC-e exige integração com emissor autorizado e dados fiscais válidos.</p>
              {viewing.origin_quote_id && <a className="inline-flex rounded-md border px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5" href={`/orcamentos?open=${encodeURIComponent(viewing.origin_quote_id)}`}>Orçamento de origem {viewing.origin_quote_number}</a>}
              <div className="flex justify-between"><span className="text-slate-500">Data</span><span>{fmtDate(viewing.sale_date)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Vendedor</span><span>{viewing.seller || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pagamento</span><span>{viewing.payment_method} · {viewing.installments}x</span></div>
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-xs text-slate-500"><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Qtd</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {(viewing.items || []).map((i, idx) => (
                      <tr key={idx} className="border-b border-slate-50"><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 text-center">{i.qty ?? i.quantity}</td><td className="px-3 py-2 text-right">{fmtMoney(saleItemTotal(i))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(viewing.subtotal)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span>- {fmtMoney(viewing.discount)}</span></div>}
                <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmtMoney(viewing.total)}</span></div>
                <div className="flex justify-between text-emerald-600"><span>Lucro</span><span>{fmtMoney(viewing.profit)}</span></div>
              </div>
              {viewing.status === 'completed' && <div className="flex flex-wrap gap-2 border-t border-slate-700 pt-3">
                <Button type="button" variant="outline" size="sm" onClick={() => downloadSaleReceiptPdf({ ...viewing, customer_name: viewingCustomer?.name || viewing.customer_name }, company)}><FileDown className="mr-1.5 h-4 w-4" /> PDF não fiscal</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => downloadSaleReceiptPdf({ ...viewing, customer_name: viewingCustomer?.name || viewing.customer_name }, company)}><Printer className="mr-1.5 h-4 w-4" /> Imprimir comprovante</Button>
                <Button type="button" variant="outline" size="sm" disabled={!viewingCustomer?.email} onClick={() => { window.location.href = `mailto:${encodeURIComponent(viewingCustomer.email)}?subject=${encodeURIComponent(`Comprovante ${saleReference(viewing)}`)}&body=${encodeURIComponent(`Olá, segue o comprovante não fiscal ${saleReference(viewing)} no valor de ${fmtMoney(viewing.total)}.`)}`; }}><Mail className="mr-1.5 h-4 w-4" /> Preparar e-mail</Button>
                <Button type="button" variant="outline" size="sm" disabled={!viewingCustomer?.phone} onClick={() => { const text = `Comprovante comercial não fiscal ${saleReference(viewing)} · ${fmtMoney(viewing.total)}. Documento não substitui NF-e/NFC-e.`; window.open(`https://wa.me/${String(viewingCustomer.phone).replace(/\\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); }}><MessageCircle className="mr-1.5 h-4 w-4" /> Preparar WhatsApp</Button>
              </div>}
              {viewing.status === 'draft' && viewing.origin_quote_id && <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={() => { setViewing(null); setBillingSale(viewing); }}><CreditCard className="mr-2 h-4 w-4" /> FATURAR</Button>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
