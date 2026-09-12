import { getDataProvider } from '@/data/providerSelector';
import { productsService } from '@/services/productsService';

export async function applyProductPrice({ companyId, productId, newPrice, pricingData, canManage }) {
  if (!canManage) throw new Error('Você não tem permissão para alterar preços.');
  if (!companyId || !productId || !(Number(newPrice) >= 0)) throw new Error('Dados de preço inválidos.');
  if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') {
    return getDataProvider().rpc('apply_product_price', { target_company: companyId, target_product: productId, new_price: Number(newPrice), pricing_data: pricingData || {} });
  }
  return productsService.update(companyId, productId, { sale_price: Number(newPrice), cost_price: pricingData?.realCost });
}
