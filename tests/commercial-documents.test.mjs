import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuoteShareText, createQuotePdf, createSaleReceiptPdf, quoteReference, saleReference } from '../src/lib/commercialDocuments.js';

test('commercial documents use tenant-local traceable references', () => {
  const quote = { id: '12345678-1234-1234-1234-123456789abc', created_at: '2026-10-20T12:00:00Z', total: 100 };
  const sale = { id: quote.id, sale_date: '2026-10-20', total: 100 };
  assert.equal(quoteReference(quote), 'ORC-2026-12345678');
  assert.equal(saleReference(sale), 'VEN-2026-12345678');
  assert.match(buildQuoteShareText(quote, { name: 'F7 TESTE' }, 'Rafael'), /Cliente: Rafael/);
});

test('quote PDF and sale receipt PDF render from stored commercial snapshots', () => {
  const record = {
    id: '12345678-1234-1234-1234-123456789abc', created_at: '2026-10-20T12:00:00Z', sale_date: '2026-10-20',
    customer_name: 'Rafael', total: 100, subtotal: 120, discount: 20, addition: 0,
    items: [{ name: 'Produto cadastrado', qty: 1, price: 120, total: 120 }],
  };
  assert.match(createQuotePdf(record, { name: 'F7 TESTE' }, 'Rafael').output(), /^%PDF/);
  assert.match(createSaleReceiptPdf(record, { name: 'F7 TESTE' }).output(), /^%PDF/);
});
