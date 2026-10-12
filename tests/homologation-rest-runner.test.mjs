import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const app = await readFile(new URL('src/App.jsx', root), 'utf8');
const runner = await readFile(new URL('src/pages/HomologationRestRunner.jsx', root), 'utf8');
const runnerConfig = await readFile(new URL('src/pages/homologation/runnerConfig.js', root), 'utf8');
const supplierOffersSuite = await readFile(new URL('src/pages/homologation/suites/SupplierOffersSuite.jsx', root), 'utf8');
const supplierOffersChecks = await readFile(new URL('src/pages/homologation/suites/supplierOffersChecks.js', root), 'utf8');
const suiteRegistry = await readFile(new URL('src/pages/homologation/suites/registry.js', root), 'utf8');
const offersPanel = await readFile(new URL('src/components/compras/SupplierOffersPanel.jsx', root), 'utf8');
const compras = await readFile(new URL('src/pages/Compras.jsx', root), 'utf8');

test('homologation REST runner is gated to the exact homolog Supabase URL', () => {
  assert.match(app, /import\.meta\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(app, /import\.meta\.env\.VERCEL_GIT_COMMIT_REF !== HOMOLOGATION_VERCEL_BRANCH/);
  assert.match(app, /codex\/harden-multi-tenant-isolation/);
  assert.match(app, /VITE_DATA_PROVIDER !== 'supabase'/);
  assert.match(app, /https:\/\/vwylnjmapixtzhryiutt\.supabase\.co/);
  assert.match(app, /location\.pathname === '\/__homologation\/rest-check'/);
  assert.match(runnerConfig, /https:\/\/vwylnjmapixtzhryiutt\.supabase\.co/);
  assert.match(runnerConfig, /import\.meta\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(runnerConfig, /import\.meta\.env\.VERCEL_GIT_COMMIT_REF !== HOMOLOGATION_VERCEL_BRANCH/);
  assert.match(runnerConfig, /new URL\(import\.meta\.env\.VITE_SUPABASE_URL\)\.origin === HOMOLOGATION_URL/);
});

test('Vite injects only the non-secret Vercel deployment scope metadata needed by the route guard', async () => {
  const vite = await readFile(new URL('vite.config.js', root), 'utf8');
  assert.match(vite, /'import\.meta\.env\.VERCEL_ENV': JSON\.stringify\(process\.env\.VERCEL_ENV \|\| ''\)/);
  assert.match(vite, /'import\.meta\.env\.VERCEL_GIT_COMMIT_REF': JSON\.stringify\(process\.env\.VERCEL_GIT_COMMIT_REF \|\| ''\)/);
  assert.doesNotMatch(vite, /import\.meta\.env\.(?:VITE_)?(?:SERVICE_ROLE|SECRET|TOKEN)/i);
});

test('runner accepts only the three homolog identities and expected tenant roles', () => {
  assert.match(runnerConfig, /f7group7@gmail\.com/);
  assert.match(runnerConfig, /rafaelsilverio\.s3@gmail\.com/);
  assert.match(runnerConfig, /f7group7\+vendedor@gmail\.com/);
  assert.match(runnerConfig, /company_users/);
  assert.match(runnerConfig, /memberships\[0\]\.role !== identity\.role/);
});

test('runner uses existing Supabase session for read-only checks and never handles credentials', () => {
  assert.match(runnerConfig, /supabase\.auth\.getUser\(\)/);
  assert.match(runner, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(runner, /company_has_feature/);
  assert.doesNotMatch(runner, /service_role|signInWithPassword|password\s*:/i);
  assert.match(runnerConfig, /function validateOperationSession/);
  assert.match(runnerConfig, /memberships\[0\]\.company_id !== ownCompany\.id/);
});

test('writes are opt-in, constrained to uniquely marked customer fixtures, and revalidate real tenant membership', () => {
  assert.match(runner, /F7_HOMOLOG_REST_/);
  assert.match(runner, /Criar fixture fictícia de clientes/);
  assert.match(runner, /validateOperationSession\(supabase, \['admin'\]\)/);
  assert.match(runner, /company_id: guard\.ownCompany\.id, name: marker/);
  assert.match(runner, /cross-tenant fixture read/);
  assert.match(runner, /\.insert\(\{ company_id: other\.id, name: attackMarker \}\)/);
  assert.match(runner, /\.eq\('id', id\)\.eq\('company_id', other\.id\)\.eq\('name', marker\)/);
  assert.match(runner, /if \(stop\) return;/);
  assert.match(runner, /\.delete\(\)\s*\.eq\('id', id\)\.eq\('company_id', other\.id\)\.eq\('name', marker\)/);
});

test('seller administrative checks exercise REST grants and admin-only RPC authorization without sending invitations', () => {
  assert.match(runner, /runSellerAdministrativeChecks/);
  assert.match(runner, /update\(\{ role: 'admin' \}\)/);
  assert.match(runner, /update_company_member_role/);
  assert.match(runner, /somente administradores podem alterar papéis/i);
  assert.match(runner, /create_company_invite/);
  assert.match(runner, /example\.invalid/);
  assert.doesNotMatch(runner, /fetch\([^)]*(?:invite|email|whatsapp)/i);
});

test('cancel idempotency checks identify one exact cancelled homolog fixture and compare ledgers around both RPC calls', () => {
  assert.match(runner, /Produto fictício F7 A - teste de rascunho 0087/);
  assert.match(runner, /eq\('items->0->>name', productMarker\)/);
  assert.match(runner, /sales\.length !== 1/);
  assert.match(runner, /stock_movements/);
  assert.match(runner, /financial_entries/);
  assert.match(runner, /commissions/);
  assert.match(runner, /supabase\.rpc\('cancel_sale', \{ target_sale: sale\.id \}\)/);
  assert.match(runner, /JSON\.stringify\(after\) === JSON\.stringify\(before\)/);
  assert.match(runner, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
});

test('suite registry keeps the legacy core checks and adds a separately maintainable Supplier Offers module', () => {
  assert.match(suiteRegistry, /id: 'core'/);
  assert.match(suiteRegistry, /id: 'supplier-offers'/);
  assert.match(runner, /HOMOLOGATION_SUITES\.map/);
  assert.match(runner, /<SupplierOffersSuite/);
});

test('Supplier Offers suite identifies each real Auth session and verifies Admin B and seller REST visibility', () => {
  assert.match(supplierOffersSuite, /validateOperationSession\(getSupabaseClient\(\), \['admin', 'vendedor'\]\)/);
  assert.match(supplierOffersChecks, /guard\.identity\.label === 'Admin B'/);
  assert.match(supplierOffersChecks, /cross-tenant/);
  assert.match(supplierOffersChecks, /guard\.identity\.label === 'Vendedor A'/);
  assert.match(supplierOffersChecks, /REST HEAD own-tenant/);
});

test('Supplier Offers write probes require human confirmation, use one disposable RPC fixture, and stop on accepted operations', () => {
  assert.match(supplierOffersSuite, /window\.confirm\(/);
  assert.match(supplierOffersChecks, /create_supplier_offer/);
  assert.match(supplierOffersChecks, /REST INSERT own-tenant/);
  assert.match(supplierOffersChecks, /REST PATCH disposable fixture/);
  assert.match(supplierOffersChecks, /REST DELETE disposable fixture/);
  assert.match(supplierOffersChecks, /RPC create_supplier_offer/);
  assert.match(supplierOffersChecks, /RPC update_supplier_offer/);
  assert.match(supplierOffersChecks, /RPC transition_supplier_offer/);
  assert.match(supplierOffersChecks, /if \(insertDenied\.denied\)/);
  assert.match(supplierOffersChecks, /API aceitou a operação; linhas=.*sequência interrompida/);
  assert.match(supplierOffersChecks, /if \(!patchResult\.pass\) return checks/);
  assert.match(supplierOffersChecks, /if \(!deleteResult\.pass\) return checks/);
  assert.match(supplierOffersChecks, /if \(!createResult\.denied\) return checks/);
  assert.match(supplierOffersChecks, /if \(!updateResult\.denied\) return checks/);
  assert.match(supplierOffersChecks, /baseline/);
  assert.match(supplierOffersChecks, /owner verify operational snapshot/);
  assert.doesNotMatch(supplierOffersChecks, /service_role|signInWithPassword|password\s*:/i);
});

test('offers error state is exercised by a real read-only REST 400 and is limited to the exact homolog Preview build', () => {
  assert.match(supplierOffersChecks, /suppliers/);
  assert.match(offersPanel, /__f7_homologation_missing_column__/);
  assert.match(offersPanel, /consumeOffersErrorProbe/);
  assert.match(offersPanel, /Nenhuma gravação foi executada/);
  assert.match(compras, /shouldOpenOffersErrorProbe/);
  assert.match(supplierOffersSuite, /\/compras\?__homologation_offers_error=1/);
});
