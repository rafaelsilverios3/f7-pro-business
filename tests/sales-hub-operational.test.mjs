import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/SalesHub.jsx', import.meta.url), 'utf8');
const model = fs.readFileSync(new URL('../src/lib/salesHub.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/salesHubService.js', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/intelligence-query/index.ts', import.meta.url), 'utf8');

test('Sales Hub reutiliza rota existente e não cria armazenamento paralelo', () => {
  assert.match(page, /F7 Sales Hub/);
  assert.doesNotMatch(page, /sales-hub-v2|crm-v2|localStorage\s*[.(\[]/);
  assert.match(page, /navigate\('\/ai-sales'/);
  assert.match(page, /source_module: 'sales_hub'/);
});

test('modelo comercial mantém isolamento por company_id e exclui vendas canceladas', () => {
  assert.match(model, /row\?\.company_id === companyId/);
  assert.match(model, /row\?\.status !== 'cancelled'/);
  assert.match(model, /companyId, customers = \[\], products = \[\], sales = \[\], opportunities = \[\]/);
  assert.match(service, /customersRepository\.list\(companyId\)/);
  assert.match(service, /salesRepository\.list\(companyId/);
});

test('atenção e pipeline usam sinais persistidos sem score ou valor inventado', () => {
  assert.match(model, /priority_rank/);
  assert.match(model, /item\.score !== null && item\.score >= 70/);
  assert.match(model, /Number\.isFinite\(Number\(item\.value\)\) && Number\(item\.value\) > 0/);
  assert.match(model, /next_action/);
  assert.match(page, /Somente oportunidades CRM com valor persistido/);
});

test('Sales Hub envia contexto INTERNAL minimizado e saneado para a Intelligence', () => {
  assert.match(model, /source_module: 'sales_hub', mode: 'internal'/);
  assert.match(model, /customer_summary/);
  assert.match(model, /opportunity_summary/);
  assert.match(service, /sales_hub_context/);
  assert.match(edge, /value\.sales_hub_context/);
  assert.match(edge, /source_module: 'sales_hub', mode: 'internal'/);
  assert.doesNotMatch(model, /phone|email|document/);
});

test('lacunas de follow-up persistente ficam explícitas e não viram tarefas falsas', () => {
  assert.match(model, /Não há estrutura persistente de follow-ups\/atividades/);
  assert.match(page, /não simula tarefas nem persiste dados no navegador/);
  assert.doesNotMatch(service, /Task\.create|FollowUp\.create|Activity\.create/);
});

test('falhas parciais são identificadas sem esconder o estado disponível', () => {
  assert.match(service, /partial\.push\(label\)/);
  assert.match(service, /partial_errors: partial/);
  assert.match(page, /Algumas fontes comerciais estão indisponíveis/);
});

test('integrações só são exibidas conectadas por evidência real do backend', () => {
  assert.match(page, /channel\.connected && channel\.status === 'connected'/);
  assert.match(page, /Nenhuma integração externa está ativa/);
  assert.match(service, /connected: false, status: 'disconnected'/);
});
