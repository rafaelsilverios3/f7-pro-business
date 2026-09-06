import { base44 } from '@/api/base44Client';
import { todayISO, createSale } from '@/lib/business';

export async function createQuote(companyId, data) {
  const items = (data.items || []).map((i) => ({
    product_id: i.product_id,
    name: i.name,
    qty: Number(i.qty) || 0,
    price: Number(i.price) || 0,
    cost: Number(i.cost) || 0,
    total: (Number(i.qty) || 0) * (Number(i.price) || 0),
  }));
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const discount = Number(data.discount) || 0;
  const addition = Number(data.addition) || 0;
  const total = subtotal - discount + addition;
  const costTotal = items.reduce((s, i) => s + i.qty * i.cost, 0);
  const profit = total - costTotal;

  return base44.entities.Quote.create({
    company_id: companyId,
    customer_id: data.customer_id || null,
    customer_name: data.customer_name,
    seller: data.seller || '',
    items,
    subtotal, discount, addition, total, cost_total: costTotal, profit,
    valid_until: data.valid_until || '',
    notes: data.notes || '',
    status: data.status || 'draft',
  });
}

export async function updateQuoteStatus(quoteId, status) {
  return base44.entities.Quote.update(quoteId, { status });
}

export async function convertQuoteToSale(quote) {
  if (quote.status !== 'approved') {
    throw new Error('Apenas orçamentos aprovados podem ser convertidos em venda.');
  }
  const sale = await createSale(quote.company_id, {
    customer_id: quote.customer_id,
    customer_name: quote.customer_name,
    items: (quote.items || []).map((i) => ({
      product_id: i.product_id, name: i.name, qty: i.qty, price: i.price, cost: i.cost,
    })),
    discount: quote.discount,
    addition: quote.addition,
    seller: quote.seller,
    payment_method: 'A combinar',
    notes: `Convertido do orçamento`,
  });
  await base44.entities.Quote.update(quote.id, { status: 'approved', sale_id: sale.id });
  return sale;
}