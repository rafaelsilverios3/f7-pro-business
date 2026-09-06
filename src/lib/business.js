import { base44 } from '@/api/base44Client';
import { format, parseISO, isAfter, isBefore, subMonths, startOfMonth, endOfMonth, startOfDay, endOfDay, startOfYear, endOfYear } from 'date-fns';
import { createCommissionsForSale, reverseCommissionsForSale } from '@/lib/commissions';
import { runAutomations } from '@/lib/automations';
import { ptBR } from 'date-fns/locale';
import { calculateSaleTotals, roundMoney } from '@/lib/calculations';

export const fmtMoney = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export const fmtMoneyShort = (v) => {
  const n = v || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return 'R$ ' + (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (abs >= 1_000) return 'R$ ' + (n / 1_000).toFixed(1).replace('.0', '') + 'k';
  return fmtMoney(n);
};

export const fmtNum = (v) => new Intl.NumberFormat('pt-BR').format(v || 0);

export const fmtDate = (d) => {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return d; }
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

const inRange = (dStr, start, end) => {
  if (!dStr) return false;
  try {
    const d = parseISO(dStr);
    return (isAfter(d, start) || d.getTime() === start.getTime()) &&
           (isBefore(d, end) || d.getTime() === end.getTime());
  } catch { return false; }
};

export function periodKey(saleDate, period) {
  if (!saleDate) return false;
  const now = new Date();
  if (period === 'day') return inRange(saleDate, startOfDay(now), endOfDay(now));
  if (period === 'month') return inRange(saleDate, startOfMonth(now), endOfMonth(now));
  if (period === 'year') return inRange(saleDate, startOfYear(now), endOfYear(now));
  return false;
}

export function periodKeyPrev(saleDate, period) {
  if (!saleDate) return false;
  const now = new Date();
  if (period === 'day') {
    const prev = new Date(now); prev.setDate(prev.getDate() - 1);
    return inRange(saleDate, startOfDay(prev), endOfDay(prev));
  }
  if (period === 'month') {
    const prev = subMonths(now, 1);
    return inRange(saleDate, startOfMonth(prev), endOfMonth(prev));
  }
  if (period === 'year') {
    const prev = new Date(now.getFullYear() - 1, 0, 1);
    return inRange(saleDate, startOfYear(prev), endOfYear(prev));
  }
  return false;
}

// Cria uma venda e integra estoque, financeiro e cliente automaticamente
export async function createSale(companyId, data) {
  if (!companyId) throw new Error('Empresa não identificada.');
  const items = (data.items || []).map((i) => ({
    product_id: i.product_id,
    name: i.name,
    qty: Number(i.qty) || 0,
    price: Number(i.price) || 0,
    cost: Number(i.cost) || 0,
    total: roundMoney((Number(i.qty) || 0) * (Number(i.price) || 0)),
  }));
  if (!items.length || items.some((item) => !item.product_id || item.qty <= 0 || item.price < 0)) {
    throw new Error('Adicione pelo menos um produto com quantidade válida.');
  }
  // Pré-valida o estoque antes de persistir a venda para evitar venda criada sem baixa correspondente.
  const products = new Map();
  for (const item of items) {
    if (products.has(item.product_id)) continue;
    const product = await base44.entities.Product.get(item.product_id);
    if (!product || product.company_id !== companyId) throw new Error(`Produto inválido: ${item.name || item.product_id}`);
    products.set(item.product_id, product);
  }
  for (const item of items) {
    const requested = items.filter((i) => i.product_id === item.product_id).reduce((sum, i) => sum + i.qty, 0);
    if ((products.get(item.product_id).stock || 0) < requested) throw new Error(`Estoque insuficiente para ${item.name || 'o produto'}.`);
  }
  const discount = Number(data.discount) || 0;
  const addition = Number(data.addition) || 0;
  const { subtotal, costTotal, total, profit } = calculateSaleTotals(items, discount, addition);

  const sale = await base44.entities.Sale.create({
    company_id: companyId,
    customer_id: data.customer_id || null,
    customer_name: data.customer_name,
    items,
    subtotal,
    discount,
    addition,
    total,
    cost_total: costTotal,
    profit,
    seller: data.seller || '',
    payment_method: data.payment_method || 'Dinheiro',
    installments: Number(data.installments) || 1,
    notes: data.notes || '',
    status: 'paid',
    sale_date: todayISO(),
  });

  // Baixa de estoque + movimentações
  for (const item of items) {
    if (!item.product_id) continue;
    const prod = products.get(item.product_id);
    if (prod) {
      await base44.entities.Product.update(item.product_id, {
        stock: Math.max(0, (prod.stock || 0) - item.qty),
      });
    }
    await base44.entities.StockMovement.create({
      company_id: companyId,
      product_id: item.product_id,
      product_name: item.name,
      type: 'out',
      quantity: item.qty,
      reason: 'Venda',
      sale_id: sale.id,
    });
  }

  // Conta a receber
  await base44.entities.FinancialEntry.create({
    company_id: companyId,
    type: 'receivable',
    description: `Venda #${sale.id.slice(-6).toUpperCase()} — ${data.customer_name}`,
    category: 'Vendas',
    amount: total,
    due_date: todayISO(),
    paid_date: todayISO(),
    status: 'paid',
    sale_id: sale.id,
    payment_method: data.payment_method || 'Dinheiro',
    account: 'Caixa',
  });

  // Atualiza cliente
  if (data.customer_id) {
    const cust = await base44.entities.Customer.get(data.customer_id).catch(() => null);
    if (cust) {
      const newTotal = (cust.total_purchased || 0) + total;
      const newCount = (cust.sale_count || 0) + 1;
      await base44.entities.Customer.update(data.customer_id, {
        total_purchased: newTotal,
        sale_count: newCount,
        avg_ticket: newTotal / newCount,
        last_purchase_date: todayISO(),
        status: 'active',
      });
    }
  }

  // Comissões
  try { await createCommissionsForSale(sale); } catch {}

  // Automações
  try { await runAutomations(companyId, 'new_sale', { ...sale, _type: 'sale' }); } catch {}

  return sale;
}

// Cancela venda e devolve estoque
export async function cancelSale(sale) {
  if (!sale?.id) throw new Error('Venda inválida.');
  if (sale.status === 'cancelled') return sale;
  await base44.entities.Sale.update(sale.id, { status: 'cancelled' });
  for (const item of (sale.items || [])) {
    if (!item.product_id) continue;
    const prod = await base44.entities.Product.get(item.product_id).catch(() => null);
    if (prod) {
      await base44.entities.Product.update(item.product_id, {
        stock: (prod.stock || 0) + item.qty,
      });
    }
    await base44.entities.StockMovement.create({
      company_id: sale.company_id,
      product_id: item.product_id,
      product_name: item.name,
      type: 'in',
      quantity: item.qty,
      reason: 'Estorno de venda cancelada',
      sale_id: sale.id,
    });
  }
  const entries = await base44.entities.FinancialEntry.filter({ sale_id: sale.id, type: 'receivable' }, '-created_date', 100).catch(() => []);
  await Promise.all(entries.map((entry) => base44.entities.FinancialEntry.update(entry.id, { status: 'cancelled', cancelled_date: todayISO() })));

  if (sale.customer_id) {
    const customer = await base44.entities.Customer.get(sale.customer_id).catch(() => null);
    if (customer) {
      const total = Math.max(0, (customer.total_purchased || 0) - (sale.total || 0));
      const count = Math.max(0, (customer.sale_count || 0) - 1);
      await base44.entities.Customer.update(customer.id, {
        total_purchased: total,
        sale_count: count,
        avg_ticket: count ? total / count : 0,
      });
    }
  }

  // Estorna comissões
  try { await reverseCommissionsForSale(sale.id); } catch {}
  return { ...sale, status: 'cancelled' };
}

export async function adjustStock(companyId, product, newStock, reason) {
  const diff = Number(newStock) - (product.stock || 0);
  await base44.entities.Product.update(product.id, { stock: Number(newStock) });
  if (diff !== 0) {
    await base44.entities.StockMovement.create({
      company_id: companyId,
      product_id: product.id,
      product_name: product.name,
      type: 'adjust',
      quantity: diff,
      reason: reason || 'Ajuste de inventário',
    });
  }
}
