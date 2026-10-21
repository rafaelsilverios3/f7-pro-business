import React, { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/business';
import { saleItemTotal } from '@/lib/saleStatus';
import { salesService } from '@/services/salesService';

const PAYMENT_OPTIONS = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência'];
const today = () => new Date().toISOString().slice(0, 10);

export default function QuoteBillingDialog({ sale, onClose, onFinalized, onReturnToQuote, onCancelSale }) {
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [installments, setInstallments] = useState('1');
  const [dueDate, setDueDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setPaymentMethod('Pix'); setInstallments('1'); setDueDate(today()); setError(''); }, [sale?.id]);

  const finalize = async () => {
    setBusy(true); setError('');
    try {
      const result = await salesService.finalizeQuote(sale, { payment_method: paymentMethod, installments: Number(installments), due_date: dueDate });
      onFinalized(result);
    } catch (err) { setError(err.message || 'Não foi possível finalizar o faturamento.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!sale} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Faturar venda {sale?.id ? `VEN-${String(sale.id).slice(0, 8).toUpperCase()}` : ''}</DialogTitle></DialogHeader>
        {sale && <div className="space-y-4 text-sm">
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">Confira os dados aprovados. Cliente, itens, quantidades e preços estão vinculados ao orçamento e não podem ser alterados nesta etapa. Nenhum pagamento externo será cobrado.</p>
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <div><span className="text-muted-foreground">Orçamento</span><p className="font-mono font-semibold">{sale.origin_quote_number || '—'}</p></div>
            <div><span className="text-muted-foreground">Cliente</span><p className="font-semibold">{sale.customer_name || '—'}</p></div>
          </div>
          <div className="max-h-52 overflow-auto rounded-lg border">
            <table className="w-full text-sm"><thead><tr className="border-b bg-muted/40 text-left"><th className="p-2">Item</th><th className="p-2 text-center">Qtd.</th><th className="p-2 text-right">Total</th></tr></thead>
              <tbody>{(sale.items || []).map((item, index) => <tr className="border-b last:border-0" key={`${item.product_id || item.name}-${index}`}><td className="p-2">{item.name}</td><td className="p-2 text-center">{item.qty ?? item.quantity}</td><td className="p-2 text-right">{fmtMoney(saleItemTotal(item))}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="rounded-lg bg-primary/10 p-4 text-right"><span className="text-muted-foreground">Total a faturar</span><div className="text-2xl font-bold">{fmtMoney(sale.total)}</div><small>Subtotal {fmtMoney(sale.subtotal)} · Desconto {fmtMoney(sale.discount)} · Acréscimo {fmtMoney(sale.addition)}</small></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1"><span>Forma de pagamento</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{PAYMENT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label className="space-y-1"><span>Parcelas</span><input className="h-10 w-full rounded-md border border-input bg-background px-3" type="number" min="1" max="24" value={installments} onChange={(event) => setInstallments(event.target.value)} /></label>
            <label className="space-y-1"><span>1º vencimento</span><input className="h-10 w-full rounded-md border border-input bg-background px-3" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>
          {Number(installments) > 1 && <p className="text-xs text-muted-foreground">As parcelas serão registradas no contas a receber, com vencimentos mensais a partir da data informada. Nenhum recebimento será marcado como pago.</p>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-destructive">{error}</p>}
          <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Mais ações</summary><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={onReturnToQuote}>Retornar para orçamento</Button><Button variant="destructive" disabled={busy} onClick={onCancelSale}>Cancelar venda</Button><Button variant="outline" disabled title="Agrupamento indisponível até existir operação transacional segura">Agrupar vendas (indisponível)</Button></div></details>
        </div>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Voltar</Button><Button disabled={busy || !sale || !paymentMethod || Number(installments) < 1 || Number(installments) > 24 || !dueDate} onClick={finalize}><CreditCard className="mr-2 h-4 w-4" />{busy ? 'Processando…' : 'Confirmar faturamento'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
