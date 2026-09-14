import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebar = fs.readFileSync('src/components/layout/Sidebar.jsx', 'utf8');

test('sidebar follows the business workflow without changing routes or permissions', () => {
  const groups = ['Principal', 'Cadastros', 'Operação', 'Gestão', 'Inteligência', 'Sistema'];
  const groupPositions = groups.map((group) => sidebar.indexOf(`group: '${group}'`));
  assert.ok(groupPositions.every((position) => position >= 0));
  assert.deepEqual([...groupPositions].sort((a, b) => a - b), groupPositions);

  const workflow = [
    ['Clientes', '/clientes', 'customers.view'],
    ['Catálogo', '/produtos', 'products.view'],
    ['Precificação', '/precificacao', 'pricing.view'],
    ['Estoque', '/estoque', 'inventory.view'],
    ['Compras', '/compras', 'purchases.view'],
    ['Orçamentos', '/orcamentos', 'quotes.view'],
    ['Vendas', '/vendas', 'sales.view'],
    ['PDV', '/pdv', 'pdv.use'],
    ['Produção', '/producao', 'production.view'],
    ['Financeiro', '/financeiro', 'finance.view'],
    ['Metas e Comissões', '/metas', 'goals.view'],
  ];
  const positions = workflow.map(([label, route, permission]) => {
    const position = sidebar.indexOf(`to: '${route}', label: '${label}'`);
    assert.ok(position >= 0, `${label} route should remain present`);
    assert.match(sidebar.slice(position, position + 140), new RegExp(`permission: '${permission}'`));
    return position;
  });
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal(new Set(workflow.map(([label]) => label)).size, workflow.length);
});
