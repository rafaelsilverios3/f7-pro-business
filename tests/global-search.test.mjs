import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchSourceRows } from '../src/lib/globalSearch.js';

const source = { key: 'products', label: 'Produtos', route: '/produtos', fields: ['name', 'sku', 'barcode'], title: (row) => row.name, subtitle: (row) => row.sku || row.barcode || 'Produto' };

test('global search matches real identifiers, groups metadata and limits each source', () => {
  const rows = [
    { id: '1', name: 'Bolo Chocolate ao Leite', sku: 'BOLO-01', company_id: 'a' },
    { id: '2', name: 'Bolo Baunilha', sku: 'BOLO-02', company_id: 'a' },
    { id: '3', name: 'Bolo Cenoura', sku: 'BOLO-03', company_id: 'a' },
  ];
  const result = searchSourceRows(rows, source, 'bolo-01', 2);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { id: '1', type: 'products', category: 'Produtos', route: '/produtos', title: 'Bolo Chocolate ao Leite', subtitle: 'BOLO-01' });
  assert.equal(searchSourceRows(rows, source, 'bolo', 2).length, 2);
  assert.equal(searchSourceRows(rows, source, 'inexistente').length, 0);
});

test('global search is debounced, tenant scoped and stale-request safe', () => {
  const service = fs.readFileSync('src/services/globalSearchService.js', 'utf8');
  const layout = fs.readFileSync('src/components/layout/Layout.jsx', 'utf8');
  assert.match(service, /repository\.list\(companyId/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(layout, /setTimeout\(\(\) =>/);
  assert.match(layout, /}, 300\)/);
  assert.match(layout, /requestId !== requestRef\.current/);
});

test('dashboard status labels remain factual while being presented in Portuguese', () => {
  const metrics = fs.readFileSync('src/services/metricsService.js', 'utf8');
  const dashboard = fs.readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(metrics, /completed: 'Concluídas'/);
  assert.match(metrics, /cancelled: 'Canceladas'/);
  assert.match(metrics, /paid: 'Pagas'/);
  assert.match(dashboard, /xl:grid-cols-12/);
  assert.match(dashboard, /className="xl:col-span-8"/);
  assert.match(dashboard, /xl:grid-cols-3/);
});
