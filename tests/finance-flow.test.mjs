import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFinancialMovement, normalizeFinancialEntry, splitInstallments, summarizeFinance } from '../src/lib/finance.js';

const expense = (category, amount = 1500) => normalizeFinancialEntry({ nature: 'expense', type: 'payable', category, amount, due_date: '2099-01-01' });
const revenue = (amount = 500) => normalizeFinancialEntry({ nature: 'revenue', type: 'receivable', category: 'Venda', amount, due_date: '2099-01-01' });

test('despesas operacionais geram somente conta a pagar', () => {
  for (const category of ['Aluguel', 'Salários', 'Impostos', 'Marketing', 'Fornecedor']) {
    const entry = expense(category);
    assert.equal(entry.nature, 'expense');
    assert.equal(entry.balance_amount, 1500);
    assert.equal(entry.received_amount, 0);
    assert.equal(entry.paid_amount, 0);
  }
});

test('venda nasce como receita a receber e pagamento parcial atualiza saldo', () => {
  const pending = revenue();
  assert.equal(pending.balance_amount, 500);
  const partial = applyFinancialMovement(pending, 200);
  assert.equal(partial.received_amount, 200);
  assert.equal(partial.balance_amount, 300);
  assert.equal(partial.status, 'partial');
  const received = applyFinancialMovement(partial, 300);
  assert.equal(received.balance_amount, 0);
  assert.equal(received.status, 'received');
});

test('pagamento de despesa gera saída e encerra a pagar', () => {
  const paid = applyFinancialMovement(expense('Aluguel'), 1500);
  assert.equal(paid.paid_amount, 1500);
  assert.equal(paid.balance_amount, 0);
  assert.equal(paid.status, 'paid');
});

test('parcelamento distribui centavos sem perder o total', () => {
  const parts = splitInstallments(900, 3, '2099-01-01');
  assert.deepEqual(parts.map((part) => part.amount), [300, 300, 300]);
  assert.equal(parts.reduce((sum, part) => sum + part.amount, 0), 900);
});

test('pagamento dividido e caixa consideram somente movimentos realizados', () => {
  const entry = revenue(500);
  const movements = [{ direction: 'in', amount: 200, occurred_at: '2026-09-10' }, { direction: 'in', amount: 300, occurred_at: '2026-09-11' }, { direction: 'out', amount: 1500, occurred_at: '2026-09-11' }];
  const summary = summarizeFinance([entry], movements, { start: '2026-01-01', end: '2026-12-31' });
  assert.equal(summary.receivable, 500);
  assert.equal(summary.cash, -1000);
  assert.equal(summary.result, -1000);
});
