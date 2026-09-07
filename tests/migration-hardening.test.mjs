import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('precificação rejeita preço inválido e mínimo informado no backend', () => {
  const sql = read('0020_intelligent_pricing.sql');
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /new_price <= 0/);
  assert.match(sql, /minimumPrice/);
  assert.match(sql, /new_price < \(payload->>'minimumPrice'\)/);
  assert.match(sql, /pricing_history_company.*current_company_role/s);
  assert.match(sql, /financeiro.*estoque/s);
  assert.doesNotMatch(sql, /grant insert, update, delete on public\.product_pricing_history/);
});

test('0029 grants only server-side webhook privileges and usage RPC access', () => {
  const sql = read('0029_whatsapp_webhook_backend_permissions.sql');
  for (const statement of [
    /grant select on table public\.company_integrations to service_role/i,
    /grant select on table public\.customers to service_role/i,
    /grant select, insert, update on table public\.whatsapp_contacts to service_role/i,
    /grant select, insert, update on table public\.conversations to service_role/i,
    /grant select, insert, update on table public\.messages to service_role/i,
    /grant insert on table public\.integration_logs to service_role/i,
    /grant execute on function public\.increment_usage\(uuid, text, date, integer\) to service_role/i,
  ]) assert.match(sql, statement);
  assert.doesNotMatch(sql, /\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql, /disable row level security/i);
});

test('0030 audits duplicate WhatsApp keys and creates an ON CONFLICT-compatible unique index', () => {
  const sql = read('0030_whatsapp_message_idempotency.sql');
  assert.match(sql, /where external_message_id is not null/i);
  assert.match(sql, /group by company_id, channel, external_message_id/i);
  assert.match(sql, /having count\(\*\) > 1/i);
  assert.match(sql, /raise exception '0030 aborted/i);
  assert.match(sql, /create unique index if not exists messages_company_channel_external_message_uidx/i);
  assert.match(sql, /on public\.messages \(company_id, channel, external_message_id\)/i);
  assert.doesNotMatch(sql, /delete from public\.messages/i);
  assert.doesNotMatch(sql, /where external_message_id is not null\s*;/i);
});

test('catálogo separa leitura de gerenciamento por role', () => {
  const sql = read('0021_product_catalog.sql');
  assert.match(sql, /create policy catalog_select/);
  assert.match(sql, /create policy catalog_insert/);
  assert.match(sql, /current_company_role\(company_id\)/);
  assert.match(sql, /product_images_company_product_fk/);
});

test('loja pública limita payload e calcula preço no banco', () => {
  const sql = read('0023_online_store.sql');
  assert.match(sql, /jsonb_array_length\(p_items\)>100/);
  assert.match(sql, /length\(trim\(p_customer->>'name'\)\) > 160/);
  assert.match(sql, /unit_price := product_row\.price/);
  assert.match(sql, /store_orders_status_check/);
  assert.match(sql, /store_orders_total_check/);
});

test('vendas exigem role operacional e sessão autenticada', () => {
  const sql = read('0021_product_catalog.sql');
  assert.match(sql, /current_company_role\(result\.company_id\) not in \('admin','gestor','comercial','vendedor'\)/);
  assert.match(sql, /current_company_role\(company\) not in \('admin','gestor','comercial','vendedor'\)/);
  assert.match(sql, /previous_sale public\.sales/);
  assert.match(sql, /to_jsonb\(previous_sale\),to_jsonb\(result\)/);
  assert.match(sql, /Cliente não pertence à empresa/);
  assert.match(sql, /last_purchase_date=\(select max\(s\.sale_date\)/);
  assert.match(sql, /total_purchased=greatest\(0,total_purchased-result\.total\)/);
  assert.match(sql, /sale_count=greatest\(0,sale_count-1\)/);
  assert.match(sql, /avg_ticket=case when sale_count > 1/);
  assert.doesNotMatch(sql, /variant_id uuid references public\.product_variants\(id\)/);
});

test('módulos avançados usam current_company_role e métricas não negativas', () => {
  for (const file of ['0024_opportunity_foundation.sql', '0025_supplier_intelligence.sql', '0026_market_intelligence.sql', '0027_sales_hub.sql']) {
    assert.match(read(file), /current_company_role\(company_id\)/, file);
  }
  const sales = read('0027_sales_hub.sql');
  assert.match(sales, /channel_metrics_nonnegative_check/);
  assert.match(sales, /fee_rate_check/);
  assert.match(sales, /conversion_check/);
  assert.match(read('0024_opportunity_foundation.sql'), /product_opportunities_scores_check/);
  assert.match(read('0025_supplier_intelligence.sql'), /supplier_intelligence_scores_check/);
  assert.match(read('0026_market_intelligence.sql'), /market_opportunities_scores_check/);
  assert.match(sales, /channel_metrics_period_check/);
});

test('policies não deixam roles somente leitura escrever módulos avançados', () => {
  const opportunity = read('0024_opportunity_foundation.sql');
  const supplier = read('0025_supplier_intelligence.sql');
  const market = read('0026_market_intelligence.sql');
  const salesHub = read('0027_sales_hub.sql');
  for (const sql of [opportunity, supplier, market, salesHub]) {
    assert.match(sql, /create policy .*_select/);
    assert.match(sql, /create policy .*_insert/);
    assert.match(sql, /create policy .*_update/);
    assert.match(sql, /create policy .*_delete/);
  }
  assert.match(opportunity, /opportunity_product_drafts_company_opportunity_fk/);
  assert.match(supplier, /company_supplier_fk/);
  assert.match(salesHub, /company_product_fk/);
});
