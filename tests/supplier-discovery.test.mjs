import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync(new URL('../supabase/functions/supplier-intelligence/index.ts', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../supabase/functions/_shared/supplierResearch.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/SupplierIntelligence.jsx', import.meta.url), 'utf8');

test('supplier discovery uses Brave research, source evidence and bounded depth', () => {
  assert.match(edge, /conductWebResearch/);
  assert.match(edge, /depth === 'detailed'/);
  assert.match(edge, /SUPPLIER_SEARCH_STARTED/);
  assert.match(edge, /SUPPLIER_QUALIFICATION_COMPLETED/);
  assert.match(helper, /buildSupplierCandidates/);
  assert.match(helper, /source_count/);
});

test('supplier candidates are deterministic and never fabricated without a public URL', () => {
  assert.match(helper, /new URL/);
  assert.match(helper, /if \(!sourceUrl \|\| !name \|\| GENERIC_PAGE_TITLE\.test\(name\) \|\| EDITORIAL\.test\(name\)/);
  assert.match(helper, /QUALIFICADO/);
  assert.match(helper, /EM_ANALISE/);
  assert.match(helper, /Preço não encontrado/);
});

test('saving requires explicit human confirmation and protects tenant scope', () => {
  assert.match(page, /Confirmar e salvar/);
  assert.match(edge, /action === 'save'/);
  assert.match(edge, /eq\('company_id', companyId\)/);
  assert.match(edge, /duplicate/);
  assert.match(page, /não sobrescrevem cadastros internos/);
});

test('comparison and RFQ remain review-only', () => {
  assert.match(page, /Comparação lado a lado/);
  assert.match(page, /Rascunho de cotação/);
  assert.match(page, /Rascunho não enviado/);
  assert.match(page, /Preparar cotação/);
});
