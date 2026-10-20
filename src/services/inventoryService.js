import { productsRepository } from '@/data/repositories/productsRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { getDataProvider } from '@/data/providerSelector';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export const inventoryService = {
  list: async (companyId, itemType = null) => (await productsRepository.list(companyId)).filter((product) => {
    const type = product.item_type || 'product';
    return (type === 'product' || type === 'material') && (!itemType || type === itemType);
  }),
  adjust: async (companyId, product, stock, reason) => {
    if (product.item_type === 'service') throw new Error('Serviços não possuem estoque.');
    if (!['product', 'material'].includes(product.item_type || 'product')) throw new Error('Tipo de item inválido para estoque.');
    const targetStock = Number(stock);
    if (!Number.isFinite(targetStock) || targetStock < 0) throw new Error('Informe um saldo de estoque válido e não negativo.');
    if (isSupabase()) {
      return getDataProvider().rpc('adjust_inventory', {
        target_product: product.id,
        target_stock: targetStock,
        adjustment_reason: reason || 'Ajuste de estoque',
      });
    }
    const updated = await productsRepository.update(product.id, { stock: targetStock }, companyId);
    await inventoryRepository.create({ product_id: product.id, product_name: product.name, type: 'adjust', quantity: targetStock - (product.stock || 0), reason: reason || 'Ajuste de estoque' }, companyId);
    return updated;
  },
};
