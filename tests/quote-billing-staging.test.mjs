import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261021030000_quote_billing_staging.sql', import.meta.url), 'utf8');
const quotePage = await readFile(new URL('../src/pages/Orcamentos.jsx', import.meta.url), 'utf8');
const salesPage = await readFile(new URL('../src/pages/Vendas.jsx', import.meta.url), 'utf8');
const billingDialog = await readFile(new URL('../src/components/vendas/QuoteBillingDialog.jsx', import.meta.url), 'utf8');
const quoteService = await readFile(new URL('../src/services/quotesService.js', import.meta.url), 'utf8');

test('approved quote enters a unique, tenant scoped pending sale without stock or ledger changes', () => {
  assert.match(migration, /quotes_company_number_key/);
  assert.match(migration, /function public\.send_quote_to_sales\(target_quote uuid\)/);
  const sendFlow = migration.slice(migration.indexOf('function public.send_quote_to_sales'), migration.indexOf('function public.return_quote_sale_to_quote'));
  assert.match(sendFlow, /'draft'/);
  assert.match(sendFlow, /status='billing_pending'/);
  assert.match(sendFlow, /on conflict \(company_id,idempotency_key\)/);
  assert.doesNotMatch(sendFlow, /stock_movements|financial_entries|financial_installments/);
  assert.match(migration, /foreign key \(company_id, origin_quote_id\)/);
});

test('billing keeps approved pricing, checks stock, and commits sale, receivable, quote and audit atomically', () => {
  const finalize = migration.slice(migration.indexOf('function public.finalize_quote_sale'), migration.indexOf('function public.cancel_sale('));
  assert.match(finalize, /for update/);
  assert.match(finalize, /unit_price := nullif\(coalesce\(item->>'price'/);
  assert.match(finalize, /Estoque insuficiente para faturar/);
  assert.match(finalize, /insert into public\.financial_entries/);
  assert.match(finalize, /insert into public\.financial_installments/);
  assert.match(finalize, /status='completed'/);
  assert.match(finalize, /status='converted'/);
  assert.match(finalize, /quote\.sale_finalized/);
  assert.doesNotMatch(finalize, /finalize_sale_financial|finalize_sale_from_quote/);
  assert.match(migration, /if pending\.status='completed' then return pending/);
});

test('UI exposes explicit quote transfer and billing confirmation, with audit-safe return and cancel', () => {
  assert.match(quotePage, /Enviar para vendas/);
  assert.match(quotePage, /billing_pending/);
  assert.match(salesPage, /FATURAR/);
  assert.match(billingDialog, /Confirmar faturamento/);
  assert.match(billingDialog, /Nenhum pagamento externo será cobrado/);
  assert.match(billingDialog, /Retornar para orçamento/);
  assert.match(billingDialog, /Cancelar venda/);
  assert.match(billingDialog, /Agrupar vendas \(indisponível\)/);
  assert.match(quoteService, /send_quote_to_sales/);
  assert.doesNotMatch(quoteService, /convert_quote_to_sale/);
});
