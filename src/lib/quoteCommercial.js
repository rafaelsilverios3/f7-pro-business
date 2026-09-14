const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
};

export function quoteTotals(items = [], discount = 0, addition = 0) {
  const normalizedItems = items.map((item) => ({ ...item, qty: Number(item.qty ?? item.quantity), unit_price: money(item.unit_price ?? item.price), subtotal: money(Number(item.qty ?? item.quantity) * Number(item.unit_price ?? item.price)) }));
  const subtotal = money(normalizedItems.reduce((sum, item) => sum + item.subtotal, 0));
  const safeDiscount = Math.max(0, money(discount));
  const safeAddition = Math.max(0, money(addition));
  return { items: normalizedItems, subtotal, discount: safeDiscount, addition: safeAddition, total: Math.max(0, money(subtotal - safeDiscount + safeAddition)) };
}

export function quoteHasReliableSnapshot(quote) {
  return Array.isArray(quote?.items) && quote.items.length > 0 && quote.items.every((item) => Number.isFinite(Number(item.qty ?? item.quantity)) && Number(item.qty ?? item.quantity) > 0 && Number.isFinite(Number(item.unit_price ?? item.price)) && Number(item.unit_price ?? item.price) >= 0 && Number.isFinite(Number(item.unit_cost ?? item.cost)) && Number(item.unit_cost ?? item.cost) >= 0);
}

export function quoteIsExpired(quote, today = new Date()) {
  if (!quote?.valid_until) return false;
  const expiry = new Date(`${quote.valid_until}T23:59:59`);
  return Number.isFinite(expiry.getTime()) && expiry.getTime() < new Date(today).getTime();
}
