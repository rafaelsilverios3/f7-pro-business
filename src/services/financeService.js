import { financeRepository } from '@/data/repositories/financeRepository';
import { financeSchema } from '@/schemas';
import { getDataProvider } from '@/data/providerSelector';
import { normalizeFinancialEntry } from '@/lib/finance';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export const financeService = {
  async list(companyId) {
    const entries = await financeRepository.list(companyId, '-due_date');
    return entries.map(normalizeFinancialEntry);
  },
  async movements(companyId, period) {
    try {
      return await getDataProvider().entity('FinancialMovement').filter({ company_id: companyId }, '-occurred_at', 1000).then((rows) => period ? rows.filter((row) => row.occurred_at?.slice(0, 10) >= period.start && row.occurred_at?.slice(0, 10) <= period.end) : rows);
    } catch {
      return [];
    }
  },
  async installments(companyId, entryId) {
    try { return await getDataProvider().entity('FinancialInstallment').filter({ company_id: companyId, financial_entry_id: entryId }, 'installment_number', 100); } catch { return []; }
  },
  create(companyId, data) {
    const nature = data.nature || (data.type === 'payable' ? 'expense' : 'revenue');
    const parsed = financeSchema.parse({ ...data, company_id: companyId, nature, type: nature === 'expense' ? 'payable' : 'receivable', amount: Number(data.amount) || 0 });
    return financeRepository.create({ ...parsed, total_amount: parsed.amount, received_amount: 0, paid_amount: 0, status: 'pending' }, companyId);
  },
  async recordPayment(companyId, entry, amount, options = {}) {
    const value = Number(amount) || 0;
    if (value <= 0 || value > entry.balance_amount) throw new Error('Pagamento maior que o saldo pendente.');
    if (isSupabase()) return normalizeFinancialEntry(await getDataProvider().rpc('record_financial_payment', { target_entry: entry.id, payment_amount: value, payment_method_value: options.payment_method || entry.payment_method || null, target_installment: options.installment_id || null, payment_idempotency_key: options.idempotency_key || null, occurred_at_value: options.occurred_at || new Date().toISOString() }));
    const updated = normalizeFinancialEntry({ ...entry, received_amount: entry.nature === 'revenue' ? (entry.received_amount || 0) + value : 0, paid_amount: entry.nature === 'expense' ? (entry.paid_amount || 0) + value : 0 });
    try { await getDataProvider().entity('FinancialMovement').create({ company_id: companyId, financial_entry_id: entry.id, direction: entry.nature === 'revenue' ? 'in' : 'out', amount: value, payment_method: options.payment_method || entry.payment_method || null, account: entry.account || 'Caixa', occurred_at: options.occurred_at || new Date().toISOString(), idempotency_key: options.idempotency_key || null }); } catch {}
    return financeRepository.update(entry.id, { received_amount: updated.received_amount, paid_amount: updated.paid_amount, total_amount: updated.total_amount, amount: updated.total_amount, status: updated.status, paid_date: updated.balance_amount === 0 ? new Date().toISOString().slice(0, 10) : entry.paid_date }, companyId);
  },
  settle(companyId, entry) { return entry.balance_amount <= 0 ? entry : this.recordPayment(companyId, entry, entry.balance_amount, { payment_method: entry.payment_method || 'manual', idempotency_key: `settle:${entry.id}` }); },
  remove: (companyId, id) => financeRepository.remove(id, companyId),
};
