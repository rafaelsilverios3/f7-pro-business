import { createSale, cancelSale } from '@/lib/business';
import { saleSchema } from '@/schemas';
import { salesRepository } from '@/data/repositories/salesRepository';
import { getDataProvider } from '@/data/providerSelector';
export const salesService = {
  finalize: async (companyId, payload) => {
    saleSchema.parse({ ...payload, company_id: companyId });
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') return getDataProvider().rpc('finalize_sale', { sale_payload: { ...payload, company_id: companyId } });
    return salesService.create(companyId, payload);
  },
  create: async (companyId, data) => {
    saleSchema.parse({ ...data, company_id: companyId });
    if (data.idempotency_key) {
      const existing = await salesRepository.list(companyId).catch(() => []);
      const duplicate = existing.find((sale) => sale.idempotency_key === data.idempotency_key);
      if (duplicate) return duplicate;
    }
    return createSale(companyId, { ...data, idempotency_key: data.idempotency_key || undefined });
  },
  cancel: async (sale) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? getDataProvider().rpc('cancel_sale', { target_sale: sale.id }) : cancelSale(sale),
};
