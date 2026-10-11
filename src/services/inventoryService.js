import { productsRepository } from '@/data/repositories/productsRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { getDataProvider } from '@/data/providerSelector';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export const inventoryService = {
  list: async (companyId) => (await productsRepository.list(companyId)).filter((product) => product.item_type !== 'service'),
  adjust: async (companyId, product, stock, reason) => {
    if (product.item_type === 'service') throw new Error('Serviços não possuem estoque.');
    if (isSupabase()) {
      return getDataProvider().rpc('adjust_inventory', {
        target_product: product.id,
        target_stock: Number(stock),
        adjustment_reason: reason || 'Ajuste de estoque',
      });
    }
    const updated = await productsRepository.update(product.id, { stock: Number(stock) }, companyId);
    await inventoryRepository.create({ product_id: product.id, product_name: product.name, type: 'adjust', quantity: Number(stock) - (product.stock || 0), reason: reason || 'Ajuste de estoque' }, companyId);
    return updated;
  },
};
