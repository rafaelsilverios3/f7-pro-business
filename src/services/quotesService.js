import { quotesRepository } from '@/data/repositories/quotesRepository';
import { supabaseProvider } from '@/data/providers/supabaseProvider';
import { createQuote as legacyCreate, updateQuoteStatus as legacyStatus, convertQuoteToSale as legacyConvert } from '@/lib/quotes';
export const quotesService = {
  list: (companyId) => quotesRepository.list(companyId),
  create: (companyId, data) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? quotesRepository.create({ ...data, company_id: companyId }, companyId) : legacyCreate(companyId, data),
  updateStatus: (companyId, id, status) => import.meta.env.VITE_DATA_PROVIDER === 'supabase'
    ? status === 'approved' ? supabaseProvider.rpc('approve_quote', { target_quote: id }) : quotesRepository.update(id, { status }, companyId)
    : legacyStatus(id, status),
  remove: () => { throw new Error('Orçamentos não podem ser excluídos; use cancelamento para preservar o histórico.'); },
  convertToSale: async (quote) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return legacyConvert(quote);
    return supabaseProvider.rpc('convert_quote_to_sale', { target_quote: quote.id });
  },
};
