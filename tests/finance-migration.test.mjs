import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0050_financial_flow.sql', 'utf8');
const capitalMigration = fs.readFileSync('supabase/migrations/0051_capital_contributions.sql', 'utf8');
const provider = fs.readFileSync('src/data/providers/supabaseProvider.js', 'utf8');
const financePage = fs.readFileSync('src/pages/Financeiro.jsx', 'utf8');
const salesService = fs.readFileSync('src/services/salesService.js', 'utf8');
const amountDefaultFix = fs.readFileSync('supabase/migrations/0075_fix_financial_entry_amount_default.sql', 'utf8');

test('migration separates nature, titles, installments and real cash movements', () => {
  assert.match(migration, /add column if not exists nature text/);
  assert.match(migration, /create table if not exists public\.financial_movements/);
  assert.match(migration, /create table if not exists public\.financial_installments/);
  assert.match(migration, /record_financial_payment/);
  assert.match(migration, /finalize_sale_financial/);
  assert.match(migration, /inequivocamente operacionais/);
  assert.match(migration, /lower\(trim\(coalesce\(category/);
  assert.match(migration, /is_company_member\(company_id\)/);
  assert.doesNotMatch(migration, /float|double precision/i);
});

test('frontend chooses revenue or expense before exposing categories', () => {
  assert.match(financePage, /FINANCE_NATURES\.REVENUE/);
  assert.match(financePage, /FINANCE_NATURES\.EXPENSE/);
  assert.match(financePage, /REVENUE_CATEGORIES/);
  assert.match(financePage, /EXPENSE_CATEGORIES/);
  assert.match(financePage, /Fluxo de caixa/);
  assert.match(financePage, /Contas a receber/);
  assert.match(financePage, /Contas a pagar/);
});

test('sales call the financial wrapper instead of creating a paid title blindly', () => {
  assert.match(salesService, /finalize_sale_financial/);
  assert.doesNotMatch(salesService, /rpc\('finalize_sale'/);
});

test('financial entry trigger preserves a positive sale amount when total_amount has its zero default', () => {
  assert.match(amountDefaultFix, /new\.total_amount = 0 and coalesce\(new\.amount, 0\) > 0/);
  assert.match(amountDefaultFix, /new\.total_amount := new\.amount/);
  assert.match(amountDefaultFix, /new\.amount := new\.total_amount/);
});

test('capital contribution is a confirmed non-operating cash entry', () => {
  assert.match(capitalMigration, /nature in \('revenue','expense','capital'\)/);
  assert.match(capitalMigration, /record_capital_contribution/);
  assert.match(capitalMigration, /entry_class.*capital/);
  assert.match(capitalMigration, /is_operating.*false/);
  assert.match(capitalMigration, /tg_op = 'UPDATE'.*new\.paid_by := auth\.uid\(\)/s);
  assert.match(capitalMigration, /due_date.*null/);
  assert.match(capitalMigration, /is_company_member/);
  assert.match(capitalMigration, /security definer/);
  assert.match(financePage, /Aporte \/ investimento/);
  assert.match(financePage, /CAPITAL_TYPES/);
  assert.doesNotMatch(capitalMigration, /financial_entries\([^)]*created_by/i);
  assert.doesNotMatch(provider, /FinancialEntry: \[[^\]]*['"]created_by['"]/);
  assert.match(capitalMigration, /paid_at\)\s+values\(/);
  assert.match(capitalMigration, /occurred_at_input\) returning \* into entry_row/);
});

test('financial entry payloads use only the remote schema and defer paid_by to settlement', () => {
  const remoteColumns = ['company_id', 'sale_id', 'purchase_id', 'bank_account_id', 'type', 'nature', 'entry_class', 'capital_type', 'is_operating', 'status', 'description', 'category', 'amount', 'total_amount', 'received_amount', 'paid_amount', 'due_date', 'paid_date', 'paid_at', 'paid_by', 'source_type', 'source_detail', 'notes', 'account', 'payment_method', 'cancelled_at'];
  const match = provider.match(/FinancialEntry: \[([^\]]+)\]/);
  assert.ok(match);
  const columns = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, column]) => column);
  assert.deepEqual(columns, remoteColumns);
  assert.match(financePage, /await financeService\.recordPayment/);
});
