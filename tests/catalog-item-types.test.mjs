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
