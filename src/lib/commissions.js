import { base44 } from '@/api/base44Client';
import { getDataProvider } from '@/data/providerSelector';
import { commissionsRepository } from '@/data/repositories/commissionsRepository';

export async function createCommissionsForSale(sale) {
  const seller = sale.seller;
  if (!seller) return [];

  let totalRate = 0;
  const productCommissions = (sale.items || []).map((item) => {
    if (!item.product_id) return 0;
    return getDataProvider().entity('Product').get(item.product_id)
      .then((p) => (p.commission || 0))
      .catch(() => 0);
  });
  const rates = await Promise.all(productCommissions);
  const itemCommissions = (sale.items || []).map((item, idx) => {
    const rate = rates[idx] || 0;
    totalRate += rate;
    return (item.total * rate) / 100;
  });
  const amount = itemCommissions.reduce((s, v) => s + v, 0);

  if (amount <= 0) return [];

  const commission = await getDataProvider().entity('Commission').create({
    company_id: sale.company_id,
    sale_id: sale.id,
    seller,
    type: 'percent',
    rate: totalRate / (sale.items || []).length || 0,
    amount,
    sale_total: sale.total,
    status: 'pending',
    sale_date: sale.sale_date || '',
  });
  return [commission];
}

export async function reverseCommissionsForSale(saleId) {
  const commissions = await getDataProvider().entity('Commission').filter({ sale_id: saleId }, '-created_date', 100).catch(() => []);
  await Promise.all(
    commissions
      .filter((commission) => commission.status !== 'reversed')
      .map((commission) => getDataProvider().entity('Commission').update(commission.id, { status: 'reversed' }))
  );
}

export async function getCommissionSummary(companyId) {
  const all = await commissionsRepository.list(companyId, '-created_date', 500);
  const bySeller = {};
  for (const c of all) {
    if (c.status === 'reversed') continue;
    if (!bySeller[c.seller]) bySeller[c.seller] = { seller: c.seller, pending: 0, paid: 0, total: 0 };
    bySeller[c.seller].total += c.amount || 0;
    if (c.status === 'paid') bySeller[c.seller].paid += c.amount || 0;
    else bySeller[c.seller].pending += c.amount || 0;
  }
  return Object.values(bySeller).sort((a, b) => b.total - a.total);
}
