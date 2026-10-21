import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CreditCard, Copy, QrCode } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/business';
import { saleItemTotal } from '@/lib/saleStatus';
import { salesService } from '@/services/salesService';
import { bankAccountsService } from '@/services/bankAccountsService';
import { buildStaticPixPayload } from '@/lib/pixBrCode';

const PAYMENT_OPTIONS = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência'];
const today = () => new Date().toISOString().slice(0, 10);

export default function QuoteBillingDialog({ sale, onClose, onFinalized, onReturnToQuote, onCancelSale }) {
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [installments, setInstallments] = useState('1');
  const [dueDate, setDueDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receivingAccounts, setReceivingAccounts] = useState([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [pixPayload, setPixPayload] = useState('');
  const [pixQr, setPixQr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPaymentMethod('Pix'); setInstallments('1'); setDueDate(today()); setError(''); setPixPayload(''); setPixQr(''); setCopied(false);
    let active = true;
    if (sale?.company_id) bankAccountsService.receivingAccounts(sale.company_id).then((rows) => {
      if (!active) return;
      setReceivingAccounts(rows || []);
      const primary = (rows || []).find((account) => account.is_primary) || rows?.[0];
      setBankAccountId(primary?.id || '');
    }).catch(() => { if (active) setReceivingAccounts([]); });
    return () => { active = false; };
  }, [sale?.id, sale?.company_id]);

  const selectedAccount = useMemo(() => receivingAccounts.find((account) => account.id === bankAccountId) || null, [receivingAccounts, bankAccountId]);
  useEffect(() => {
    let active = true;
    setPixPayload(''); setPixQr(''); setError('');
    if (paymentMethod !== 'Pix' || !selectedAccount?.pix_key || !selectedAccount?.merchant_city || !selectedAccount?.holder_name || Number(sale?.total) <= 0) return () => { active = false; };
    try {
      const payload = buildStaticPixPayload({ pixKey: selectedAccount.pix_key, receiver: selectedAccount.holder_name, city: selectedAccount.merchant_city, amount: Number(sale.total), txid: sale.origin_quote_number || sale.id?.slice(0, 25) });
      setPixPayload(payload);
      QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 220 }).then((url) => { if (active) setPixQr(url); }).catch(() => { if (active) setError('Não foi possível renderizar o QR Pix. A operação continua disponível para registro manual.'); });
    } catch (cause) { setError(cause?.message || 'Não foi possível gerar o código Pix.'); }
    return () => { active = false; };
  }, [paymentMethod, selectedAccount, sale?.total, sale?.origin_quote_number, sale?.id]);

  const finalize = async () => {
    setBusy(true); setError('');
    try {
      await bankAccountsService.setSaleAccount(sale.id, bankAccountId || null);
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
          {['Pix', 'Transferência'].includes(paymentMethod) && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3"><label className="space-y-1 text-sm"><span>Conta recebedora da empresa</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}><option value="">Sem conta selecionada</option>{receivingAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.institution_name}{account.is_primary ? ' · Principal' : ''}</option>)}</select></label>{!receivingAccounts.length && <p className="text-xs text-amber-800 dark:text-amber-200">Nenhuma conta recebedora foi cadastrada. O título será faturado sem instrução bancária; cadastre uma conta no Financeiro quando quiser usar Pix manual.</p>}{selectedAccount && paymentMethod === 'Pix' && pixPayload && <div className="flex flex-col items-center gap-3 rounded-lg border bg-background p-3 sm:flex-row"><div className="flex h-56 w-56 shrink-0 items-center justify-center rounded-lg bg-white p-2">{pixQr ? <img src={pixQr} alt="QR Code Pix estático com o valor da venda" className="h-full w-full object-contain" /> : <QrCode className="h-10 w-10 animate-pulse text-primary" />}</div><div className="min-w-0 space-y-2"><p className="font-medium">Pix manual · {selectedAccount.holder_name}</p><p className="text-xs text-muted-foreground">QR estático com valor preenchido. O pagamento fica pendente até a confirmação manual do recebimento.</p><Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(pixPayload); setCopied(true); } catch { setError('Não foi possível copiar; selecione e copie o código Pix abaixo.'); } }}><Copy className="mr-2 h-4 w-4" />{copied ? 'Código copiado' : 'Copiar Pix'}</Button><details className="max-w-full"><summary className="cursor-pointer text-xs text-muted-foreground">Ver código Pix</summary><textarea readOnly value={pixPayload} className="mt-2 min-h-20 w-full break-all rounded-md border bg-background p-2 font-mono text-[10px]" /></details></div></div>}{selectedAccount && paymentMethod === 'Pix' && !pixPayload && <p className="text-xs text-amber-800 dark:text-amber-200">Para gerar QR e código Pix, preencha a chave Pix, titular e cidade da conta na Central Bancária. Nenhum dado de recebimento será inventado.</p>}{selectedAccount && paymentMethod === 'Transferência' && <p className="text-xs text-muted-foreground">Agência e conta informadas no cadastro serão usadas como referência. A transferência não é iniciada nem confirmada pelo F7.</p>}</div>}
          {Number(installments) > 1 && <p className="text-xs text-muted-foreground">As parcelas serão registradas no contas a receber, com vencimentos mensais a partir da data informada. Nenhum recebimento será marcado como pago.</p>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-destructive">{error}</p>}
          <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Mais ações</summary><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={onReturnToQuote}>Retornar para orçamento</Button><Button variant="destructive" disabled={busy} onClick={onCancelSale}>Cancelar venda</Button><Button variant="outline" disabled title="Agrupamento indisponível até existir operação transacional segura">Agrupar vendas (indisponível)</Button></div></details>
        </div>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Voltar</Button><Button disabled={busy || !sale || !paymentMethod || Number(installments) < 1 || Number(installments) > 24 || !dueDate} onClick={finalize}><CreditCard className="mr-2 h-4 w-4" />{busy ? 'Processando…' : 'Confirmar faturamento'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
