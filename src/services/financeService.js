import { financeRepository } from '@/data/repositories/financeRepository';
import { financeSchema } from '@/schemas';
export const financeService = { list: (companyId) => financeRepository.list(companyId, '-due_date'), create: (companyId, data) => financeRepository.create(financeSchema.parse({ ...data, company_id: companyId }), companyId), settle: (companyId, entry) => entry.status === 'paid' ? entry : financeRepository.update(entry.id, { status: 'paid', paid_date: new Date().toISOString().slice(0, 10) }, companyId), remove: (companyId, id) => financeRepository.remove(id, companyId) };
