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
import { companyPaymentService } from '@/services/companyPaymentService';

const BASE_PAYMENT_OPTIONS = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência'];
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
  const [mpStatus, setMpStatus] = useState(null);
  const [mpPayment, setMpPayment] = useState(null);
  const [mpPaymentBusy, setMpPaymentBusy] = useState(false);
  const [mpIdempotencyKey, setMpIdempotencyKey] = useState(() => crypto.randomUUID());
  const [finalizedSale, setFinalizedSale] = useState(null);

  useEffect(() => {
    setPaymentMethod('Pix'); setInstallments('1'); setDueDate(today()); setError(''); setPixPayload(''); setPixQr(''); setCopied(false);
    setMpStatus(null); setMpPayment(null); setFinalizedSale(null); setMpIdempotencyKey(crypto.randomUUID());
    let active = true;
    if (sale?.company_id) bankAccountsService.receivingAccounts(sale.company_id).then((rows) => {
      if (!active) return;
      setReceivingAccounts(rows || []);
      const primary = (rows || []).find((account) => account.is_primary) || rows?.[0];
      setBankAccountId(primary?.id || '');
    }).catch(() => { if (active) setReceivingAccounts([]); });
    if (sale?.company_id) companyPaymentService.status(sale.company_id).then((value) => { if (active) setMpStatus(value); }).catch(() => { if (active) setMpStatus(null); });
    if (sale?.company_id && sale?.id) companyPaymentService.listForSale(sale.company_id, sale.id).then((rows) => { if (active && rows?.[0]) setMpPayment(rows[0]); }).catch(() => {});
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

  const onlineMethod = paymentMethod === 'Mercado Pago · Pix' ? 'pix' : paymentMethod === 'Mercado Pago · Cartão' ? 'card' : null;
  const onlineAvailable = mpStatus?.connection?.status === 'connected' && mpStatus?.payments_enabled === true;
  const createOnlineCharge = async (targetSale, idempotencyKey = mpIdempotencyKey) => {
    setMpPaymentBusy(true); setError('');
    try {
      const result = await companyPaymentService.createPayment({ company_id: targetSale.company_id, sale_id: targetSale.id, method: onlineMethod, installments: onlineMethod === 'pix' ? 1 : Number(installments), idempotency_key: idempotencyKey });
      setMpPayment(result.payment || null);
      await onFinalized(targetSale, true);
    } catch (cause) {
      const labels = { MP_COMPANY_CONNECTOR_NOT_CONFIGURED: 'A integração Mercado Pago aguarda credenciais seguras no ambiente.', MP_COMPANY_PRODUCTION_PAYMENTS_DISABLED: 'Cobranças reais estão desativadas pelo Owner Global.', MP_COMPANY_ACCOUNT_NOT_CONNECTED: 'Conecte a conta recebedora desta empresa na Central Bancária.', MP_PAYER_EMAIL_REQUIRED: 'Cadastre um e-mail válido para o cliente antes de criar a cobrança.', MP_PAYMENT_ATTEMPT_PENDING: 'Já existe uma cobrança pendente para esta venda. Atualize a situação antes de tentar novamente.', MP_PENDING_PAYMENT_PREVENTS_DISCONNECT: 'Resolva ou aguarde as cobranças pendentes antes de desconectar a conta.', MP_PROVIDER_UNAVAILABLE: 'O Mercado Pago está indisponível. A cobrança permanece protegida contra duplicidade; atualize a situação antes de repetir.' };
      setError(labels[cause?.code] || cause?.message || 'Não foi possível criar a cobrança. A venda faturada permanece com recebível pendente.');
    } finally { setMpPaymentBusy(false); }
  };
  const finalize = async () => {
    if (finalizedSale && onlineMethod) return createOnlineCharge(finalizedSale);
    setBusy(true); setError('');
    try {
      if (!onlineMethod) await bankAccountsService.setSaleAccount(sale.id, bankAccountId || null);
      const result = await salesService.finalizeQuote(sale, { payment_method: paymentMethod, installments: onlineMethod === 'pix' ? 1 : Number(installments), due_date: dueDate });
      if (onlineMethod) { setFinalizedSale(result); await onFinalized(result, true); await createOnlineCharge(result); }
      else onFinalized(result);
    } catch (err) { setError(err.message || 'Não foi possível finalizar o faturamento.'); }
    finally { setBusy(false); }
  };
  const refreshOnlinePayment = async () => {
    if (!mpPayment?.id || !sale?.company_id) return;
    setMpPaymentBusy(true); setError('');
    try { const result = await companyPaymentService.refreshPayment({ company_id: sale.company_id, payment_id: mpPayment.id }); setMpPayment(result.payment || mpPayment); if (result.payment?.status === 'rejected' || result.payment?.status === 'cancelled') setMpIdempotencyKey(crypto.randomUUID()); }
    catch (cause) { setError(cause?.message || 'Não foi possível atualizar a situação da cobrança.'); }
    finally { setMpPaymentBusy(false); }
  };

  const paymentOptions = [...BASE_PAYMENT_OPTIONS, ...(onlineAvailable ? ['Mercado Pago · Pix', 'Mercado Pago · Cartão'] : [])];

  return (
    <Dialog open={!!sale} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Faturar venda {sale?.id ? `VEN-${String(sale.id).slice(0, 8).toUpperCase()}` : ''}</DialogTitle></DialogHeader>
        {sale && <div className="space-y-4 text-sm">
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">Confira os dados aprovados. Cliente, itens, quantidades e preços estão vinculados ao orçamento e não podem ser alterados nesta etapa. {onlineMethod ? 'A cobrança só será solicitada ao Mercado Pago quando você confirmar o faturamento.' : 'Nenhuma cobrança externa será iniciada nesta forma de pagamento.'}</p>
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
            <label className="space-y-1"><span>Forma de pagamento</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{paymentOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label className="space-y-1"><span>Parcelas</span><input className="h-10 w-full rounded-md border border-input bg-background px-3" type="number" min="1" max="24" value={installments} onChange={(event) => setInstallments(event.target.value)} /></label>
            <label className="space-y-1"><span>1º vencimento</span><input className="h-10 w-full rounded-md border border-input bg-background px-3" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>
          {['Pix', 'Transferência'].includes(paymentMethod) && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3"><label className="space-y-1 text-sm"><span>Conta recebedora da empresa</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}><option value="">Sem conta selecionada</option>{receivingAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.institution_name}{account.is_primary ? ' · Principal' : ''}</option>)}</select></label>{!receivingAccounts.length && <p className="text-xs text-amber-800 dark:text-amber-200">Nenhuma conta recebedora foi cadastrada. O título será faturado sem instrução bancária; cadastre uma conta no Financeiro quando quiser usar Pix manual.</p>}{selectedAccount && paymentMethod === 'Pix' && pixPayload && <div className="flex flex-col items-center gap-3 rounded-lg border bg-background p-3 sm:flex-row"><div className="flex h-56 w-56 shrink-0 items-center justify-center rounded-lg bg-white p-2">{pixQr ? <img src={pixQr} alt="QR Code Pix estático com o valor da venda" className="h-full w-full object-contain" /> : <QrCode className="h-10 w-10 animate-pulse text-primary" />}</div><div className="min-w-0 space-y-2"><p className="font-medium">Pix manual · {selectedAccount.holder_name}</p><p className="text-xs text-muted-foreground">QR estático com valor preenchido. O pagamento fica pendente até a confirmação manual do recebimento.</p><Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(pixPayload); setCopied(true); } catch { setError('Não foi possível copiar; selecione e copie o código Pix abaixo.'); } }}><Copy className="mr-2 h-4 w-4" />{copied ? 'Código copiado' : 'Copiar Pix'}</Button><details className="max-w-full"><summary className="cursor-pointer text-xs text-muted-foreground">Ver código Pix</summary><textarea readOnly value={pixPayload} className="mt-2 min-h-20 w-full break-all rounded-md border bg-background p-2 font-mono text-[10px]" /></details></div></div>}{selectedAccount && paymentMethod === 'Pix' && !pixPayload && <p className="text-xs text-amber-800 dark:text-amber-200">Para gerar QR e código Pix, preencha a chave Pix, titular e cidade da conta na Central Bancária. Nenhum dado de recebimento será inventado.</p>}{selectedAccount && paymentMethod === 'Transferência' && <p className="text-xs text-muted-foreground">Agência e conta informadas no cadastro serão usadas como referência. A transferência não é iniciada nem confirmada pelo F7.</p>}</div>}
          {onlineMethod && <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3"><p className="font-medium">Recebimento Mercado Pago desta empresa</p><p className="text-xs text-muted-foreground">O valor é validado no backend contra a venda faturada. O recebível continua pendente até confirmação autenticada do Mercado Pago. Nenhum pagamento é considerado aprovado pelo retorno do navegador.</p>{onlineMethod === 'card' && <p className="text-xs text-muted-foreground">Checkout oficial Mercado Pago · {installments} parcela(s). Os dados do cartão são capturados pelo Mercado Pago e não passam pelo F7.</p>}{mpPayment && <div className="rounded-lg border bg-background p-3"><p className="font-medium">Cobrança {mpPayment.status || 'pending'} · {fmtMoney(mpPayment.amount || sale?.total)}</p>{mpPayment.method === 'pix' && mpPayment.pix_qr_code_base64 && <img className="mx-auto my-3 h-48 w-48 bg-white p-2" alt="QR Code Pix dinâmico Mercado Pago" src={`data:image/png;base64,${mpPayment.pix_qr_code_base64}`} />}{mpPayment.method === 'pix' && mpPayment.pix_qr_code && <div className="space-y-2"><Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(mpPayment.pix_qr_code); setCopied(true); } catch { setError('Não foi possível copiar o Pix.'); } }}><Copy className="mr-2 h-4 w-4" />{copied ? 'Código copiado' : 'Copiar Pix Copia e Cola'}</Button><textarea readOnly value={mpPayment.pix_qr_code} className="min-h-20 w-full break-all rounded-md border bg-background p-2 font-mono text-xs" /></div>}{mpPayment.checkout_url && <a className="inline-flex rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" href={mpPayment.checkout_url} target="_blank" rel="noreferrer">Abrir checkout seguro</a>}{mpPayment.expires_at && <p className="text-xs text-muted-foreground">Vencimento: {new Date(mpPayment.expires_at).toLocaleString('pt-BR')}</p>}<div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Status atualizado pelo provedor: {mpPayment.provider_status || mpPayment.status}</span><Button type="button" size="sm" variant="outline" disabled={mpPaymentBusy} onClick={refreshOnlinePayment}>{mpPaymentBusy ? 'Consultando…' : 'Atualizar situação'}</Button></div>{['rejected','cancelled','expired'].includes(mpPayment.status) && <Button type="button" size="sm" disabled={mpPaymentBusy} onClick={() => { const retryKey = crypto.randomUUID(); setMpIdempotencyKey(retryKey); setMpPayment(null); void createOnlineCharge(finalizedSale || sale, retryKey); }}>Gerar nova tentativa</Button>}</div>}{finalizedSale && !mpPayment && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">A venda já foi faturada e permanece com recebível pendente. Você pode tentar gerar a cobrança novamente sem faturar ou baixar estoque outra vez.</p>}</div>}
          {Number(installments) > 1 && <p className="text-xs text-muted-foreground">As parcelas serão registradas no contas a receber, com vencimentos mensais a partir da data informada. Nenhum recebimento será marcado como pago.</p>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-destructive">{error}</p>}
          <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Mais ações</summary><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={onReturnToQuote}>Retornar para orçamento</Button><Button variant="destructive" disabled={busy} onClick={onCancelSale}>Cancelar venda</Button><Button variant="outline" disabled title="Agrupamento indisponível até existir operação transacional segura">Agrupar vendas (indisponível)</Button></div></details>
        </div>}
        <DialogFooter><Button variant="outline" disabled={busy || mpPaymentBusy} onClick={() => { if (finalizedSale) onFinalized(finalizedSale, false); else onClose(); }}>Voltar</Button>{(!mpPayment || ['rejected','cancelled','expired','uncertain','failed'].includes(mpPayment.status)) && <Button disabled={busy || mpPaymentBusy || !sale || !paymentMethod || Number(installments) < 1 || Number(installments) > 24 || !dueDate} onClick={finalize}><CreditCard className="mr-2 h-4 w-4" />{busy || mpPaymentBusy ? 'Processando…' : finalizedSale ? 'Criar cobrança' : 'Confirmar faturamento'}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
