import { productsRepository } from '@/data/repositories/productsRepository';
import { productSchema } from '@/schemas';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export const productsService = {
  list: (companyId) => productsRepository.list(companyId),
  create: (companyId, data) => {
    const parsed = productSchema.parse({ ...data, company_id: companyId, price: data.price ?? data.sale_price, cost: data.cost ?? data.cost_price, minimum_stock: data.minimum_stock ?? data.min_stock });
    const payload = isSupabase() ? parsed : {
      ...parsed,
      sale_price: parsed.price,
      cost_price: parsed.cost,
      min_stock: parsed.minimum_stock,
    };
    return productsRepository.create(payload, companyId);
  },
  update: (companyId, id, data) => productsRepository.update(id, data, companyId),
  remove: (companyId, id) => productsRepository.remove(id, companyId),
};
