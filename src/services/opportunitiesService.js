import { createRepository } from '@/data/repositoryFactory';
const repository = createRepository('Opportunity');
export const opportunitiesService = { list: (companyId) => repository.list(companyId, '-created_at'), create: (companyId, data) => repository.create(data, companyId), update: (companyId, id, data) => repository.update(id, data, companyId), remove: (companyId, id) => repository.remove(id, companyId) };
