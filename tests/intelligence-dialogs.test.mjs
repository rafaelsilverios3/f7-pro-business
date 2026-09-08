import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('intelligence creation dialogs start closed and open only from the plus action', () => {
  for (const file of ['Opportunities.jsx', 'SupplierIntelligence.jsx', 'MarketIntelligence.jsx', 'SalesHub.jsx']) {
    const source = fs.readFileSync(`src/pages/${file}`, 'utf8');
    assert.match(source, /useState\(false\)/, file);
    assert.doesNotMatch(source, /hidden=\{!open\}/, file);
    assert.match(source, /open \? 'flex' : 'none'/, file);
    assert.match(source, /onClick=\{\(\) => setOpen\(true\)\}/, file);
  }
});
