import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261023100000_f7_business_intelligence.sql', import.meta.url), 'utf8');
const sharing = await readFile(new URL('../supabase/functions/f7-bi-share/index.ts', import.meta.url), 'utf8');

test('BI tenant tables require both a company role and the effective feature entitlement', () => {
  for (const table of ['studies', 'imports', 'items', 'decisions', 'audit']) {
    const policy = migration.match(new RegExp(`create policy bi_${table}_[\\s\\S]*?;`, 'g')) || [];
    assert.ok(policy.length, `missing ${table} policy`);
    assert.ok(policy.every((statement) => statement.includes("company_has_feature(company_id, 'business_intelligence')")), `${table} policy must check the entitlement`);
  }
});

test('shared-report bearer credentials stay service-role-only and password hashes use a work factor', () => {
  assert.match(migration, /revoke all on function public\.bi_get_shared_report\(text,text\) from public, anon, authenticated;\s*grant execute on function public\.bi_get_shared_report\(text,text\) to service_role;/);
  assert.match(migration, /Share secrets are accessible only to the Edge Function's service role\./);
  assert.match(sharing, /iterations:\s*150_000/);
  assert.match(sharing, /token_hash:\s*await hash\(token\)/);
  assert.doesNotMatch(sharing, /select\('\*'\).*bi_shared_reports/);
});

test('an import cannot become complete unless its staged item count matches the immutable manifest', () => {
  assert.match(migration, /new\.status = 'complete' and \(new\.row_count = 0 or \(select count\(\*\) from public\.bi_items i where i\.company_id = new\.company_id and i\.import_id = new\.id\) <> new\.row_count\)/);
  assert.match(migration, /BI_IMPORT_STATUS_TRANSITION_INVALID/);
  assert.match(migration, /BI_IMPORT_IMMUTABLE/);
});
