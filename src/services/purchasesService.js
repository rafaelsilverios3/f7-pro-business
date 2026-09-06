import { receivePurchase } from '@/lib/purchases';
import { getDataProvider } from '@/data/providerSelector';
import { purchasesRepository } from '@/data/repositories/purchasesRepository';
export const purchasesService = {
  list: (companyId) => purchasesRepository.list(companyId),
  create: async (companyId, data) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return (await import('@/lib/purchases')).createPurchase(companyId, data);
    const { items = [], ...purchase } = data;
    const created = await purchasesRepository.create({ ...purchase, total: items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0), 0), status: 'pending' }, companyId);
    await Promise.all(items.map((item) => getDataProvider().entity('PurchaseItem').create({ company_id: companyId, purchase_id: created.id, product_id: item.product_id, quantity: Number(item.qty), cost: Number(item.cost) })));
    return created;
  },
  receive: (purchase) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? getDataProvider().rpc('receive_purchase', { target_purchase: purchase.id }) : receivePurchase(purchase),
};
