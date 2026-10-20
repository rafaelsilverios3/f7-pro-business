import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');
test('catalog supports product material and service types across flows',()=>{
 const migration=read('supabase/migrations/0057_catalog_material_item_type.sql');
 assert.match(migration,/item_type in \('product','material','service'\)/);
 assert.match(read('src/schemas/index.js'),/z\.enum\(\['product', 'material', 'service'\]\)/);
 const products=read('src/pages/Produtos.jsx');
 assert.match(products,/Materiais/); assert.match(products,/item_type.*=== key/); assert.doesNotMatch(products,/p\.category \|\|/);
 const production=read('src/pages/Producao.jsx'); assert.match(production,/item_type: 'material'/); assert.match(production,/item_type === 'material'/); assert.match(production,/item_type === 'product'/);
 assert.match(read('src/pages/PDV.jsx'),/item_type === 'product' \|\| product\.item_type === 'service'/);
 assert.match(read('src/pages/Estoque.jsx'),/item_type === 'product' \|\| product\.item_type === 'material'/);
 assert.match(read('src/pages/Precificacao.jsx'),/item_type === 'product' \|\| product\.item_type === 'service'/);
});

test('catalog registration presents a distinct fixed form for products, raw materials, and services',()=>{
 const dialog=read('src/components/produtos/ProductDialog.jsx');
 const page=read('src/pages/Produtos.jsx');
 assert.match(dialog,/Cadastrar \$\{itemTypeName\(itemType\)\}/);
 assert.match(dialog,/itemType === 'material' \? 0 : moneyOr\(form\.sale_price\)/);
 assert.match(dialog,/O custo unitário desta matéria-prima compõe o custo do produto acabado/);
 assert.match(dialog,/isMaterial \? \([\s\S]*?Estoque interno de produção/);
 assert.match(dialog,/isMaterial \? \([\s\S]*?Custo unitário/);
 assert.match(dialog,/isService && <div[\s\S]*?Duração estimada/);
 assert.match(page,/defaultItemType=\{editing\?\.item_type \|\| tab\} fixedItemType/);
 assert.match(page,/Buscar \$\{itemLabel\}/);
 assert.match(page,/Custo das matérias-primas em estoque/);
 assert.doesNotMatch(page,/Total de serviços<\/p><p[^>]*>\{fmtNum\(stats\.services\)\}/);
});

test('inventory separates product and raw-material positions and movement histories',()=>{
 const page=read('src/pages/Estoque.jsx');
 const service=read('src/services/inventoryService.js');
 assert.match(page,/role="tablist" aria-label="Categoria do estoque"/);
 assert.match(page,/categoryItems = useMemo/);
 assert.match(page,/categoryProductIds\.has\(movement\.product_id\)/);
 assert.match(page,/A produção consome estes saldos e incorpora seus custos/);
 assert.match(service,/type === 'product' \|\| type === 'material'/);
 assert.match(service,/targetStock < 0/);
 assert.match(page,/new Set\(\(products \|\| \[\]\)\.filter\(\(product\) => product\.item_type === category\)/);
});

test('purchase replenishment only accepts stock-managed catalog items',()=>{
 const purchase=read('src/components/compras/PurchaseDialog.jsx');
 assert.match(purchase,/\['product', 'material'\]\.includes\(p\.item_type \|\| 'product'\)/);
 assert.match(purchase,/const invalidItem = items\.find/);
 assert.match(purchase,/Compras aceitam somente produtos e matérias-primas/);
 assert.match(purchase,/MATÉRIA-PRIMA/);
});

test('materials remain internal production inventory and the database rejects their sale',()=>{
 const migration=read('supabase/migrations/20261020130415_separate_material_inventory_and_sales.sql');
 const production=read('supabase/migrations/0058_production_material_item_type.sql');
 assert.match(migration,/before insert or update of items on public\.sales/i);
 assert.match(migration,/before insert or update of product_id, company_id on public\.purchase_items/i);
 assert.match(migration,/pedido de compra não pertence à empresa/i);
 assert.match(migration,/before update of status on public\.purchases/i);
 assert.match(migration,/matérias-primas possuem estoque de compra/i);
 assert.match(migration,/jsonb_array_elements\(new\.items\)/i);
 assert.match(migration,/lower\(coalesce\(item->>'item_type', ''\)\) = 'material'/i);
 assert.match(migration,/where p\.id = catalog_item_id/i);
 assert.match(migration,/catalog_company_id is distinct from new\.company_id/i);
 assert.match(migration,/errcode = '23514'/i);
 assert.match(migration,/before insert on public\.production_orders/i);
 assert.match(migration,/cost_status is distinct from 'current'/i);
 assert.match(migration,/security definer/i);
 assert.match(migration,/recipe_product_id is distinct from new\.product_id/i);
 assert.match(migration,/Conceptual rollback/i);
 assert.match(production,/material_cost := greatest\(0, coalesce\(material_row\.cost,0\)\)/i);
 assert.match(production,/update public\.products set cost=recipe_row\.unit_cost/i);
 const productionPage=read('src/pages/Producao.jsx');
 assert.match(productionPage,/costStale = item\.cost_status === 'stale'/);
 assert.match(productionPage,/disabled=\{costStale\}/);
 assert.match(productionPage,/Atualize a ficha técnica para recalcular o custo dos materiais/);
});
