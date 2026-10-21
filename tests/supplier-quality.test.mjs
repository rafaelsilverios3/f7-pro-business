import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupplierCandidates, extractSupplierMentions, safeSupplierPayload } from '../supabase/functions/_shared/supplierResearch.ts';

test('editorial rankings stay as discovery sources and never become supplier candidates', () => {
  const article = {
    title: '8 Best Dropshipping Suppliers in Brazil',
    url: 'https://example.com/blog/dropshipping-brasil',
    snippet: 'This guide compares several providers, including Acme Brinquedos, Loja Beta and Gamma Importados.',
  };
  assert.deepEqual(buildSupplierCandidates([article], 'dropshipping brasil'), []);
  assert.deepEqual(extractSupplierMentions([article]), ['Acme Brinquedos', 'Loja Beta', 'Gamma Importados']);
  assert.equal(safeSupplierPayload({ name: article.title, sources: [{ ...article, evidence: article.snippet }] }), null);
});

test('an individual commercial source can identify and qualify a supplier with evidence', () => {
  const result = {
    title: 'Acme Brinquedos Ltda | Fornecedor de brinquedos pedagógicos',
    url: 'https://acme.example.com/catalogo/brinquedos',
    snippet: 'A Acme Brinquedos Ltda fornece brinquedos pedagógicos no atacado para clínicas no Brasil. Consulte nosso catálogo de produtos.',
    source_type: 'public_web',
  };
  const [candidate] = buildSupplierCandidates([result], 'fornecedores brinquedos pedagógicos', new Date().toISOString(), { category: 'brinquedos pedagógicos', location: 'Brasil' });
  assert.equal(candidate.name, 'Acme Brinquedos Ltda');
  assert.equal(candidate.name_status, 'CONFIRMADO');
  assert.equal(candidate.region_status, 'CONFIRMADA');
  assert.equal(candidate.save_eligible, true);
  assert.equal(candidate.qualification, 'COMPROVADO');
  assert.ok(candidate.sources.some((source) => source.source_role === 'COMMERCIAL_EVIDENCE'));
  assert.equal(safeSupplierPayload(candidate)?.name, 'Acme Brinquedos Ltda');
});

test('a commercial looking domain and page title alone do not prove supplier identity', () => {
  const result = {
    title: 'Brinquedos pedagógicos para todas as clínicas',
    url: 'https://brinquedos.example.com/',
    snippet: 'Veja nossa seleção de produtos e novidades.',
    source_type: 'public_web',
  };
  const [candidate] = buildSupplierCandidates([result], 'brinquedos pedagógicos');
  assert.equal(candidate.identity_confirmed, false);
  assert.equal(candidate.save_eligible, false);
  assert.ok(candidate.score <= 39);
  assert.equal(safeSupplierPayload(candidate), null);
});

test('category and commercial model filters remain optional and generic searches stay usable', () => {
  const result = {
    title: 'Acme Peças Agrícolas Ltda | Distribuidor',
    url: 'https://acme-parts.example.com/catalogo',
    snippet: 'Acme Peças Agrícolas Ltda é distribuidora de peças agrícolas e catálogo para revendedores no Brasil.',
    source_type: 'public_web',
  };
  const [candidate] = buildSupplierCandidates([result], 'peças agrícolas', new Date().toISOString(), { category: 'peças agrícolas', location: 'Brasil', commercial_model: 'distribuicao' });
  assert.equal(candidate.save_eligible, true);
  assert.match(candidate.type, /DISTRIBUIDOR/);
  assert.deepEqual(buildSupplierCandidates([result], 'fornecedores de eletrônicos', new Date().toISOString(), { category: 'eletrônicos' })[0].save_eligible, false);
});
