import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dialog = fs.readFileSync('src/components/ui/dialog.jsx', 'utf8');
const alertDialog = fs.readFileSync('src/components/ui/alert-dialog.jsx', 'utf8');
const sheet = fs.readFileSync('src/components/ui/sheet.jsx', 'utf8');
const drawer = fs.readFileSync('src/components/ui/drawer.jsx', 'utf8');
const product = fs.readFileSync('src/components/produtos/ProductDialog.jsx', 'utf8');
const customer = fs.readFileSync('src/components/clients/CustomerDialog.jsx', 'utf8');
const sale = fs.readFileSync('src/components/vendas/SaleDialog.jsx', 'utf8');
const quote = fs.readFileSync('src/components/orcamentos/QuoteDialog.jsx', 'utf8');
const marketIntelligence = fs.readFileSync('src/pages/MarketIntelligence.jsx', 'utf8');

test('shared dialogs stay inside the viewport without CSS zoom or scale', () => {
  assert.match(dialog, /w-\[calc\(100vw-1rem\)\]/);
  assert.match(dialog, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(dialog, /overflow-x-hidden/);
  assert.match(dialog, /overflow-y-auto/);
  assert.match(dialog, /flex min-h-0/);
  assert.match(dialog, /flex-col/);
  assert.doesNotMatch(dialog, /\bzoom\s*:/);
  assert.doesNotMatch(dialog, /transform:\s*scale/);
});

test('alerts, sheets and drawers constrain long content to the viewport', () => {
  assert.match(alertDialog, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(alertDialog, /overflow-y-auto/);
  assert.match(sheet, /max-h-\[90dvh\]/);
  assert.match(sheet, /w-\[min\(24rem,calc\(100vw-1rem\)\)\]/);
  assert.match(sheet, /overflow-y-auto/);
  assert.match(sheet, /flex min-h-0 flex-col/);
  assert.match(drawer, /max-h-\[90dvh\]/);
  assert.match(drawer, /overflow-y-auto/);
});

test('long product, customer, sale and quote forms scroll internally with reachable actions', () => {
  for (const source of [product, customer, sale, quote]) {
    assert.match(source, /DialogContent className="flex min-h-0 max-w-/);
    assert.match(source, /min-h-0/);
    assert.match(source, /flex-1/);
    assert.match(source, /overflow-y-auto/);
    assert.match(source, /overflow-x-hidden/);
    assert.match(source, /sticky bottom-0/);
  }
});

test('product fixed grids collapse to one column on small viewports', () => {
  assert.doesNotMatch(product, /className="grid grid-cols-(?:2|3) gap-3"/);
  assert.match(product, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(product, /grid grid-cols-1 gap-3 sm:grid-cols-3/);
});

test('custom registration modal stays fluid and keeps actions reachable', () => {
  assert.match(marketIntelligence, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(marketIntelligence, /overflow-y-auto overflow-x-hidden/);
  assert.match(marketIntelligence, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(marketIntelligence, /sticky bottom-0/);
});
