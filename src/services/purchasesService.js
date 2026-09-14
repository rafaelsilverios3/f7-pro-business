import { receivePurchase } from '@/lib/purchases';
import { getDataProvider } from '@/data/providerSelector';
import { purchasesRepository } from '@/data/repositories/purchasesRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { salesRepository } from '@/data/repositories/salesRepository';
import { suppliersRepository } from '@/data/repositories/suppliersRepository';
import { createRepository } from '@/data/repositoryFactory';
import { analyzePurchaseNeeds } from '@/lib/purchaseIntelligence';

const purchaseItemsRepository = createRepository('PurchaseItem');

export const purchasesService = {
  list: (companyId) => purchasesRepository.list(companyId),
  listIntelligence: async (companyId, options = {}) => {
    const [products, sales, purchases, purchaseItems, suppliers] = await Promise.all([
      productsRepository.list(companyId, '-created_date', 1000),
      salesRepository.list(companyId, '-sale_date', 1000),
      purchasesRepository.list(companyId, '-created_date', 500),
      import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? purchaseItemsRepository.list(companyId, 'purchase_id', 2000) : Promise.resolve([]),
      suppliersRepository.list(companyId, 'name', 500),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const itemsByPurchase = new Map();
    purchaseItems.forEach((item) => {
      const list = itemsByPurchase.get(item.purchase_id) || [];
      list.push({ ...item, name: productById.get(item.product_id)?.name || 'Produto', qty: item.quantity });
      itemsByPurchase.set(item.purchase_id, list);
    });
    const enrichedPurchases = purchases.map((purchase) => ({
      ...purchase,
      supplier_name: supplierById.get(purchase.supplier_id)?.name || purchase.supplier_name || 'Sem fornecedor',
      items: itemsByPurchase.get(purchase.id) || purchase.items || [],
    }));
    const analysis = analyzePurchaseNeeds({
      companyId,
      products,
      sales,
      purchases: enrichedPurchases,
      purchaseItems,
      suppliers,
      demandDays: options.demandDays || 30,
      now: options.now,
    });
    return { products, sales, suppliers, purchases: enrichedPurchases, purchaseItems, analysis };
  },
  create: async (companyId, data) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return (await import('@/lib/purchases')).createPurchase(companyId, data);
    const { items = [], ...purchase } = data;
    const created = await purchasesRepository.create({ ...purchase, total: items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0), 0), status: 'pending' }, companyId);
    await Promise.all(items.map((item) => getDataProvider().entity('PurchaseItem').create({ company_id: companyId, purchase_id: created.id, product_id: item.product_id, quantity: Number(item.qty), cost: Number(item.cost) })));
    return created;
  },
  receive: (purchase) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? getDataProvider().rpc('receive_purchase', { target_purchase: purchase.id }) : receivePurchase(purchase),
};
