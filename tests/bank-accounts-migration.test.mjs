import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261021040000_company_bank_accounts.sql', 'utf8');

test('bank account identifiers and Pix keys are stored in Vault rather than plaintext columns', () => {
  assert.match(migration, /secret_id uuid not null/);
  assert.match(migration, /vault\.create_secret\(/);
  assert.match(migration, /vault\.update_secret\(/);
  assert.match(migration, /join vault\.decrypted_secrets sec on sec\.id=a\.secret_id/);
  assert.doesNotMatch(migration, /^\s*(agency|account_number|holder_document|pix_key)\s+text\b/gm);
  assert.match(migration, /grant select on public\.company_bank_accounts to authenticated/);
  assert.doesNotMatch(migration, /grant select, insert, update on public\.company_bank_accounts/);
});

test('account lookup and writes are role checked, tenant scoped, and audited', () => {
  assert.match(migration, /public\.is_company_member\(target_company\)/);
  assert.match(migration, /public\.current_company_role\(target_company\) not in \('admin','gestor','financeiro'\)/);
  assert.match(migration, /save_company_bank_account/);
  assert.match(migration, /get_company_bank_account_secret/);
  assert.match(migration, /list_company_receiving_accounts/);
  assert.match(migration, /bank_account\.secret_created/);
  assert.match(migration, /bank_account\.secret_updated/);
  assert.match(migration, /foreign key\(company_id,bank_account_id\) references public\.company_bank_accounts\(company_id,id\)/);
});
