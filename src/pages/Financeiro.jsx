// F7 PRO BUSINESS — Financeiro: títulos, recebimentos, pagamentos e caixa real.
import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Check, Trash2, Wallet, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { financeService } from '@/services/financeService';
import { fmtMoney, fmtDate, todayISO } from '@/lib/business';
import { FINANCE_NATURES, REVENUE_CATEGORIES, EXPENSE_CATEGORIES, CAPITAL_TYPES, summarizeFinance } from '@/lib/finance';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';
import { can } from '@/lib/permissions';
import { bankAccountsService } from '@/services/bankAccountsService';
import BankAccountsPanel from '@/components/finance/BankAccountsPanel';

const TABS = [
  { value: 'overview', label: 'Visão geral' },
  { value: 'cash', label: 'Fluxo de caixa' },
  { value: 'receivable', label: 'Contas a receber' },
  { value: 'payable', label: 'Contas a pagar' },
  { value: 'banks', label: 'Contas bancárias' },
];
const STATUS_LABEL = { pending: 'Pendente', partial: 'Parcial', received: 'Recebido', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado' };
const PAYMENT_OPTIONS = ['Pix', 'Dinheiro', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência', 'A combinar'];

function statusClass(status) {
  if (status === 'received' || status === 'paid') return 'bg-emerald-100 text-emerald-700';
  if (status === 'cancelled') return 'bg-slate-100 text-slate-500';
  if (status === 'overdue') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

export default function Financeiro() {
  const { company } = useOutletContext();
  const membership = useCompanyMembership(company?.id);
  const [items, setItems] = useState(null);
  const [movements, setMovements] = useState([]);
  const [tab, setTab] = useState('overview');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paymentEntry, setPaymentEntry] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [receivingAccounts, setReceivingAccounts] = useState([]);
  const [paymentBankAccountId, setPaymentBankAccountId] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [nature, setNature] = useState(FINANCE_NATURES.REVENUE);
  const [form, setForm] = useState({ description: '', category: REVENUE_CATEGORIES[0], amount: '', due_date: todayISO(), occurred_at: new Date().toISOString().slice(0, 16), capital_type: CAPITAL_TYPES[0].value, source_detail: '', notes: '', payment_method: 'A combinar', account: 'Caixa' });

  const load = async () => {
    if (!company) return;
    const [entries, cashMovements] = await Promise.all([financeService.list(company.id), financeService.movements(company.id)]);
    const byEntry = new Map(entries.map((entry) => [entry.id, entry]));
    setItems(entries.map((entry) => ({ ...entry, movement_count: cashMovements.filter((movement) => movement.financial_entry_id === entry.id).length })));
    setMovements(cashMovements.map((movement) => { const entry = byEntry.get(movement.financial_entry_id) || {}; return { ...movement, entry_class: entry.entry_class || 'operating', capital_type: entry.capital_type || null, entry_description: entry.description || '', entry_category: entry.category || '', entry_source: entry.source_detail || entry.source_type || '' }; }));
  };
  useEffect(() => { load(); }, [company]);
  useEffect(() => { let active = true; if (company?.id) bankAccountsService.receivingAccounts(company.id).then((rows) => { if (active) setReceivingAccounts(rows || []); }).catch(() => { if (active) setReceivingAccounts([]); }); return () => { active = false; }; }, [company?.id]);

  const period = useMemo(() => { const now = new Date(); return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, end: todayISO() }; }, []);
  const stats = useMemo(() => { const all = summarizeFinance(items || [], movements); const currentPeriod = summarizeFinance(items || [], movements, period); return { ...all, inflows: currentPeriod.inflows, outflows: currentPeriod.outflows, result: currentPeriod.result }; }, [items, movements, period]);
  const filtered = useMemo(() => (items || []).filter((entry) => tab === 'receivable' ? entry.nature === FINANCE_NATURES.REVENUE : entry.nature === FINANCE_NATURES.EXPENSE), [items, tab]);

  const openNew = () => {
    setNature(FINANCE_NATURES.REVENUE);
    setForm({ description: '', category: REVENUE_CATEGORIES[0], amount: '', due_date: todayISO(), occurred_at: new Date().toISOString().slice(0, 16), capital_type: CAPITAL_TYPES[0].value, source_detail: '', notes: '', payment_method: 'A combinar', account: 'Caixa' });
    setDialogOpen(true);
    setFormError('');
  };
  const changeNature = (value) => { setNature(value); setForm((current) => ({ ...current, category: value === FINANCE_NATURES.REVENUE ? REVENUE_CATEGORIES[0] : EXPENSE_CATEGORIES[0] })); };
  const handleAdd = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      if (nature === FINANCE_NATURES.CAPITAL) await financeService.createCapital(company.id, { ...form, capital_type: form.capital_type, occurred_at: form.occurred_at, source_detail: form.source_detail, notes: form.notes });
      else await financeService.create(company.id, { ...form, nature, type: nature === FINANCE_NATURES.REVENUE ? 'receivable' : 'payable', amount: Number(form.amount) || 0, status: 'pending' });
      setDialogOpen(false);
      await load();
    } catch (error) {
      setFormError(error?.message || 'Não foi possível salvar o lançamento. Verifique se a configuração financeira foi aplicada.');
    }
  };
  const openPayment = (entry) => { setPaymentEntry(entry); setPaymentAmount(String(entry.balance_amount)); setPaymentMethod(entry.payment_method || 'Pix'); setPaymentBankAccountId(receivingAccounts.find((account) => account.is_primary)?.id || receivingAccounts[0]?.id || ''); setPaymentIdempotencyKey(crypto.randomUUID()); setPaymentError(''); };
  const handlePayment = async (event) => {
    event.preventDefault();
    setPaymentBusy(true); setPaymentError('');
    try { await financeService.recordPayment(company.id, paymentEntry, Number(paymentAmount), { payment_method: paymentMethod, bank_account_id: paymentBankAccountId || null, idempotency_key: paymentIdempotencyKey }); setPaymentEntry(null); await load(); }
    catch (error) { setPaymentError(error?.message || 'Não foi possível registrar a confirmação manual.'); }
    finally { setPaymentBusy(false); }
  };
  const handleDelete = async (id) => { await financeService.remove(company.id, id); await load(); };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader title="Financeiro" subtitle="Receitas, despesas, títulos e movimentação real de caixa." action={<Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> Novo lançamento</Button>} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Metric icon={Wallet} label="Saldo em caixa" value={stats.cash} tone={stats.cash >= 0 ? 'text-slate-900' : 'text-rose-600'} />
        <Metric icon={TrendingUp} label="A receber" value={stats.receivable} tone="text-emerald-600" />
        <Metric icon={TrendingDown} label="A pagar" value={stats.payable} tone="text-rose-600" />
        <Metric icon={ArrowDownToLine} label="Entradas" value={stats.inflows} tone="text-emerald-600" />
        <Metric icon={ArrowUpFromLine} label="Saídas" value={stats.outflows} tone="text-rose-600" />
        <Metric icon={ArrowDownToLine} label="Aportes no período" value={stats.capital} tone="text-indigo-600" />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((item) => <button key={item.value} onClick={() => setTab(item.value)} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${tab === item.value ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-900/20' : 'text-slate-500 hover:bg-blue-500/10 hover:text-blue-700'}`}>{item.label}</button>)}
      </div>

      {tab === 'overview' ? <Overview stats={stats} movements={movements} /> : tab === 'cash' ? <CashFlow movements={movements} /> : tab === 'banks' ? <BankAccountsPanel company={company} canManage={can({ role: membership.role }, 'finance.manage')} /> : <EntryTable entries={filtered} onPay={openPayment} onDelete={handleDelete} />}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo lançamento</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><button type="button" onClick={() => changeNature(FINANCE_NATURES.REVENUE)} className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${nature === FINANCE_NATURES.REVENUE ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-900/20' : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:bg-blue-500/10'}`}>Receita</button><button type="button" onClick={() => changeNature(FINANCE_NATURES.EXPENSE)} className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${nature === FINANCE_NATURES.EXPENSE ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-900/20' : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:bg-blue-500/10'}`}>Despesa</button><button type="button" onClick={() => changeNature(FINANCE_NATURES.CAPITAL)} className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${nature === FINANCE_NATURES.CAPITAL ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-900/20' : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:bg-blue-500/10'}`}>Aporte / investimento</button></div>
            <div className="space-y-1.5"><Label className="text-xs">Descrição *</Label><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></div>
            {formError && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>}
            {nature === FINANCE_NATURES.CAPITAL ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label className="text-xs">Tipo de aporte</Label><select value={form.capital_type} onChange={(event) => setForm({ ...form, capital_type: event.target.value })} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{CAPITAL_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div className="space-y-1.5"><Label className="text-xs">Valor (R$)</Label><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></div></div> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label className="text-xs">Categoria</Label><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{(nature === FINANCE_NATURES.REVENUE ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES).map((category) => <option key={category}>{category}</option>)}</select></div><div className="space-y-1.5"><Label className="text-xs">Valor total (R$)</Label><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></div></div>}
            {nature === FINANCE_NATURES.CAPITAL ? <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label className="text-xs">Data da entrada</Label><Input type="datetime-local" value={form.occurred_at} onChange={(event) => setForm({ ...form, occurred_at: event.target.value })} required /></div><div className="space-y-1.5"><Label className="text-xs">Conta / Caixa</Label><Input value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })} /></div></div><div className="space-y-1.5"><Label className="text-xs">Origem do recurso / sócio</Label><Input value={form.source_detail} onChange={(event) => setForm({ ...form, source_detail: event.target.value })} placeholder="Opcional" /></div><div className="space-y-1.5"><Label className="text-xs">Observação</Label><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Opcional" /></div><p className="text-xs text-slate-500">A entrada de capital é confirmada imediatamente, não cria Conta a Receber e não exige vencimento.</p></> : <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label className="text-xs">Vencimento</Label><Input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></div><div className="space-y-1.5"><Label className="text-xs">Forma prevista</Label><select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{PAYMENT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></div></div><p className="text-xs text-slate-500">{nature === FINANCE_NATURES.REVENUE ? 'A receita cria uma conta a receber. O caixa só muda quando houver recebimento.' : 'A despesa cria uma conta a pagar. O caixa só muda quando houver pagamento.'}</p></>}
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit">Criar {nature === FINANCE_NATURES.REVENUE ? 'receita' : nature === FINANCE_NATURES.CAPITAL ? 'aporte' : 'despesa'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paymentEntry)} onOpenChange={(open) => !open && !paymentBusy && setPaymentEntry(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{paymentEntry?.nature === FINANCE_NATURES.REVENUE ? 'Registrar recebimento' : 'Registrar pagamento'}</DialogTitle></DialogHeader><form onSubmit={handlePayment} className="space-y-4"><p className="text-sm text-slate-500">Saldo pendente: <strong>{fmtMoney(paymentEntry?.balance_amount)}</strong></p><div className="space-y-1.5"><Label className="text-xs">Valor</Label><Input type="number" min="0.01" max={paymentEntry?.balance_amount} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></div><div className="space-y-1.5"><Label className="text-xs">Forma</Label><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{PAYMENT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></div>{paymentEntry?.nature === FINANCE_NATURES.REVENUE && <div className="space-y-1.5"><Label className="text-xs">Conta recebedora (opcional)</Label><select value={paymentBankAccountId} onChange={(event) => setPaymentBankAccountId(event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-background px-3 text-sm"><option value="">Sem conta vinculada</option>{receivingAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.institution_name}{account.is_primary ? ' · Principal' : ''}</option>)}</select><p className="text-xs text-muted-foreground">A confirmação é manual e auditada; o F7 não consulta o banco nem confirma liquidação automaticamente.</p></div>}{paymentError && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{paymentError}</p>}<DialogFooter><Button type="button" variant="ghost" disabled={paymentBusy} onClick={() => setPaymentEntry(null)}>Cancelar</Button><Button type="submit" disabled={paymentBusy}>{paymentBusy ? 'Registrando…' : 'Confirmar recebimento'}</Button></DialogFooter></form></DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-slate-500" /><p className="text-xs text-slate-500">{label}</p></div><p className={`mt-1 text-xl font-semibold ${tone}`}>{fmtMoney(value)}</p></div>; }
function Overview({ stats, movements }) { return <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-800">Resultado do período</h2><p className={`mt-3 text-3xl font-bold ${stats.result >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtMoney(stats.result)}</p><p className="mt-1 text-xs text-slate-500">Variação de caixa: todas as entradas menos saídas.</p><div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4"><div><p className="text-xs text-slate-500">Resultado operacional</p><p className="font-semibold text-slate-800">{fmtMoney(stats.operating_result)}</p></div><div><p className="text-xs text-slate-500">Entradas de capital</p><p className="font-semibold text-indigo-600">{fmtMoney(stats.capital)}</p></div></div></div><CashFlow movements={movements} compact /></div>; }
function CashFlow({ movements, compact = false }) { let running = 0; const rows = movements.map((movement) => { running += movement.direction === 'in' ? Number(movement.amount) || 0 : -(Number(movement.amount) || 0); return { ...movement, running }; }); return <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${compact ? '' : 'mt-1'}`}><div className="border-b border-slate-100 px-4 py-3"><h2 className="font-semibold text-slate-800">Movimentações reais de caixa</h2><p className="text-xs text-slate-500">Títulos pendentes não entram neste saldo.</p></div>{rows.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">Nenhuma entrada ou saída registrada.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Data</th><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Origem / conta</th><th className="px-4 py-3 text-right">Entrada</th><th className="px-4 py-3 text-right">Saída</th><th className="px-4 py-3 text-right">Saldo</th></tr></thead><tbody>{rows.map((movement) => <tr key={movement.id} className="border-b border-slate-50"><td className="px-4 py-3 text-slate-500">{fmtDate((movement.occurred_at || '').slice(0, 10))}</td><td className="px-4 py-3 font-medium text-slate-800">{movement.entry_description || 'Movimentação de caixa'}</td><td className="px-4 py-3 text-slate-500">{movement.entry_class === 'capital' ? 'Capital' : movement.direction === 'in' ? 'Receita' : 'Despesa'}</td><td className="px-4 py-3 text-slate-500">{movement.capital_type || movement.entry_category || '—'}</td><td className="px-4 py-3 text-slate-500">{movement.account || movement.entry_source || movement.payment_method || '—'}</td><td className="px-4 py-3 text-right font-medium text-emerald-600">{movement.direction === 'in' ? fmtMoney(movement.amount) : '—'}</td><td className="px-4 py-3 text-right font-medium text-rose-600">{movement.direction === 'out' ? fmtMoney(movement.amount) : '—'}</td><td className="px-4 py-3 text-right font-medium text-slate-800">{fmtMoney(movement.running)}</td></tr>)}</tbody></table></div>}</div>; }
function EntryTable({ entries, onPay, onDelete }) { return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{entries.length === 0 ? <div className="p-12 text-center text-sm text-slate-500">Nenhum título encontrado.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Recebido/Pago</th><th className="px-4 py-3">Saldo</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-slate-50"><td className="px-4 py-3 font-medium text-slate-800">{entry.description || '—'}</td><td className="px-4 py-3 text-slate-500">{entry.category || '—'}</td><td className="px-4 py-3">{fmtMoney(entry.total_amount)}</td><td className="px-4 py-3">{fmtMoney(entry.settled_amount)}</td><td className="px-4 py-3 font-semibold">{fmtMoney(entry.balance_amount)}</td><td className="px-4 py-3 text-slate-500">{fmtDate(entry.due_date)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(entry.status)}`}>{STATUS_LABEL[entry.status] || entry.status}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1">{entry.balance_amount > 0 && entry.status !== 'cancelled' && <button onClick={() => onPay(entry)} className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title={entry.nature === FINANCE_NATURES.REVENUE ? 'Registrar recebimento' : 'Registrar pagamento'}><Check className="h-4 w-4" /></button>}<button onClick={() => onDelete(entry.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Excluir título"><Trash2 className="h-4 w-4" /></button></div></td></tr>)}</tbody></table></div>}</div>; }
