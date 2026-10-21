import { quotesRepository } from '@/data/repositories/quotesRepository';
import { supabaseProvider } from '@/data/providers/supabaseProvider';
import { createQuote as legacyCreate, updateQuoteStatus as legacyStatus } from '@/lib/quotes';
export const quotesService = {
  list: (companyId) => quotesRepository.list(companyId),
  create: (companyId, data) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? quotesRepository.create({ ...data, company_id: companyId }, companyId) : legacyCreate(companyId, data),
  update: (companyId, id, data) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') throw new Error('A edição segura de orçamentos requer o fluxo Supabase.');
    return quotesRepository.update(id, { ...data, company_id: companyId }, companyId);
  },
  updateStatus: (companyId, id, status) => import.meta.env.VITE_DATA_PROVIDER === 'supabase'
    ? status === 'approved' ? supabaseProvider.rpc('approve_quote', { target_quote: id }) : quotesRepository.update(id, { status }, companyId)
    : legacyStatus(id, status),
  remove: () => { throw new Error('Orçamentos não podem ser excluídos; use cancelamento para preservar o histórico.'); },
  sendToSales: async (quote) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') throw new Error('O envio para faturamento requer o fluxo seguro do Supabase.');
    return supabaseProvider.rpc('send_quote_to_sales', { target_quote: quote.id });
  },
  cancel: async (quote, reason) => {
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') throw new Error('O cancelamento auditado requer o fluxo seguro do Supabase.');
    return supabaseProvider.rpc('cancel_quote', { target_quote: quote.id, reason });
  },
  returnToQuote: async (saleId) => supabaseProvider.rpc('return_quote_sale_to_quote', { target_sale: saleId }),
};
