import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const fn = fs.readFileSync('supabase/functions/ai-sales-assistant/index.ts', 'utf8');
const page = fs.readFileSync('src/pages/AiSalesAssistant.jsx', 'utf8');
const gate = fs.readFileSync('supabase/migrations/0062_ai_sales_assistant_gate.sql', 'utf8');

test('Sales Assistant usa gate da empresa e membership server-side', () => {
  assert.match(fn, /company_has_feature/);
  assert.match(fn, /company_users/);
  assert.match(fn, /ROLES/);
  assert.match(gate, /ai_sales/);
});

test('ferramentas comerciais são explícitas e tenant-scoped', () => {
  for (const name of ['buscar_produto', 'consultar_estoque', 'consultar_preco', 'listar_variacoes', 'buscar_cliente', 'consultar_pedido', 'buscar_oportunidades', 'consultar_fornecedor', 'consultar_canais']) assert.match(fn, new RegExp(name));
  assert.match(fn, /eq\('company_id', companyId\)/);
  assert.doesNotMatch(fn, /body\.sql|query\(body/);
});

test('rascunho exige confirmação e não baixa estoque', () => {
  assert.match(fn, /confirmed !== true/);
  assert.match(fn, /status: 'draft'/);
  assert.match(fn, /audit_logs/);
  assert.doesNotMatch(fn, /stock_movements.*insert/);
});

test('UI ativa conversa, fallback factual e confirmação humana', () => {
  assert.match(page, /Assistente ativo/);
  assert.match(page, /aiSalesService\.chat/);
  assert.match(page, /Confirmar criação do rascunho/);
  assert.match(page, /open_supplier_intelligence/);
});
