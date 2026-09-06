/** Round monetary values consistently to two decimal places. */
export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateSaleTotals(items = [], discount = 0, addition = 0) {
  const normalized = items.map((item) => ({
    qty: Number(item.qty) || 0,
    price: Number(item.price) || 0,
    cost: Number(item.cost) || 0,
  }));
  const subtotal = roundMoney(normalized.reduce((sum, item) => sum + item.qty * item.price, 0));
  const costTotal = roundMoney(normalized.reduce((sum, item) => sum + item.qty * item.cost, 0));
  const total = roundMoney(Math.max(0, subtotal - (Number(discount) || 0) + (Number(addition) || 0)));
  return { subtotal, costTotal, total, profit: roundMoney(total - costTotal) };
}

export function calculateInstallments(total, count = 1) {
  const quantity = Math.max(1, Math.floor(Number(count) || 1));
  const value = roundMoney(Number(total) / quantity);
  const installments = Array.from({ length: quantity }, (_, index) => ({
    number: index + 1,
    amount: index === quantity - 1 ? roundMoney(Number(total) - value * (quantity - 1)) : value,
  }));
  return installments;
}

export function calculateCommission(total, rate) {
  return roundMoney((Number(total) || 0) * (Number(rate) || 0) / 100);
}
