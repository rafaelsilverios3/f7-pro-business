export const FINANCE_NATURES = Object.freeze({ REVENUE: 'revenue', EXPENSE: 'expense', CAPITAL: 'capital' });

export const REVENUE_CATEGORIES = ['Venda', 'Serviço', 'Comissão recebida', 'Receita financeira', 'Outras receitas'];
export const EXPENSE_CATEGORIES = ['Aluguel', 'Salários', 'Encargos', 'Impostos', 'Marketing', 'Fornecedor', 'Compras', 'Frete', 'Energia', 'Água', 'Internet', 'Taxas', 'Manutenção', 'Combustível', 'Outras despesas'];
export const CAPITAL_TYPES = [{ value: 'working_capital', label: 'Capital de giro' }, { value: 'partner_contribution', label: 'Aporte de sócio' }, { value: 'owner_investment', label: 'Investimento do proprietário' }, { value: 'partner_loan', label: 'Empréstimo de sócio' }, { value: 'cash_reserve', label: 'Reserva de caixa' }, { value: 'other_contribution', label: 'Outro aporte' }];

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function deriveFinanceStatus({ nature, total, settled, dueDate, today = new Date().toISOString().slice(0, 10), cancelled = false }) {
  if (cancelled) return 'cancelled';
  if (settled >= total && total > 0) return nature === FINANCE_NATURES.REVENUE ? 'received' : 'paid';
  if (settled > 0) return 'partial';
  if (dueDate && dueDate < today) return 'overdue';
  return 'pending';
}

export function normalizeFinancialEntry(entry = {}) {
  const nature = entry.nature || (entry.type === 'capital' ? FINANCE_NATURES.CAPITAL : entry.type === 'payable' ? FINANCE_NATURES.EXPENSE : FINANCE_NATURES.REVENUE);
  const total = money(entry.total_amount ?? entry.amount);
  const settled = money(entry.settled_amount ?? (nature === FINANCE_NATURES.CAPITAL ? total : nature === FINANCE_NATURES.REVENUE ? entry.received_amount : entry.paid_amount) ?? (entry.status === 'paid' || entry.status === 'received' ? total : 0));
  const balance = money(Math.max(0, total - settled));
  const status = deriveFinanceStatus({ nature, total, settled, dueDate: entry.due_date, cancelled: entry.status === 'cancelled' });
  return { ...entry, nature, type: nature === FINANCE_NATURES.CAPITAL ? 'capital' : nature === FINANCE_NATURES.REVENUE ? 'receivable' : 'payable', total_amount: total, received_amount: nature === FINANCE_NATURES.REVENUE || nature === FINANCE_NATURES.CAPITAL ? settled : 0, paid_amount: nature === FINANCE_NATURES.EXPENSE ? settled : 0, settled_amount: settled, balance_amount: nature === FINANCE_NATURES.CAPITAL ? 0 : balance, status: nature === FINANCE_NATURES.CAPITAL ? 'received' : status };
}

export function splitInstallments(total, quantity, firstDueDate) {
  const count = Math.max(1, Math.floor(Number(quantity) || 1));
  const cents = Math.round((Number(total) || 0) * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) => {
    const amount = (index === count - 1 ? cents - base * (count - 1) : base) / 100;
    const due = new Date(`${firstDueDate || new Date().toISOString().slice(0, 10)}T00:00:00`);
    due.setMonth(due.getMonth() + index);
    return { installment_number: index + 1, amount: money(amount), received_amount: 0, paid_amount: 0, due_date: due.toISOString().slice(0, 10), status: 'pending' };
  });
}

export function applyFinancialMovement(entry, amount) {
  const normalized = normalizeFinancialEntry(entry);
  const value = money(amount);
  if (value <= 0) throw new Error('O valor do movimento deve ser positivo.');
  if (value > normalized.balance_amount) throw new Error('O movimento não pode exceder o saldo pendente.');
  return normalizeFinancialEntry({ ...normalized, settled_amount: normalized.settled_amount + value, received_amount: normalized.received_amount + (normalized.nature === FINANCE_NATURES.REVENUE ? value : 0), paid_amount: normalized.paid_amount + (normalized.nature === FINANCE_NATURES.EXPENSE ? value : 0), status: undefined });
}

export function summarizeFinance(entries = [], movements = [], period) {
  const normalized = entries.map(normalizeFinancialEntry).filter((entry) => entry.status !== 'cancelled');
  const inPeriod = (movement) => !period || !period.start || !period.end || (movement.occurred_at || movement.paid_at || '').slice(0, 10) >= period.start && (movement.occurred_at || movement.paid_at || '').slice(0, 10) <= period.end;
  const realized = movements.filter(inPeriod).reduce((summary, movement) => {
    const amount = money(movement.amount);
    if (movement.direction === 'in') summary.inflows += amount;
    if (movement.direction === 'out') summary.outflows += amount;
    return summary;
  }, { inflows: 0, outflows: 0 });
  const capitalInflows = realized.inflows - movements.filter((movement) => movement.direction === 'in' && movement.entry_class === 'capital').reduce((sum, movement) => sum + money(movement.amount), 0);
  const capital = movements.filter((movement) => movement.direction === 'in' && movement.entry_class === 'capital').reduce((sum, movement) => sum + money(movement.amount), 0);
  return { receivable: money(normalized.filter((entry) => entry.nature === FINANCE_NATURES.REVENUE).reduce((sum, entry) => sum + entry.balance_amount, 0)), payable: money(normalized.filter((entry) => entry.nature === FINANCE_NATURES.EXPENSE).reduce((sum, entry) => sum + entry.balance_amount, 0)), inflows: money(realized.inflows), outflows: money(realized.outflows), capital: money(capital), operating_inflows: money(capitalInflows), operating_result: money(capitalInflows - realized.outflows), cash: money(realized.inflows - realized.outflows), result: money(realized.inflows - realized.outflows) };
}
