import { base44 } from '@/api/base44Client';
import { todayISO } from '@/lib/business';

export async function createPurchase(companyId, data) {
  const items = (data.items || []).map((i) => ({
    product_id: i.product_id,
    name: i.name,
    qty: Number(i.qty) || 0,
    cost: Number(i.cost) || 0,
    total: (Number(i.qty) || 0) * (Number(i.cost) || 0),
  }));
  const total = items.reduce((s, i) => s + i.total, 0);

  const po = await base44.entities.PurchaseOrder.create({
    company_id: companyId,
    supplier_id: data.supplier_id || null,
    supplier_name: data.supplier_name,
    items,
    total,
    expected_date: data.expected_date || '',
    status: 'pending',
    notes: data.notes || '',
  });

  return po;
}

export async function receivePurchase(po) {
  if (!po?.id || po.status === 'received') return null;
  for (const item of (po.items || [])) {
    if (!item.product_id) continue;
    const prod = await base44.entities.Product.get(item.product_id).catch(() => null);
    if (prod) {
      await base44.entities.Product.update(item.product_id, {
        stock: (prod.stock || 0) + item.qty,
        cost_price: item.cost > 0 ? item.cost : prod.cost_price,
      });
    }
    await base44.entities.StockMovement.create({
      company_id: po.company_id,
      product_id: item.product_id,
      product_name: item.name,
      type: 'in',
      quantity: item.qty,
      reason: 'Recebimento de compra',
      purchase_id: po.id,
    });
  }

  const fin = await base44.entities.FinancialEntry.create({
    company_id: po.company_id,
    type: 'payable',
    nature: 'expense',
    description: `Compra #${po.id.slice(-6).toUpperCase()} — ${po.supplier_name}`,
    category: 'Fornecedores',
    amount: po.total,
    total_amount: po.total,
    paid_amount: 0,
    received_amount: 0,
    due_date: po.expected_date || todayISO(),
    status: 'pending',
    purchase_id: po.id,
    payment_method: 'A combinar',
    account: 'Caixa',
  });

  await base44.entities.PurchaseOrder.update(po.id, {
    status: 'received',
    received_date: todayISO(),
    financial_entry_id: fin.id,
  });

  return fin;
}
