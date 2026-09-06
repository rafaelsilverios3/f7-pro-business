import { customersRepository } from '@/data/repositories/customersRepository';
import { customerSchema } from '@/schemas';
export const customersService = { list: (companyId) => customersRepository.list(companyId), create: (companyId, data) => customersRepository.create(customerSchema.parse({ ...data, company_id: companyId }), companyId), update: (companyId, id, data) => customersRepository.update(id, data, companyId), remove: (companyId, id) => customersRepository.remove(id, companyId) };
