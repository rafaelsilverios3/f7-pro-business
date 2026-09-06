import { quotesRepository } from '@/data/repositories/quotesRepository';
import { salesService } from '@/services/salesService';
import { createQuote as legacyCreate, updateQuoteStatus as legacyStatus, convertQuoteToSale as legacyConvert } from '@/lib/quotes';
export const quotesService = {
  list: (companyId) => quotesRepository.list(companyId),
  create: (companyId, data) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? quotesRepository.create({ ...data, company_id: companyId }, companyId) : legacyCreate(companyId, data),
  updateStatus: (companyId, id, status) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? quotesRepository.update(id, { status }, companyId) : legacyStatus(id, status),
  remove: (companyId, id) => quotesRepository.remove(id, companyId),
  convertToSale: async (quote) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return legacyConvert(quote);
    if (quote.status !== 'approved' || quote.sale_id) throw new Error('Orçamento já convertido ou não aprovado.');
    const sale = await salesService.finalize(quote.company_id, { customer_id: quote.customer_id, customer_name: quote.customer_name, items: quote.items || [], discount: quote.discount, addition: quote.addition, seller: quote.seller, payment_method: 'A combinar', notes: 'Convertido do orçamento', idempotency_key: `quote:${quote.id}` });
    await quotesRepository.update(quote.id, { status: 'converted', sale_id: sale.id }, quote.company_id);
    return sale;
  },
};
