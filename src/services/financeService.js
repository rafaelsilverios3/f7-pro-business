import { financeRepository } from '@/data/repositories/financeRepository';
import { financeSchema } from '@/schemas';
import { getDataProvider } from '@/data/providerSelector';
export const financeService = { list: (companyId) => financeRepository.list(companyId, '-due_date'), create: (companyId, data) => financeRepository.create(financeSchema.parse({ ...data, company_id: companyId }), companyId), settle: (companyId, entry) => entry.status === 'paid' ? entry : import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? getDataProvider().rpc('settle_financial_entry', { entry_id: entry.id }) : financeRepository.update(entry.id, { status: 'paid', paid_date: new Date().toISOString().slice(0, 10) }, companyId), remove: (companyId, id) => financeRepository.remove(id, companyId) };
