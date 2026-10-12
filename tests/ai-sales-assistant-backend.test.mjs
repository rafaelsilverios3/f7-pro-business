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
  assert.match(fn, /roleHasAiSalesPermissions/);
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
  assert.match(page, /idempotency_key: visiblePendingDraft\.idempotency_key/);
});

test('UI só habilita conversa depois de confirmar status no backend e distingue fallback factual', () => {
  assert.match(page, /aiSalesService\.status\(company\.id\)/);
  assert.match(page, /provider_connection_verified: false|provider_configured_unverified/);
  assert.match(page, /Resposta factual do sistema · não gerada por IA/);
  assert.doesNotMatch(page, /Assistente ativo para/);
  assert.match(page, /aiSalesService\.chat/);
  assert.match(page, /Confirmar criação do rascunho/);
  assert.match(page, /open_supplier_intelligence/);
});

test('backend valida a permissão específica antes de consultar cada ferramenta', () => {
  assert.match(fn, /roleHasAiSalesPermissions\(member\.role\)/);
  assert.match(fn, /permissionsForTool\(intent\)/);
  assert.match(fn, /TOOL_PERMISSION_DENIED/);
  assert.match(fn, /target_metric: metric/);
  assert.match(fn, /reserveAIBudget/);
  assert.match(fn, /feature: 'ai_sales'/);
  assert.match(fn, /consumeRateLimit\(sb, companyId, userData\.user\.id, 'ai-sales-status', 30\)/);
  assert.match(fn, /const rateLimit = await consumeRateLimit\(sb, companyId, userData\.user\.id\)/);
});

test('respostas de cliente e fornecedor não selecionam documentos, telefone ou e-mail', () => {
  assert.doesNotMatch(fn, /select\('id,company_id,name,email,phone,document,created_at'\)/);
  assert.match(fn, /Encontrei \$\{result\.length\} cliente\(s\) correspondente/);
  assert.match(fn, /Encontrei \$\{result\.length\} perfil\(is\) de Supplier Intelligence/);
  assert.match(fn, /sanitizeAiSalesProviderData/);
  assert.match(fn, /providerData, factualAnswer/);
  assert.doesNotMatch(fn, /generateStructured\('openai_compatible', \{ message, tool, result, factualAnswer, history, context \}\)/);
});

test('análise Supplier Offers reusa cálculo Pricing e restringe consulta ao produto e à empresa ativa', () => {
  assert.match(fn, /classifySupplierOffersForPricing/);
  assert.match(fn, /buildSupplierOfferPricingScenario/);
  assert.match(fn, /supplierOfferProductSearchTerm\(message\)/);
  assert.match(fn, /from\('supplier_offers'\)/);
  assert.match(fn, /\.eq\('company_id', companyId\)\.eq\('product_id', product\.id\)/);
  assert.match(fn, /status: offer\.status/);
  assert.match(fn, /select\('channel_id,fee_rate,status'\)/);
  assert.match(fn, /não validada pelo marketplace/);
  assert.match(fn, /supplier_quantity_note: 'quantidade declarada pelo fornecedor; não é estoque próprio nem disponibilidade confirmada'/);
  assert.match(fn, /generation_mode: generationMode/);
  assert.match(fn, /from\('supplier_intelligence_profiles'\)/);
  assert.match(fn, /from\('sales_channels'\)/);
  assert.doesNotMatch(fn, /from\('company_integrations'\)|from\('suppliers'\)/);
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
