import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCatalogFilters, numberCatalogOptions, toCatalogOption } from '../src/lib/catalogSearch.js';
import fs from 'node:fs';

const product = { id: 'p1', name: 'Camiseta F7', category: 'Moda', brand: 'F7', color: 'Preta', size: 'G', price: 99.9, stock: 4, active: true, tags: ['algodão'] };

test('catálogo filtra por texto, atributos, preço e estoque', () => {
  assert.equal(matchesCatalogFilters(product, { query: 'camiseta', size: 'G', color: 'preta', maxPrice: 120 }), true);
  assert.equal(matchesCatalogFilters(product, { maxPrice: 80 }), false);
  assert.equal(matchesCatalogFilters({ ...product, stock: 0 }, {}), false);
});

test('opções são numeradas e preservam preço real', () => {
  const option = toCatalogOption(product, { images: [{ url: '/real.jpg' }] });
  const numbered = numberCatalogOptions([option]);
  assert.equal(numbered[0].selection_number, 1);
  assert.equal(numbered[0].price, 99.9);
  assert.equal(numbered[0].images[0].url, '/real.jpg');
});

test('filtros não aceitam produto inativo', () => {
  assert.equal(matchesCatalogFilters({ ...product, active: false }, {}), false);
});

test('permissões do atendimento não concedem acesso financeiro', () => {
  const source = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
  assert.match(source, /atendimento:[^\n]+conversation\.\*[^\n]+orders\.create_from_conversation/);
  assert.match(source, /comercial:[^\n]+conversation\.\*[^\n]+orders\.create_from_conversation/);
  assert.match(source, /vendedor:[^\n]+conversation\.\*[^\n]+orders\.create_from_conversation/);
  assert.match(source, /estoque:[^\n]+notifications\.view/);
  assert.doesNotMatch(source, /estoque:[^\n]+conversation\.view/);
});
