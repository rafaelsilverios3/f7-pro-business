import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('catalog list is scoped to active item type even without search text',()=>{const source=fs.readFileSync('src/pages/Produtos.jsx','utf8');assert.match(source,/\(p\.item_type \|\| 'product'\) === tab/);assert.doesNotMatch(source,/if \(!query\) return items/);});
