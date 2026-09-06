import { createRepository } from '@/data/repositoryFactory';
const repository = createRepository('Goal');
export const goalsService = { list: (companyId) => repository.list(companyId, '-created_at'), create: (companyId, data) => repository.create(data, companyId), remove: (companyId, id) => repository.remove(id, companyId) };
