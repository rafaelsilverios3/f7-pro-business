import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { productSearchTerm } from '../supabase/functions/_shared/productSearchTerm.js';
import { buildAiSalesHistory } from '../src/lib/aiSalesHistory.js';

const fn = fs.readFileSync('supabase/functions/ai-sales-assistant/index.ts', 'utf8');
const page = fs.readFileSync('src/pages/AiSalesAssistant.jsx', 'utf8');
const gate = fs.readFileSync('supabase/migrations/0062_ai_sales_assistant_gate.sql', 'utf8');
const draftRpc = fs.readFileSync('supabase/migrations/0086_ai_sales_draft_rpc.sql', 'utf8');

test('Sales Assistant usa gate da empresa e membership server-side', () => {
  assert.match(fn, /company_has_feature/);
  assert.match(fn, /feature: 'ai_sales'/);
  assert.match(fn, /company_users/);
  assert.match(fn, /ROLES/);
  assert.match(gate, /ai_sales/);
});

test('ferramentas comerciais são explícitas e tenant-scoped', () => {
  for (const name of ['buscar_produto', 'consultar_estoque', 'consultar_preco', 'listar_variacoes', 'buscar_cliente', 'consultar_pedido', 'buscar_oportunidades', 'consultar_fornecedor', 'consultar_canais']) assert.match(fn, new RegExp(name));
  assert.match(fn, /eq\('company_id', companyId\)/);
  assert.doesNotMatch(fn, /body\.sql|query\(body/);
});

test('consultas genéricas de produtos reconhecem o plural e não viram busca literal', () => {
  assert.match(fn, /productSearchTerm\(message\)/);
  assert.equal(productSearchTerm('Quais produtos temos?'), '');
  assert.equal(productSearchTerm('HOMOLOG-A-QA-20261011'), 'HOMOLOG-A-QA-20261011');
  assert.equal(productSearchTerm('Qual o estoque do HOMOLOG-A-QA-20261011?'), 'HOMOLOG-A-QA-20261011');
  assert.equal(productSearchTerm('Quanto tem de estoque do HOMOLOG-A-QA-20261011?'), 'HOMOLOG-A-QA-20261011');
  assert.equal(productSearchTerm('Quanto temos em estoque?'), '');
  assert.equal(productSearchTerm('temos o produto F7?'), 'F7');
});

test('rascunho exige confirmação e passa por RPC autenticada sem DML direto', () => {
  assert.match(fn, /confirmed !== true/);
  assert.match(fn, /createDraft\(userClient\(jwt\)/);
  assert.match(fn, /\.rpc\('create_draft_sale'/);
  assert.doesNotMatch(fn, /from\('sales'\)\.insert/);
  assert.match(draftRpc, /security definer/i);
  assert.match(draftRpc, /auth\.uid\(\) is null/i);
  assert.match(draftRpc, /is_company_member\(company\)/i);
  assert.match(draftRpc, /current_company_role\(company\) not in \('admin', 'gestor', 'comercial', 'vendedor'\)/i);
  assert.match(draftRpc, /company_has_feature\(company, 'ai_sales'\)/i);
  assert.match(draftRpc, /'draft'/);
  assert.match(draftRpc, /revoke all on function public\.create_draft_sale\(jsonb\) from public, anon, service_role/i);
  assert.match(page, /idempotency_key: crypto\.randomUUID\(\)/);
  assert.match(page, /idempotency_key: pendingDraft\.idempotency_key/);
});

test('UI ativa conversa, fallback factual e confirmação humana', () => {
  assert.match(page, /Assistente ativo/);
  assert.match(page, /aiSalesService\.chat/);
  assert.match(page, /Confirmar criação do rascunho/);
  assert.match(page, /open_supplier_intelligence/);
});

test('contexto de produto e cliente é reaproveitado somente como contexto de seguimento', () => {
  assert.match(fn, /previousProduct/);
  assert.match(fn, /previousCustomer/);
  const product = { id: 'p1', name: 'Produto fictício', sku: 'TEST-1' };
  const history = buildAiSalesHistory([
    { role: 'assistant', answer: 'Olá' },
    { role: 'user', answer: 'Quais produtos temos?' },
    { role: 'assistant', answer: 'Encontrei um produto', tool: 'buscar_produto', data: [product], context: {} },
    { role: 'user', answer: 'Quanto temos em estoque?' },
  ]);
  assert.equal(history.length, 1);
  assert.equal(history[0].message, 'Quais produtos temos?');
  assert.equal(history[0].data[0].id, 'p1');
});
