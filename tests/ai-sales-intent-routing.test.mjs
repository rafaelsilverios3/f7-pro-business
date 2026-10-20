import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyAiSalesIntent } from '../supabase/functions/_shared/aiSalesIntent.js';

const endpoint = fs.readFileSync(new URL('../supabase/functions/ai-sales-assistant/index.ts', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../supabase/functions/_shared/aiSalesAccess.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/AiSalesAssistant.jsx', import.meta.url), 'utf8');

test('AI Sales separa consulta, análise, orientação e criação de texto', () => {
  assert.equal(classifyAiSalesIntent('Quais produtos temos?'), 'product');
  assert.equal(classifyAiSalesIntent('Analise as vendas dos últimos 30 dias'), 'sales_analysis');
  assert.equal(classifyAiSalesIntent('Como melhorar a conversão de vendas?'), 'general_guidance');
  assert.equal(classifyAiSalesIntent('Escreva uma mensagem de apresentação comercial'), 'message_draft');
  assert.equal(classifyAiSalesIntent('Escreva uma oferta para o Produto Aurora'), 'message_draft');
  assert.equal(classifyAiSalesIntent('Compare ofertas de fornecedores'), 'supplier_offer_pricing');
});

test('criação de texto não depende de produto; dados empresariais são consultados somente quando pedidos', () => {
  assert.match(endpoint, /intent === 'message_draft'/);
  assert.match(endpoint, /const lookupRequested =/);
  assert.match(endpoint, /productSearchTerm\(message\)/);
  assert.match(endpoint, /Use somente fatos fornecidos/);
  assert.match(endpoint, /use marcadores como \[produto\], \[preço\] ou \[condição\]/);
  assert.match(endpoint, /external_research_used = false/);
});

test('análise de vendas usa somente tenant atual, período delimitado e exclui rascunhos/cancelamentos', () => {
  assert.match(endpoint, /from\('sales'\)\.select\('status,total,sale_date'\)\.eq\('company_id', companyId\)\.gte\('sale_date', since\)\.lte\('sale_date', today\)/);
  assert.match(endpoint, /source\.filter\(isRevenueSale\)/);
  assert.match(access, /sales_analysis: \['sales\.view'\]/);
});

test('cópia de resposta, formatação Markdown, avisos de fonte e sugestões correspondem aos fluxos', () => {
  assert.match(page, /ReactMarkdown/);
  assert.match(page, /Copiar texto/);
  assert.match(page, /item\.notices\?\.data_dependencies/);
  assert.match(page, /Analise as vendas dos últimos 30 dias/);
  assert.match(page, /Escreva uma mensagem de apresentação comercial/);
  assert.match(page, /Encontre novos fornecedores/);
});

test('novos intentos preservam a autorização existente e o fluxo de orçamento por chamada', () => {
  assert.match(access, /message_draft: \['ai_sales\.use'\]/);
  assert.match(access, /general_guidance: \['ai_sales\.use'\]/);
  assert.match(endpoint, /reserveAIModelBudget/);
  assert.match(endpoint, /settleAIReservation/);
  assert.match(endpoint, /permissionsForTool\(intent\)/);
  assert.match(endpoint, /createDraft\(userClient\(jwt\)/);
});
