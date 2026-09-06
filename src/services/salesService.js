import { createSale, cancelSale } from '@/lib/business';
import { saleSchema } from '@/schemas';
import { salesRepository } from '@/data/repositories/salesRepository';
export const salesService = {
  create: async (companyId, data) => {
    saleSchema.parse({ ...data, company_id: companyId });
    if (data.idempotency_key) {
      const existing = await salesRepository.list(companyId).catch(() => []);
      const duplicate = existing.find((sale) => sale.idempotency_key === data.idempotency_key);
      if (duplicate) return duplicate;
    }
    return createSale(companyId, { ...data, idempotency_key: data.idempotency_key || undefined });
  },
  cancel: cancelSale,
};
