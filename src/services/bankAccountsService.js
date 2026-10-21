import { getDataProvider } from '@/data/providerSelector';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export const bankAccountsService = {
  async list(companyId) {
    if (!isSupabase()) return [];
    return getDataProvider().rpc('list_company_bank_accounts', { target_company: companyId });
  },
  async receivingAccounts(companyId) {
    if (!isSupabase()) return [];
    return getDataProvider().rpc('list_company_receiving_accounts', { target_company: companyId });
  },
  async create(companyId, values) {
    if (!isSupabase()) throw new Error('Cadastro bancário requer o provedor Supabase.');
    const { agency, account_number, holder_name, holder_document, pix_key_type, pix_key, ...metadata } = values;
    return getDataProvider().rpc('save_company_bank_account', { target_company: companyId, account_metadata: metadata, sensitive_fields: { agency, account_number, holder_name, holder_document, pix_key_type, pix_key }, target_account: null });
  },
  async update(companyId, accountId, values) {
    if (!isSupabase()) throw new Error('Cadastro bancário requer o provedor Supabase.');
    const { agency, account_number, holder_name, holder_document, pix_key_type, pix_key, ...metadata } = values;
    return getDataProvider().rpc('save_company_bank_account', { target_company: companyId, account_metadata: metadata, sensitive_fields: { agency, account_number, holder_name, holder_document, pix_key_type, pix_key }, target_account: accountId });
  },
  async secret(accountId) {
    if (!isSupabase()) return {};
    return getDataProvider().rpc('get_company_bank_account_secret', { target_account: accountId });
  },
  async setPrimary(accountId) {
    if (!isSupabase()) throw new Error('Cadastro bancário requer o provedor Supabase.');
    return getDataProvider().rpc('set_primary_company_bank_account', { target_account: accountId });
  },
  async setSaleAccount(saleId, accountId) {
    if (!isSupabase()) return null;
    return getDataProvider().rpc('set_quote_sale_receiving_account', { target_sale: saleId, target_account: accountId || null });
  },
};
