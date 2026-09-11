import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0050_financial_flow.sql', 'utf8');
const capitalMigration = fs.readFileSync('supabase/migrations/0051_capital_contributions.sql', 'utf8');
const financePage = fs.readFileSync('src/pages/Financeiro.jsx', 'utf8');
const salesService = fs.readFileSync('src/services/salesService.js', 'utf8');

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

test('capital contribution is a confirmed non-operating cash entry', () => {
  assert.match(capitalMigration, /nature in \('revenue','expense','capital'\)/);
  assert.match(capitalMigration, /record_capital_contribution/);
  assert.match(capitalMigration, /entry_class.*capital/);
  assert.match(capitalMigration, /is_operating.*false/);
  assert.match(capitalMigration, /due_date.*null/);
  assert.match(capitalMigration, /is_company_member/);
  assert.match(financePage, /Aporte \/ investimento/);
  assert.match(financePage, /CAPITAL_TYPES/);
});
