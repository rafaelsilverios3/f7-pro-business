import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bankMigration = await readFile(new URL('../supabase/migrations/20261021040000_company_bank_accounts.sql', import.meta.url), 'utf8');
const financeMigration = await readFile(new URL('../supabase/migrations/0050_financial_flow.sql', import.meta.url), 'utf8');

function functionBody(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function public.${functionName}`);
  const end = nextFunctionName ? source.indexOf(`function public.${nextFunctionName}`, start) : source.length;
  assert.notEqual(start, -1, `${functionName} should exist`);
  return source.slice(start, end === -1 ? undefined : end);
}

test('multiple accounts are tenant scoped and only one active primary can exist per company', () => {
  assert.match(bankMigration, /create unique index if not exists company_bank_accounts_one_primary\s+on public\.company_bank_accounts\(company_id\) where is_primary and active/);
  const primary = functionBody(bankMigration, 'set_primary_company_bank_account', 'list_company_bank_accounts');
  assert.match(primary, /is_company_member\(company_id\)/);
  assert.match(primary, /current_company_role\(account_row\.company_id\) not in \('admin','gestor','financeiro'\)/);
  assert.match(primary, /update public\.company_bank_accounts set is_primary=false[^;]*where company_id=account_row\.company_id/);
  assert.match(primary, /bank_account\.primary_changed/);
});

test('receiving-account selection and receivable linkage reject cross-company or inactive accounts', () => {
  const selection = functionBody(bankMigration, 'set_quote_sale_receiving_account', 'link_sale_financial_account');
  assert.match(selection, /where id=target_sale and public\.is_company_member\(company_id\)/);
  assert.match(selection, /sale_row\.status <> 'draft'/);
  assert.match(selection, /id=target_account and company_id=sale_row\.company_id and active/);
  assert.match(selection, /sale\.receiving_account_selected/);

  const link = functionBody(bankMigration, 'link_sale_financial_account', 'record_financial_payment_to_account');
  assert.match(link, /s\.company_id=a\.company_id/);
  assert.match(link, /s\.bank_account_id=a\.id/);
  assert.match(link, /new\.bank_account_id := account_row\.id/);
});

test('manual receipt uses the financial idempotency boundary and audits the bank link', () => {
  const payment = functionBody(bankMigration, 'record_financial_payment_to_account');
  assert.match(payment, /current_company_role\(entry_row\.company_id\) not in \('admin','gestor','financeiro'\)/);
  assert.match(payment, /id=target_bank_account and company_id=entry_row\.company_id and active/);
  assert.match(payment, /result := public\.record_financial_payment\(/);
  assert.match(payment, /idempotency_key=movement_key/);
  assert.match(payment, /finance\.payment_account_linked/);
  assert.match(financeMigration, /unique\s*\(company_id, idempotency_key\)/);
  const recorder = functionBody(financeMigration, 'record_financial_payment', 'settle_financial_entry');
  assert.match(recorder, /where company_id = .*idempotency_key = payment_idempotency_key/);
  assert.match(recorder, /if movement_row\.id is not null then .*return entry_row/s);
});
